import { parse, tokenizer, parseExpressionAt } from '../deps/acorn.mjs'
import { builders } from '../deps/ast-types-x.mjs'
import { walk } from '../deps/estree-walker.mjs'

const parseOptions = {
	ecmaVersion: 'latest',
	sourceType: 'module',
	allowReturnOutsideFunction: true,
	locations: true,
}

/**
 * 判断 `[from, to)` 是否仅含空白、注释与语句末尾分号。
 *
 * @param {string} source - 完整源码。
 * @param {number} from - 区间起点。
 * @param {number} to - 区间终点。
 * @returns {boolean} 是否全是 suffix trivia。
 */
function isSuffixTrivia(source, from, to) {
	for (let pos = from; pos < to;) {
		const ch = source.charCodeAt(pos)
		if (ch === 59) {
			pos++
			continue
		}
		if (ch <= 13 && (ch === 9 || ch === 10 || ch === 13 || ch === 32)) {
			pos++
			continue
		}
		if (ch === 47 && source.charCodeAt(pos + 1) === 47) {
			pos += 2
			while (pos < to && source.charCodeAt(pos) !== 10)
				pos++
			continue
		}
		if (ch === 47 && source.charCodeAt(pos + 1) === 42) {
			pos += 2
			while (pos < to - 1 && !(source.charCodeAt(pos) === 42 && source.charCodeAt(pos + 1) === 47))
				pos++
			pos += 2
			continue
		}
		return false
	}
	return true
}

/**
 * 用 tokenizer 按顶层分号切分语句（忽略字符串/模板/括号/方括号/花括号内的分号）。
 *
 * @param {string} source - 完整源码。
 * @returns {{ start: number, end: number }[]} 语句在源码中的区间。
 */
function splitTopLevelStatements(source) {
	/** @type {{ start: number, end: number }[]} */
	const statements = []
	let start = 0
	let paren = 0
	let bracket = 0
	let brace = 0

	for (const token of tokenizer(source, parseOptions)) {
		const { label } = token.type
		if (label === '(')
			paren++
		else if (label === ')')
			paren--
		else if (label === '[')
			bracket++
		else if (label === ']')
			bracket--
		else if (label === '{')
			brace++
		else if (label === '}')
			brace--
		else if (label === ';' && !paren && !bracket && !brace) {
			if (token.start > start)
				statements.push({ start, end: token.start })
			start = token.end
		}
	}

	if (start < source.length) {
		let end = source.length
		while (end > start && source.charCodeAt(end - 1) <= 32)
			end--
		if (end > start)
			statements.push({ start, end })
	}

	return statements
}

/**
 * 自 `start` 起按表达式语境解析，且要求表达式后至 `end` 仅为 trivia。
 *
 * @param {string} source - 完整源码。
 * @param {number} start - 表达式起点。
 * @param {number} end - 语句终点。
 * @returns {import('estree').Expression | null} 解析出的表达式，或 `null`。
 */
function tryParseExpressionAt(source, start, end) {
	try {
		const node = parseExpressionAt(source, start, parseOptions)
		if (isSuffixTrivia(source, node.end, end))
			return node
	} catch {}
	return null
}

/**
 * 为最后一条语句追加隐式 return（表达式与变量声明的兜底）。
 *
 * @param {import('estree').Statement[]} body - Program 语句列表。
 * @param {import('estree').Statement | undefined} lastStatement - 最后一条语句。
 */
function appendImplicitReturn(body, lastStatement) {
	if (!lastStatement)
		return

	if (lastStatement.type === 'VariableDeclaration') {
		const lastDeclaration = lastStatement.declarations.at(-1)
		if (lastDeclaration?.init && lastDeclaration.id.type === 'Identifier')
			body.push(builders.returnStatement(lastDeclaration.id))
	}
}

/**
 * 对已成功 parse 的 Program 做末尾隐式 return 处理。
 *
 * @param {import('estree').Program} program - 已解析的 Program。
 * @param {string} source - 原始源码。
 * @returns {import('estree').Program} 补全隐式 return 后的 Program。
 */
function finalizeEvalProgram(program, source) {
	const lastStatement = program.body.at(-1)
	if (!lastStatement)
		return program

	const expression = tryParseExpressionAt(source, lastStatement.start, lastStatement.end)
	if (expression)
		program.body[program.body.length - 1] = builders.returnStatement(expression)
	else
		appendImplicitReturn(program.body, lastStatement)

	return program
}

/**
 * 在常规 parse 失败时，按 tokenizer 切分的语句重建 Program。
 *
 * @param {string} source - 原始源码。
 * @returns {import('estree').Program} 重建后的 Program。
 */
function parseEvalProgramFromStatements(source) {
	const spans = splitTopLevelStatements(source).filter(
		span => !isSuffixTrivia(source, span.start, span.end),
	)
	/** @type {import('estree').Statement[]} */
	const body = []

	for (const [index, { start, end }] of spans.entries()) {
		const isLast = index === spans.length - 1

		if (isLast) {
			const expression = tryParseExpressionAt(source, start, end)
			if (expression) {
				body.push(builders.returnStatement(expression))
				continue
			}
			const program = parse(source.slice(start, end), parseOptions)
			appendImplicitReturn(program.body, program.body.at(-1))
			body.push(...program.body)
			continue
		}

		body.push(...parse(source.slice(start, end), parseOptions).body)
	}

	return builders.program(body)
}

/**
 * 解析待求值源码，并为末尾语句补上隐式 return。
 *
 * @param {string} source - 待求值的完整源码。
 * @returns {import('estree').Program} 可继续变换的 Program AST。
 */
export function parseEvalProgram(source) {
	try {
		return finalizeEvalProgram(parse(source, parseOptions), source)
	} catch {
		return parseEvalProgramFromStatements(source)
	}
}

/**
 * 重写 import/export。
 *
 * @param {import('estree').Program} ast - 已解析的 Program AST。
 * @returns {import('estree').Program} 变换后的 AST。
 */
export function transformEvalAst(ast) {
	walk(ast, {
		/**
		 * 重写 import、移除 export。
		 *
		 * @param {import('estree').Node} node - 当前正在访问的 AST 节点。
		 */
		enter(node) {
			if (node.type === 'ImportDeclaration') {
				const dynamicImportCall = builders.awaitExpression(
					builders.callExpression(
						builders.identifier('import'),
						[node.source]
					)
				)

				if (node.specifiers.length) {
					let hasNamespace = false
					const properties = []

					for (const specifier of node.specifiers)
						if (specifier.type === 'ImportNamespaceSpecifier') {
							hasNamespace = true
							this.replace(builders.variableDeclaration('const', [
								builders.variableDeclarator(specifier.local, dynamicImportCall)
							]))
							break
						} else if (specifier.type === 'ImportDefaultSpecifier')
							properties.push(
								builders.property(
									'init',
									builders.identifier('default'),
									specifier.local,
									false,
									false
								)
							)
						else if (specifier.type === 'ImportSpecifier')
							properties.push(
								builders.property(
									'init',
									specifier.imported,
									specifier.local,
									specifier.imported.name === specifier.local.name,
									false
								)
							)

					if (!hasNamespace && properties.length)
						this.replace(builders.variableDeclaration('const', [
							builders.variableDeclarator(
								builders.objectPattern(properties),
								dynamicImportCall
							)
						]))
					else if (!hasNamespace)
						this.replace(builders.expressionStatement(dynamicImportCall))
				} else
					this.replace(builders.expressionStatement(dynamicImportCall))
			} else if (node.type === 'ExportNamedDeclaration') {
				if (node.declaration)
					this.replace(node.declaration)
				else
					this.skip()
			}
		},
	})
	return ast
}
