import { VirtualConsole } from 'npm:@steve02081504/virtual-console'
import { parse } from 'npm:acorn'
import { builders } from 'npm:ast-types-x'
import { generate } from 'npm:astring'
import { walk } from 'npm:estree-walker'

import { EvalResult } from './eval-result.mjs'

/**
 * 重新导出 `EvalResult`。
 */
export { EvalResult } from './eval-result.mjs'

/**
 * 异步求值 JavaScript 代码，支持可选参数注入与虚拟控制台输出捕获。
 *
 * @param {string} code - 待求值的 JavaScript 代码。
 * @param {object} [args={}] - 可选的参数对象，将作为求值环境中的变量注入。
 * @returns {Promise<import('./eval-result.mjs').EvalResult>} 解析为 `EvalResult`，包含 `result`、`error` 及本次求值的 `outputEntries`；`output` 与 `outputHtml` 为基于这些条目的 getter。
 */
export async function async_eval(code, args = {}) {
	try {
		const ast = parse(code, {
			ecmaVersion: 'latest',
			sourceType: 'module',
			allowReturnOutsideFunction: true,
		})

		walk(ast, {
			/**
			 * 重写 import、移除 export，并追加隐式 return。
			 *
			 * @param {import('npm:estree').Node} node - 当前正在访问的 AST 节点。
			 * @param {import('npm:estree').Node | null} parent - 父节点（若有）。
			 * @param {string | null} prop - 父节点上引用本节点的属性名。
			 * @param {number | null} index - 节点位于数组中时的下标。
			 */
			enter(node, parent, prop, index) {
				// 将 import xxx from 'module' 转换为 const { xxx } = await import('module')
				if (node.type === 'ImportDeclaration') {
					const dynamicImportCall = builders.awaitExpression(
						builders.callExpression(
							builders.identifier('import'),
							[node.source]
						)
					)

					if (node.specifiers && node.specifiers.length > 0) {
						let hasNamespace = false
						const properties = []

						for (const specifier of node.specifiers)
							if (specifier.type === 'ImportNamespaceSpecifier') {
								// import * as name from '...' => const name = await import('...')
								hasNamespace = true
								const declaration = builders.variableDeclaration('const', [
									builders.variableDeclarator(specifier.local, dynamicImportCall)
								])
								this.replace(declaration)
								break
							} else if (specifier.type === 'ImportDefaultSpecifier')
								// import defaultName from '...' => { default: defaultName }
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
								// import { name } from '...' / import { name as alias } from '...' => { name } / { name: alias }
								properties.push(
									builders.property(
										'init',
										specifier.imported,
										specifier.local,
										specifier.imported.name === specifier.local.name,
										false
									)
								)

						if (!hasNamespace && properties.length > 0) {
							// const { default: D, X, Y: Z } = await import('...');
							const declaration = builders.variableDeclaration('const', [
								builders.variableDeclarator(
									builders.objectPattern(properties),
									dynamicImportCall
								)
							])
							this.replace(declaration)
						} else if (!hasNamespace && properties.length === 0) {
							// import {} from '...' => await import('...');
							const expressionStatement = builders.expressionStatement(dynamicImportCall)
							this.replace(expressionStatement)
						}
					} else {
						// import '...' => await import('...'); (Side effects)
						const expressionStatement = builders.expressionStatement(dynamicImportCall)
						this.replace(expressionStatement)
					}
				}
				// 移除exports
				else if (node.type === 'ExportNamedDeclaration')
					if (node.declaration)
						this.replace(node.declaration)
					else
						this.skip()

				// 添加隐式 return
				else if (
					node.type === 'Program' &&
					!node.body.some(n => n.type === 'ReturnStatement')
				) {
					const lastStatement = node.body[node.body.length - 1]
					switch (lastStatement.type) {
						case 'ExpressionStatement':
							// return a + b;
							node.body[node.body.length - 1] = builders.returnStatement(
								lastStatement.expression,
							)
							break
						case 'VariableDeclaration':
							// const a = 1; => const a = 1; return a;
							const lastDeclaration = lastStatement.declarations[lastStatement.declarations.length - 1]
							if (lastDeclaration.init && lastDeclaration.id.type === 'Identifier')
								node.body.push(builders.returnStatement(lastDeclaration.id))

							break
					}
				}
			},
		})
		/**
		 * 运行转换后的模块体，并注入参数绑定。
		 *
		 * @returns {Promise<unknown>} 求值的返回值或抛出的 rejection。
		 */
		const base_fn = () => (async x => x).constructor(...Object.keys(args), generate(ast))(...Object.values(args))
		let fn = base_fn
		try {
			// deno和node的内置 Console 的 Symbol.hasInstance 未处理 undefined 的情况
			if (args.console === undefined)
				args.console = new VirtualConsole({ realConsoleOutput: true })
			else if (!(args.console instanceof VirtualConsole))
				args.console = new VirtualConsole({ realConsoleOutput: true, baseConsole: args.console })
			/**
			 * 将求值期间的 `console` 调用路由至虚拟控制台。
			 *
			 * @returns {Promise<unknown>} 求值的返回值或抛出的 rejection。
			 */
			fn = () => args.console.hookAsyncContext(base_fn)
		} catch (error) {}
		const logsBeforeEval = args.console.outputEntries.length ?? 0
		return await fn().then(
			result => ({ result }), error => ({ error }),
		).then(result => new EvalResult({
			...result,
			outputEntries: args.console.outputEntries.slice(logsBeforeEval),
		}))
	} catch (error) {
		return new EvalResult({ error, outputEntries: [] })
	}
}
