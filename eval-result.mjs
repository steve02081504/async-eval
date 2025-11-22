/**
 * 虚拟控制台日志条目。
 * @typedef {import('@steve02081504/virtual-console').LogEntry} LogEntry
 */

/**
 * 单次 `async_eval` 调用的结果：返回值、错误与捕获的日志条目。
 */
export class EvalResult {
	/**
	 * @param {{ result?: any; error?: Error; outputEntries?: LogEntry[] }} [fields={}] - 初始结果字段。
	 */
	constructor(fields = {}) {
		Object.assign(this, fields)
	}

	/** @returns {string} 从 `outputEntries` 聚合的纯文本/ANSI 文本。 */
	get output() {
		return this.outputEntries.map(entry => entry.toString()).join('')
	}

	/** @returns {string} 从 `outputEntries` 聚合的 HTML。 */
	get outputHtml() {
		return this.outputEntries.map(entry => entry.toHtml()).join('')
	}
}
