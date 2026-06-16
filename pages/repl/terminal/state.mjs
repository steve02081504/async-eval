import { highlightAnsi } from '../highlight.mjs'

const PROMPT_WIDTH = 2 // '> ' 的可见宽度

/**
 * 终端 UI 的单行输入状态：维护当前行、光标位置与命令历史，并负责重绘输入行。
 */
export class TerminalState {
	#terminal
	currentLine = ''
	cursor = 0
	#history = []
	#historyIndex = -1

	/**
	 * @param {import('https://esm.sh/xterm').Terminal} terminal - 绑定的 xterm 实例。
	 */
	constructor(terminal) {
		this.#terminal = terminal
	}

	/** 清空输入状态，但不重绘（提交后由回显接管当前行）。 */
	reset() {
		this.currentLine = ''
		this.cursor = 0
		this.#historyIndex = -1
	}

	/** 将非重复命令追加到历史记录。
	 * @param {string} input - 已提交的完整输入行。
	 */
	addToHistory(input) {
		if (this.#history.at(-1) !== input) this.#history.push(input)
	}

	/** 按方向翻阅历史命令并重绘输入行。
	 * @param {'up' | 'down'} direction - 翻阅方向。
	 */
	recallHistory(direction) {
		if (direction === 'up' && this.#history.length) {
			if (this.#historyIndex === -1) this.#historyIndex = this.#history.length - 1
			else if (this.#historyIndex > 0) this.#historyIndex--
		} else if (direction === 'down' && this.#historyIndex >= 0)
			this.#historyIndex = this.#historyIndex < this.#history.length - 1 ? this.#historyIndex + 1 : -1

		this.currentLine = this.#historyIndex === -1 ? '' : this.#history[this.#historyIndex]
		this.cursor = this.currentLine.length
		this.refreshTerminalLine()
	}

	/** 按当前行内容与光标位置重绘终端输入行（含 ANSI 高亮）。 */
	refreshTerminalLine() {
		this.#terminal.write(`\r\x1b[2K\x1b[0m> ${highlightAnsi(this.currentLine)}\x1b[${PROMPT_WIDTH + this.cursor + 1}G`)
	}

	/** 左右移动光标并重绘输入行。
	 * @param {'left' | 'right'} direction - 移动方向。
	 */
	moveCursor(direction) {
		this.cursor = Math.max(0, Math.min(this.cursor + (direction === 'left' ? -1 : 1), this.currentLine.length))
		this.refreshTerminalLine()
	}

	/** 删除光标左侧一个字符并重绘输入行。 */
	deleteCharLeft() {
		if (this.cursor === 0) return
		this.currentLine = this.currentLine.slice(0, this.cursor - 1) + this.currentLine.slice(this.cursor)
		this.cursor--
		this.refreshTerminalLine()
	}

	/**
	 * 在光标处插入文本并重绘（粘贴/打字共用，换行折叠为空格保持单行）。
	 * @param {string} text - 待插入的文本。
	 */
	insertText(text) {
		const flattened = text.replace(/\r?\n/g, ' ')
		if (!flattened) return
		this.currentLine = this.currentLine.slice(0, this.cursor) + flattened + this.currentLine.slice(this.cursor)
		this.cursor += flattened.length
		this.refreshTerminalLine()
	}
}
