import type { LogEntry } from '@steve02081504/virtual-console'

/** 构造 {@link EvalResult} 时可传入的初始字段。 */
export interface EvalResultFields {
	/** 求值成功时的返回值。 */
	result?: unknown
	/** 求值失败时的错误对象。 */
	error?: Error
	/** 本次求值捕获的结构化日志条目（仅含本次调用产生的条目）。 */
	outputEntries?: LogEntry[]
}

/**
 * 单次 `async_eval` 调用的结果：返回值、错误与捕获的日志条目。
 */
export class EvalResult {
	result?: unknown
	error?: Error
	outputEntries: LogEntry[]

	constructor(fields?: EvalResultFields)

	/** 从 `outputEntries` 聚合的纯文本/ANSI 文本。 */
	get output(): string

	/** 从 `outputEntries` 聚合的 HTML。 */
	get outputHtml(): string
}
