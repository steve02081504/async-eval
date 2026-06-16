import { renderAnsi, serializeArgSnapshot } from 'https://esm.sh/@steve02081504/virtual-console/browser'

import { highlightAnsi } from '../highlight.mjs'

/**
 * @typedef {object} TerminalSink
 * @property {(code: string) => void} writePromptEcho
 * @property {(entry: import('@steve02081504/virtual-console').LogEntry) => void} writeLogEntry
 * @property {(value: unknown) => void} writeResult
 * @property {(error: unknown) => void} writeError
 * @property {(text: string) => void} writeRaw
 * @property {() => void} writePrompt
 */

const ANSI = {
	reset: '\x1b[0m',
	accent: '\x1b[36m',
	error: '\x1b[31m',
}

const RESULT_INDENT = '  '
const RESULT_MAX_DEPTH = 6

/**
 * xterm 将裸 `\n` 当作 LF（列不变），多行输出会错位；统一规范为 CRLF。
 * @param {import('https://esm.sh/xterm').Terminal} terminal - 目标 xterm 实例。
 * @param {string} text - 待写入的文本（可含 `\n`）。
 */
function writeMultiline(terminal, text) {
	terminal.write(text.replace(/\r?\n/g, '\r\n'))
}

/**
 * 写入多行文本并在末尾追加 CRLF 换行。
 * @param {import('https://esm.sh/xterm').Terminal} terminal - 目标 xterm 实例。
 * @param {string} text - 待写入的文本。
 */
function writelnMultiline(terminal, text) {
	writeMultiline(terminal, text)
	terminal.write('\r\n')
}

/**
 * 创建终端 UI 的输出端：把一次求值的回显、日志、结果、错误写入 xterm。
 * @param {import('https://esm.sh/xterm').Terminal} terminal - 绑定的 xterm 实例。
 * @returns {TerminalSink} 终端写入方法集合。
 */
export function createTerminalSink(terminal) {
	return {
		/**
		 * 原地擦除当前输入行，将提交的代码回显为带高亮的 `❯`/`…` 块。
		 * @param {string} code - 用户提交的源代码。
		 */
		writePromptEcho(code) {
			const lines = code.split('\n')
			terminal.write('\r\x1b[2K')
			for (let index = 0; index < lines.length; index++)
				terminal.writeln(`${ANSI.accent}${index === 0 ? '❯' : '…'}${ANSI.reset} ${highlightAnsi(lines[index])}`)
		},
		/** 写出新的输入提示符（一次求值展示结束后）。 */
		writePrompt() {
			terminal.write('> ')
		},
		/**
		 * 将 VirtualConsole 日志条目写入终端。
		 * @param {import('@steve02081504/virtual-console').LogEntry} entry - 日志条目。
		 */
		writeLogEntry(entry) {
			writelnMultiline(terminal, entry.toString().replace(/\n$/, ''))
		},
		/**
		 * 将求值结果以 ANSI 着色形式写入终端。
		 * @param {unknown} value - 求值返回值。
		 */
		writeResult(value) {
			const ansi = renderAnsi(
				[{ kind: 'value', snapshot: serializeArgSnapshot(value, { maxDepth: RESULT_MAX_DEPTH }) }],
				{ indent: RESULT_INDENT, colorize: true },
			)
			writelnMultiline(terminal, `${ANSI.accent}←${ANSI.reset} ${ansi}`)
		},
		/**
		 * 将错误堆栈或消息写入终端。
		 * @param {unknown} error - 捕获的错误对象或值。
		 */
		writeError(error) {
			writelnMultiline(terminal, `${ANSI.error}✖${ANSI.reset} ${error instanceof Error ? error.stack || error.message : String(error)}`)
		},
		/**
		 * 原样写入原始文本（不附加提示符或前缀）。
		 * @param {string} text - 原始输出文本。
		 */
		writeRaw(text) {
			writeMultiline(terminal, text)
		},
	}
}
