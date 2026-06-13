#!/usr/bin/env node
/**
 * 交互式 async-eval REPL：每行输入经 `async_eval` 求值，展示返回值、错误与 VirtualConsole 捕获。
 *
 * 用法（仓库根目录）：
 *   `npm run repl`
 *   `node scripts/repl.mjs`
 *
 * 与 `async_eval` 相同的能力：顶层 await、静态 import、隐式 return、虚拟 console 捕获。
 *
 * 每次求值后分块打印：
 *   - captured console (ANSI) — `output`
 *   - captured console (plain) — 各 `LogEntry#toPlainText()` 拼接
 *   - captured console (HTML) — `outputHtml`
 *   - error — 求值或解析失败时
 *   - result — `util.inspect` 彩色格式化
 *
 * REPL 上下文变量 `args` 对应 `async_eval` 的第二个参数，可注入求值绑定，例如 `args.x = 1`。
 * 退出：`.exit` 或 Ctrl+D。
 *
 * @see README.md#interactive-repl
 */

import repl from 'node:repl'
import util from 'node:util'

import { async_eval } from '../main.mjs'

/** @type {(...args: unknown[]) => void} */
const nativeLog = console.log.bind(console)

const HEADER = {
	result: '\x1b[1;32m━━ result ━━\x1b[0m',
	error: '\x1b[1;31m━━ error ━━\x1b[0m',
	output: '\x1b[1;36m━━ captured console (ANSI) ━━\x1b[0m',
	outputPlain: '\x1b[1;36m━━ captured console (plain) ━━\x1b[0m',
	outputHtml: '\x1b[1;36m━━ captured console (HTML) ━━\x1b[0m',
	inspect: '\x1b[1;35m━━ util.inspect (colors) ━━\x1b[0m',
}

const inspectOptions = {
	colors: true,
	depth: 12,
	maxArrayLength: 50,
	maxStringLength: 2000,
}

/**
 * 打印单次 `async_eval` 的 `EvalResult` 各视图。
 * @param {import('../eval-result.mjs').EvalResult} evalResult - 求值结果。
 */
function displayEvalResult(evalResult) {
	const { result, error, outputEntries, output, outputHtml } = evalResult

	if (output) {
		nativeLog(HEADER.output)
		nativeLog(output)
		nativeLog(HEADER.outputPlain)
		nativeLog(outputEntries.map(entry => entry.toPlainText()).join(''))
		nativeLog(HEADER.outputHtml)
		nativeLog(outputHtml)
	}

	if (error) {
		nativeLog(HEADER.error)
		nativeLog(error)
		return
	}

	if (result !== undefined) {
		nativeLog(HEADER.result)
		nativeLog(util.inspect(result, inspectOptions))
	}
}

nativeLog('\x1b[1masync-eval REPL\x1b[0m')
nativeLog('· 输入表达式或语句：支持顶层 await、import、隐式 return 与 console 捕获。')
nativeLog('· 修改 \x1b[33margs\x1b[0m 可注入求值环境变量（如 `args.x = 1`）。')
nativeLog('· 退出：\x1b[33m.exit\x1b[0m 或 Ctrl+D。\n')

const r = repl.start({
	prompt: 'ae> ',
	/**
	 * 将 REPL 输入交给 `async_eval`，并在终端打印结构化结果。
	 * @param {string} cmd - 用户输入。
	 * @param {Record<string, unknown>} context - REPL 上下文。
	 * @param {string} filename - 求值文件名。
	 * @param {(err: Error | null, result?: unknown) => void} callback - 完成回调。
	 */
	eval: (cmd, context, filename, callback) => {
		async_eval(cmd, context.args).then(
			(evalResult) => {
				displayEvalResult(evalResult)
				callback(null, evalResult.error ? undefined : evalResult.result)
			},
			error => callback(error),
		)
	},
	/**
	 * REPL 返回值展示：详细输出已由 `displayEvalResult` 打印。
	 * @returns {string} 简短提示。
	 */
	writer: () => '\x1b[2m(see blocks above)\x1b[0m',
})

r.context.args = {}
