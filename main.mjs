import { generate } from 'astring'
import { VirtualConsole } from '@steve02081504/virtual-console'
import { EvalResult } from './lib/eval_result.mjs'
import { parseEvalProgram, transformEvalAst } from './lib/ast.mjs'
import { runInAsyncFunction } from './lib/eval_runner.mjs'
import { scriptPolicy } from './lib/script_policy.mjs'

// Deno 下安装原生模块解析钩子
if (globalThis.Deno) await import('./lib/deno/register_hooks.mjs')

export { EvalResult } from './lib/eval_result.mjs'

/**
 * 把传入的 `console` 归一为 `VirtualConsole`：未提供时新建，已是实例时复用，
 * 其余值作为 `baseConsole` 包裹，以便统一捕获输出。
 *
 * @param {unknown} console - 调用方传入的 `console`（可能未定义或为任意对象）。
 * @returns {VirtualConsole} 可用于捕获输出的虚拟控制台。
 */
function toVirtualConsole(console) {
	console ??= new VirtualConsole({ realConsoleOutput: true })
	if (console instanceof VirtualConsole) return console
	return new VirtualConsole({ realConsoleOutput: true, baseConsole: console })
}

/**
 * 异步求值 JavaScript 代码，支持可选参数注入与虚拟控制台输出捕获。
 *
 * @param {string} code - 待求值的 JavaScript 代码。
 * @param {object} [args={}] - 注入求值环境的变量与 `console`。
 * @returns {Promise<import('./lib/eval_result.mjs').EvalResult>}
 */
export async function async_eval(code, args = {}) {
	try {
		const source = scriptPolicy.createScript(generate(transformEvalAst(parseEvalProgram(code))))

		const console = args.console = toVirtualConsole(args.console)
		const logsBeforeEval = console.outputEntries.length

		const outcome = await console.hookAsyncContext(
			() => runInAsyncFunction(source, args)
		).then(
			result => ({ result }),
			error => ({ error })
		)

		return new EvalResult({
			...outcome,
			outputEntries: console.outputEntries.slice(logsBeforeEval),
		})
	} catch (error) {
		return new EvalResult({ error, outputEntries: [] })
	}
}
