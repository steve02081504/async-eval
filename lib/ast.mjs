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
 * 判断 `[from, to)` 是否仅含 suffix trivia：空白、注释、语句末尾分号与右括号。
 *
 * 右括号（`)`）也算 trivia，是因为 acorn 解析括号包裹的表达式（如 `(42)`）时，节点 `end`
 * 落在右括号之前，残留的 `)` 需被忽略，隐式 return 才能识别这类末尾表达式。
 *
 * @param {string} source - 完整源码。
 * @param {number} from - 区间起点。
 * @param {number} to - 区间终点。
 * @returns {boolean} 是否全是 suffix trivia。
 */
function isSuffixTrivia(source, from, to) {
	for (let pos = from; pos < to;) {
		const ch = source.charCodeAt(pos)
		if (ch === 59 /* ; */ || ch === 41 /* ) */) {
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
 * 取 Program 体中最后一条非空语句及其索引（跳过末尾 `;` 产生的 EmptyStatement）。
 *
 * @param {import('estree').Statement[]} body - Program 语句列表。
 * @returns {{ index: number, statement: import('estree').Statement } | null}
 */
function getLastSignificantStatement(body) {
	for (let index = body.length - 1; index >= 0; index--) {
		const statement = body[index]
		if (statement.type !== 'EmptyStatement')
			return { index, statement }
	}
	return null
}

/**
 * 从解构等 pattern 中取最后一个绑定标识符（用于隐式 return）。
 *
 * @param {import('estree').Pattern} pattern - 声明左侧 pattern。
 * @returns {import('estree').Identifier | null}
 */
function getLastBindingIdentifier(pattern) {
	if (pattern.type === 'Identifier')
		return pattern
	if (pattern.type === 'AssignmentPattern')
		return getLastBindingIdentifier(pattern.left)
	if (pattern.type === 'ObjectPattern') {
		for (let index = pattern.properties.length - 1; index >= 0; index--) {
			const property = pattern.properties[index]
			const binding = property.type === 'RestElement'
				? getLastBindingIdentifier(property.argument)
				: getLastBindingIdentifier(property.value)
			if (binding)
				return binding
		}
	}
	if (pattern.type === 'ArrayPattern') {
		for (let index = pattern.elements.length - 1; index >= 0; index--) {
			const element = pattern.elements[index]
			if (!element)
				continue
			const binding = getLastBindingIdentifier(element.type === 'RestElement'
				? element.argument
				: element
			)
			if (binding) return binding
		}
	}
	return null
}

/**
 * 从语句中取出可作为隐式 return 目标的变量声明（含 `export const` 等）。
 *
 * @param {import('estree').Statement | undefined} statement - 最后一条语句。
 * @returns {import('estree').VariableDeclaration | null}
 */
function getImplicitReturnVariableDeclaration(statement) {
	if (statement?.type === 'VariableDeclaration')
		return statement
	if (statement?.type === 'ExportNamedDeclaration' && statement?.declaration?.type === 'VariableDeclaration')
		return statement?.declaration
	return null
}

/**
 * 为最后一条语句追加隐式 return（表达式与变量声明的兜底）。
 *
 * @param {import('estree').Statement[]} body - Program 语句列表。
 * @param {import('estree').Statement | undefined} lastStatement - 最后一条语句。
 */
function appendImplicitReturn(body, lastStatement) {
	const variableDeclaration = getImplicitReturnVariableDeclaration(lastStatement)
	if (!variableDeclaration) return

	const lastDeclaration = variableDeclaration.declarations.at(-1)
	const binding = lastDeclaration?.init && getLastBindingIdentifier(lastDeclaration.id)
	if (binding) body.push(builders.returnStatement(binding))
}

/**
 * 对已成功 parse 的 Program 做末尾隐式 return 处理。
 *
 * @param {import('estree').Program} program - 已解析的 Program。
 * @param {string} source - 原始源码。
 * @returns {import('estree').Program} 补全隐式 return 后的 Program。
 */
function finalizeEvalProgram(program, source) {
	const last = getLastSignificantStatement(program.body)
	if (!last) return program

	const { index, statement } = last
	const expression = tryParseExpressionAt(source, statement.start, statement.end)
	if (expression)
		program.body[index] = builders.returnStatement(expression)
	else
		appendImplicitReturn(program.body, statement)

	return program
}

/**
 * 在 `[from, end)` 内用 tokenizer 定位尾随对象字面量的起始 `{`（忽略字符串/模板/正则内的花括号）。
 *
 * @param {string} source - 完整源码。
 * @param {number} from - 区间起点。
 * @param {number} end - 区间终点（已 trim 尾部空白）。
 * @returns {number} 起始 `{` 的下标，或 `-1`。
 */
function findTrailingObjectLiteralOpen(source, from, end) {
	let paren = 0
	let bracket = 0
	let brace = 0
	let open = -1

	for (const token of tokenizer(source.slice(from, end), parseOptions)) {
		const { label } = token.type
		if (label === '(')
			paren++
		else if (label === ')')
			paren--
		else if (label === '[')
			bracket++
		else if (label === ']')
			bracket--
		else if (label === '{') {
			if (!paren && !bracket && brace === 0)
				open = from + token.start
			brace++
		}
		else if (label === '}')
			brace--
	}

	return open
}

/**
 * 自 `from` 至 `to` 末尾提取可作为隐式 return 的对象字面量表达式。
 *
 * @param {string} source - 完整源码。
 * @param {number} from - 区间起点。
 * @param {number} to - 区间终点。
 * @returns {{ expression: import('estree').Expression, prefixEnd: number } | null}
 */
function extractTrailingObjectLiteral(source, from, to) {
	let end = to
	while (end > from && source.charCodeAt(end - 1) <= 32)
		end--
	if (end <= from || source.charCodeAt(end - 1) !== 125)
		return null

	const open = findTrailingObjectLiteralOpen(source, from, end)
	if (open < 0)
		return null

	const expression = tryParseExpressionAt(source, open, end)
	if (!expression)
		return null

	let prefixEnd = open
	while (prefixEnd > from && source.charCodeAt(prefixEnd - 1) <= 32)
		prefixEnd--

	return { expression, prefixEnd }
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

			const trailingObject = extractTrailingObjectLiteral(source, start, end)
			if (trailingObject) {
				if (trailingObject.prefixEnd > start)
					body.push(...parse(source.slice(start, trailingObject.prefixEnd), parseOptions).body)
				body.push(builders.returnStatement(trailingObject.expression))
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
 * 判断 `node` 是否为 Program 体中的最后一条语句。
 *
 * @param {import('estree').Node} node - 待判断节点。
 * @param {import('estree').Program} program - Program AST。
 * @returns {boolean}
 */
function isLastProgramStatement(node, program) {
	const body = program.body
	return body.length > 0 && body[body.length - 1] === node
}

/**
 * 构建一个普通的 `key: value` 对象属性（非计算、非简写）。
 *
 * @param {import('estree').Expression} key - 属性键节点。
 * @param {import('estree').Expression} value - 属性值节点。
 * @returns {import('estree').Property}
 */
function objectProperty(key, value) {
	return builders.property('init', key, value, false, false)
}

/**
 * 把 import attributes 重建为 `{ with: { … } }` 形态的动态 import 选项对象。
 *
 * @param {import('estree').ImportAttribute[]} attributes - import 声明上的 attributes。
 * @returns {import('estree').ObjectExpression}
 */
function buildImportOptions(attributes) {
	const entries = attributes.map(attr => objectProperty(
		attr.key.type === 'Identifier' ? builders.identifier(attr.key.name) : attr.key,
		attr.value,
	))
	return builders.objectExpression([
		objectProperty(builders.identifier('with'), builders.objectExpression(entries)),
	])
}

/**
 * 构建 `await import(source[, { with: … }])` 表达式，保留 import attributes。
 *
 * @param {import('estree').ImportDeclaration} node - import 声明节点。
 * @returns {import('estree').AwaitExpression}
 */
function buildDynamicImport(node) {
	/** @type {import('estree').Expression[]} */
	const args = [node.source]
	if (node.attributes?.length)
		args.push(buildImportOptions(node.attributes))

	return builders.awaitExpression(
		builders.callExpression(builders.identifier('import'), args),
	)
}

/**
 * 把静态 `import` 声明改写为 `await import()`，并按 specifier 形态绑定。
 *
 * @param {import('estree').ImportDeclaration} node - import 声明节点。
 * @returns {import('estree').Statement} 等价的动态 import 语句。
 */
function rewriteImportDeclaration(node) {
	const dynamicImport = buildDynamicImport(node)

	const namespace = node.specifiers.find(spec => spec.type === 'ImportNamespaceSpecifier')
	const defaultSpec = node.specifiers.find(spec => spec.type === 'ImportDefaultSpecifier')
	const named = node.specifiers.filter(spec => spec.type === 'ImportSpecifier')

	// `import * as ns`：命名空间必须整体绑定到模块对象。
	if (namespace) {
		const declarators = [builders.variableDeclarator(namespace.local, dynamicImport)]
		// `import def, * as ns`：默认绑定取自命名空间的 `default`，不能被丢弃。
		if (defaultSpec)
			declarators.push(builders.variableDeclarator(
				defaultSpec.local,
				builders.memberExpression(builders.identifier(namespace.local.name), builders.identifier('default'), false),
			))
		return builders.variableDeclaration('const', declarators)
	}

	// 默认与命名导入统一解构为单个对象 pattern（默认绑定映射到 `default` 键）。
	/** @type {import('estree').Property[]} */
	const properties = []
	if (defaultSpec)
		properties.push(objectProperty(builders.identifier('default'), defaultSpec.local))
	for (const spec of named)
		properties.push(builders.property('init', spec.imported, spec.local, spec.imported.name === spec.local.name, false))

	// 无 specifier（副作用 import）时只保留求值副作用。
	if (!properties.length)
		return builders.expressionStatement(dynamicImport)

	return builders.variableDeclaration('const', [
		builders.variableDeclarator(builders.objectPattern(properties), dynamicImport),
	])
}

/**
 * 将匿名 `export default function/class` 转为表达式；具名声明原样保留。
 *
 * 匿名函数/类声明仅在 `export default` 语境合法，剥离后须改为表达式。
 *
 * @param {import('estree').Declaration | import('estree').Expression} declaration - export default 右侧。
 * @returns {import('estree').Declaration | import('estree').Expression}
 */
function exportDefaultDeclarationToRhs(declaration) {
	if (declaration.type === 'FunctionDeclaration') {
		if (declaration.id) return declaration
		return {
			type: 'FunctionExpression',
			id: null,
			params: declaration.params,
			body: declaration.body,
			generator: declaration.generator,
			async: declaration.async,
		}
	}
	if (declaration.type === 'ClassDeclaration') {
		if (declaration.id) return declaration
		return {
			type: 'ClassExpression',
			id: null,
			superClass: declaration.superClass ?? null,
			body: declaration.body,
		}
	}
	return declaration
}

/**
 * 剥离 `export default`：声明保留为局部声明，末尾值兜底为隐式 return。
 *
 * @param {import('estree').ExportDefaultDeclaration} node - export default 节点。
 * @param {import('estree').Program} program - 所属 Program，用于判断是否末尾语句。
 * @returns {import('estree').Statement} 去掉 export 关键字后的语句。
 */
function rewriteExportDefault(node, program) {
	const rhs = exportDefaultDeclarationToRhs(node.declaration)
	if (rhs.type === 'FunctionDeclaration' || rhs.type === 'ClassDeclaration')
		return rhs
	if (isLastProgramStatement(node, program))
		return builders.returnStatement(rhs)
	return builders.expressionStatement(rhs)
}

/**
 * 把 `import.meta` 改写为自给自足的等价表达式：动态 import 一个 data: 模块、取回其自身的
 * `import.meta`。`AsyncFunction` 体内不能直接使用 `import.meta` 语法，这样改写既能支持它，
 * 又无需向求值作用域注入绑定或占用某个标识符。
 *
 * @returns {import('estree').Expression} `(await import('data:...')).default` 表达式。
 */
function rewriteImportMeta() {
	return builders.memberExpression(
		builders.awaitExpression(
			builders.callExpression(builders.identifier('import'), [
				builders.literal('data:text/javascript,export default import.meta'),
			]),
		),
		builders.identifier('default'),
		false,
	)
}

/**
 * 把模块语法改写为可在 `AsyncFunction` 中运行的等价代码：import 转动态 import，export 关键字剥离，
 * `import.meta` 转自给自足的等价表达式。
 *
 * @param {import('estree').Program} ast - 已解析的 Program AST。
 * @returns {import('estree').Program} 变换后的 AST。
 */
export function transformEvalAst(ast) {
	walk(ast, {
		/**
		 * @param {import('estree').Node} node - 当前正在访问的 AST 节点。
		 */
		enter(node) {
			if (node.type === 'ImportDeclaration')
				this.replace(rewriteImportDeclaration(node))
			else if (node.type === 'ExportDefaultDeclaration')
				this.replace(rewriteExportDefault(node, ast))
			else if (node.type === 'ExportNamedDeclaration')
				if (node.declaration) this.replace(node.declaration)
				else this.remove()
			else if (node.type === 'ExportAllDeclaration')
				this.remove()
			else if (node.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta')
				this.replace(rewriteImportMeta())
		},
	})
	return ast
}
