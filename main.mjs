import { generate } from './deps/astring.mjs'
import { VirtualConsole } from './deps/@steve02081504/virtual-console.mjs'
import { EvalResult } from './lib/eval_result.mjs'
import { parseEvalProgram, transformEvalAst } from './lib/ast.mjs'
import { scriptPolicy } from './lib/script_policy.mjs'

export { EvalResult } from './lib/eval_result.mjs'

/**
 * 异步求值 JavaScript 代码，支持可选参数注入与虚拟控制台输出捕获。
 *
 * @param {string} code - 待求值的 JavaScript 代码。
 * @param {object} [args={}] - 注入求值环境的变量与 `console`。
 * @returns {Promise<import('./lib/eval_result.mjs').EvalResult>}
 */
export async function async_eval(code, args = {}) {
	try {
		const ast = transformEvalAst(parseEvalProgram(code))
		/**
		 * 运行转换后的模块体，并注入参数绑定。
		 *
		 * @returns {Promise<unknown>} 求值的返回值或抛出的 rejection。
		 */
		const base_fn = () => (async x => x).constructor(
			...Object.keys(args),
			scriptPolicy.createScript(generate(ast)),
		)(...Object.values(args))
		let fn = base_fn
		try {
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
		} catch {}
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
