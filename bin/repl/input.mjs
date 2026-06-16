import process from 'node:process'
import readline from 'node:readline'

import { editBackspace, editInsertChar } from '../../lib/repl/pairs.mjs'

const { stdin: input, stdout: output } = process

const PROMPT_PRIMARY = '\x1b[36mae>\x1b[0m '
const PROMPT_CONT = '\x1b[90m...\x1b[0m '
const PROMPT_WIDTH = 4 // 'ae> ' / '... ' 的可见宽度

/** 输入流结束（管道关闭 / 空行 Ctrl+C）。 */
export const EOF = Symbol('eof')
/** Ctrl+C 且当前行有内容：丢弃输入、回到全新提示符。 */
const CANCEL = Symbol('cancel')
/** Ctrl+C 且当前行为空：空提示符时退出，多行编辑中则取消该次输入。 */
const INTERRUPT = Symbol('interrupt')

/**
 * 历史项压平为单行（续行 `\n` 转空格），便于在单行编辑器中回溯。
 *
 * @param {string} entry - 历史记录原文（可含换行）。
 * @returns {string} 压平后的单行文本。
 */
const flattenHistory = entry => entry.replace(/\n/g, ' ')

/**
 * TTY 原始模式单行编辑器：随输入实时高亮，支持光标移动与历史回溯。
 *
 * 行宽超出终端列数时会换行，绝对列定位（`\x1b[…G`）将失准；REPL 输入通常较短，
 * 多行请用行末 `\` 续行。
 * @param {string} prompt - 提示符（含 ANSI），可见宽度恒为 {@link PROMPT_WIDTH}。
 * @param {(code: string) => string} highlightJs - 高亮函数。
 * @param {string[]} history - 共享历史（最新在末尾）。
 * @returns {Promise<string | typeof EOF | typeof CANCEL | typeof INTERRUPT>} 行内容或控制符号。
 */
function readRawLine(prompt, highlightJs, history) {
	return new Promise(resolve => {
		let buffer = ''
		let cursor = 0
		let historyIndex = history.length
		let draft = ''

		/**
		 * 重绘当前行：清屏、提示符、高亮内容与光标定位。
		 * @returns {void}
		 */
		const render = () => {
			output.write('\r\x1b[2K' + prompt + highlightJs(buffer) + `\x1b[${PROMPT_WIDTH + cursor + 1}G`)
		}
		/** @param {string | typeof EOF | typeof CANCEL | typeof INTERRUPT} value - 结束读行并返回的值。 */
		const finish = value => {
			input.off('data', onData)
			output.write('\r\n')
			resolve(value)
		}
		/** @param {number} delta - 历史索引偏移（-1 上一条，+1 下一条）。 */
		const recall = delta => {
			const next = historyIndex + delta
			if (next < 0 || next > history.length) return
			if (historyIndex === history.length) draft = buffer
			historyIndex = next
			buffer = next === history.length ? draft : flattenHistory(history[next])
			cursor = buffer.length
			render()
		}
		/** @param {string} sequence - ESC 转义序列（方向键、Home/End、Delete 等）。 */
		const handleEscape = sequence => {
			if ((sequence === '\x1b[D' || sequence === '\x1bOD') && cursor > 0) { cursor--; render() }
			else if ((sequence === '\x1b[C' || sequence === '\x1bOC') && cursor < buffer.length) { cursor++; render() }
			else if (sequence === '\x1b[A') recall(-1)
			else if (sequence === '\x1b[B') recall(1)
			else if (sequence === '\x1b[H' || sequence === '\x1b[1~') { cursor = 0; render() }
			else if (sequence === '\x1b[F' || sequence === '\x1b[4~') { cursor = buffer.length; render() }
			else if (sequence === '\x1b[3~' && cursor < buffer.length) { buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1); render() }
		}
		/** @param {string} chunk - stdin 原始输入块。 */
		const onData = chunk => {
			for (let index = 0; index < chunk.length; index++) {
				const char = chunk[index]
				if (char === '\x1b') {
					if (chunk[index + 1] === '[' || chunk[index + 1] === 'O') {
						let end = index + 2
						while (end < chunk.length && !/[A-Za-z~]/.test(chunk[end])) end++
						handleEscape(chunk.slice(index, end + 1))
						index = end
					}
					continue
				}
				if (char === '\r' || char === '\n') {
					if (char === '\r' && chunk[index + 1] === '\n') index++
					finish(buffer)
					return
				}
				if (char === '\x03') { finish(buffer ? CANCEL : INTERRUPT); return }
				if (char === '\x7f' || char === '\b') {
					const next = editBackspace(buffer, cursor)
					if (next) { buffer = next.value; cursor = next.caret; render() }
					continue
				}
				if (char === '\x01') { cursor = 0; render(); continue } // Ctrl+A
				if (char === '\x05') { cursor = buffer.length; render(); continue } // Ctrl+E
				if (char === '\x15') { buffer = buffer.slice(cursor); cursor = 0; render(); continue } // Ctrl+U
				if (char >= ' ') {
					const next = editInsertChar(buffer, cursor, char)
					buffer = next.value
					cursor = next.caret
					render()
				}
			}
		}

		input.on('data', onData)
		render()
	})
}

/**
 * REPL 输入控制器。
 * @typedef {object} ReplInput
 * @property {(highlightJs: (code: string) => string) => Promise<string | typeof EOF>} readMultiline
 * @property {() => void} close
 */

/**
 * 创建 REPL 输入控制器。TTY 走原始模式实时高亮编辑器；非 TTY（管道）逐行读取并回显。
 * @returns {ReplInput} 含 `readMultiline` 与 `close` 的输入控制器。
 */
export function createInput() {
	const isTTY = Boolean(input.isTTY)
	/** @type {string[]} */
	const history = []
	/** @type {readline.Interface | null} */
	let lineReader = null
	/** @type {AsyncIterator<string> | null} */
	let lineIterator = null

	if (isTTY) {
		input.setRawMode(true)
		input.setEncoding('utf8')
		input.resume()
	} else {
		lineReader = readline.createInterface({ input })
		lineIterator = lineReader[Symbol.asyncIterator]()
	}

	/**
	 * 读取一行输入：TTY 走原始模式编辑器，非 TTY 走 readline。
	 *
	 * @param {string} prompt - 提示符（含 ANSI）。
	 * @param {(code: string) => string} highlightJs - 高亮函数。
	 * @returns {Promise<string | typeof EOF | typeof CANCEL | typeof INTERRUPT>} 行内容或控制符号。
	 */
	async function nextLine(prompt, highlightJs) {
		if (isTTY) return readRawLine(prompt, highlightJs, history)
		const { value, done } = await lineIterator.next()
		if (done) return EOF
		output.write(prompt + highlightJs(value) + '\n')
		return value
	}

	/**
	 * 读取一次完整输入：Enter 提交；行末 `\` 续行；Ctrl+C 取消当前输入（空行时退出）。
	 * @param {(code: string) => string} highlightJs - 高亮函数。
	 * @returns {Promise<string | typeof EOF>} 完整代码或 EOF。
	 */
	async function readMultiline(highlightJs) {
		/** @type {string[]} */
		const lines = []
		while (true) {
			const prompt = lines.length ? PROMPT_CONT : PROMPT_PRIMARY
			const line = await nextLine(prompt, highlightJs)
			if (line === EOF) return EOF
			if (line === CANCEL) { lines.length = 0; continue }
			if (line === INTERRUPT) {
				if (lines.length) { lines.length = 0; continue }
				return EOF
			}
			if (line.endsWith('\\')) { lines.push(line.slice(0, -1)); continue }
			lines.push(line)
			const code = lines.join('\n')
			if (code.trim() && history[history.length - 1] !== code) history.push(code)
			return code
		}
	}

	/**
	 * 恢复 stdin 并关闭 readline（非 TTY）。
	 * @returns {void}
	 */
	function close() {
		if (isTTY) {
			try { input.setRawMode(false) } catch { /* 已退出 raw 模式时忽略 */ }
			input.pause()
		} else
			lineReader?.close()
	}

	return { readMultiline, close }
}
