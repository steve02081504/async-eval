import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { appendLogEntry, appendTextRow, appendValueRow } from '../log/render.mjs'

import {
	collectGlobalCandidates,
	collectPropertyNames,
	COMPLETION_LIMIT,
	enrichCompletionPayload,
	filterByCompletionPrefix,
	parseCompletionContext,
} from './completion.mjs'

/**
 * REPL 求值环境。`args` 自引用，便于在代码里用 `args.x = 1` 注入并复用绑定。
 * @type {Record<string, unknown> & { args: Record<string, unknown> }}
 */
export const sessionArgs = {}
sessionArgs.args = sessionArgs

/**
 * 创建求值会话：执行代码并把结构化结果分发到日志列表与（可选的）终端输出端，
 * 同时提供基于求值的成员/标识符补全。
 * @param {HTMLElement} logList - 结构化日志列表容器。
 * @param {import('./terminal/sink.mjs').TerminalSink} [terminal] - 可选的 xterm 输出端。
 * @returns {{ submitEval: (code: string) => Promise<void>, computeCompletion: (code: string, cursor: number) => Promise<object>, busy: boolean }} 求值与会话 API。
 */
export function createEvalSession(logList, terminal) {
	let evalInFlight = false

	/**
	 * 将一次求值结果写入日志列表并（可选地）同步到终端。
	 * @param {string} code - 用户提交的源代码。
	 * @param {import('@steve02081504/async-eval').EvalResult} evalResult - `async_eval` 返回值。
	 */
	function dispatch(code, evalResult) {
		const { result, error, outputEntries } = evalResult
		terminal?.writePromptEcho(code)
		for (const entry of outputEntries) {
			appendLogEntry(logList, entry)
			terminal?.writeLogEntry(entry)
		}
		if (error !== undefined) {
			appendValueRow(logList, 'error', error)
			terminal?.writeError(error)
		} else if ('result' in evalResult) {
			appendValueRow(logList, 'result', result)
			terminal?.writeResult(result)
		}
		terminal?.writePrompt()
	}

	/**
	 * 执行代码并把输出分发到 UI；求值进行中或空代码时忽略。
	 * @param {string} code - 待求值代码。
	 * @returns {Promise<void>}
	 */
	async function submitEval(code) {
		if (evalInFlight || !code.trim()) return
		evalInFlight = true
		try {
			appendTextRow(logList, `❯ ${code}`)
			dispatch(code, await async_eval(code, sessionArgs))
		} catch (error) {
			const message = String(error?.message ?? error)
			appendTextRow(logList, message)
			terminal?.writeRaw(`${message}\n`)
			terminal?.writePrompt()
		} finally {
			evalInFlight = false
		}
	}

	/**
	 * 根据光标位置计算补全候选项与替换区间。
	 * @param {string} code - 当前编辑器全文。
	 * @param {number} cursor - 光标在 `code` 中的偏移。
	 * @returns {Promise<{ items: string[], suffixes: string[], replaceStart: number, replaceEnd: number }>} 候选项与替换范围。
	 */
	async function computeCompletion(code, cursor) {
		const context = parseCompletionContext(code, cursor)
		if (!context)
			return enrichCompletionPayload(code, { items: [], replaceStart: cursor, replaceEnd: cursor })

		const { fragment, replaceStart, replaceEnd } = context
		if (context.kind === 'identifier')
			return enrichCompletionPayload(code, { items: collectGlobalCandidates(fragment), replaceStart, replaceEnd })

		const { result, error } = await async_eval(`(${context.receiver})`, sessionArgs)
		const items = error ? [] : filterByCompletionPrefix(fragment, collectPropertyNames(result)).slice(0, COMPLETION_LIMIT)
		return enrichCompletionPayload(code, { items, replaceStart, replaceEnd })
	}

	return {
		submitEval,
		computeCompletion,
		/**
		 * 是否有求值请求正在执行。
		 * @returns {boolean} 当前是否有进行中的求值。
		 */
		get busy() { return evalInFlight },
	}
}
