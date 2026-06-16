import { ClipboardAddon } from 'https://esm.sh/@xterm/addon-clipboard'
import { FitAddon } from 'https://esm.sh/@xterm/addon-fit'
import { WebLinksAddon } from 'https://esm.sh/@xterm/addon-web-links'
import { Terminal } from 'https://esm.sh/xterm'

import { appendTextRow } from './log/render.mjs'
import { createLogToolbar, rowMatchesFilter } from './log/toolbar.mjs'
import { attachReplEditor } from './repl/editor.mjs'
import { onHighlighterReady } from './repl/highlight.mjs'
import { mountReplPanel } from './repl/panel.mjs'
import { createEvalSession } from './repl/session.mjs'
import { createTerminalSink } from './repl/terminal/sink.mjs'
import { TerminalState } from './repl/terminal/state.mjs'

const WELCOME = 'async-eval browser REPL — code runs locally via esm.sh. Try: 1 + 1'

const elements = {
	uiToggle: document.getElementById('ui-toggle'),
	modernUI: document.getElementById('modern-ui'),
	terminalUI: document.getElementById('terminal-ui'),
	logList: document.getElementById('log-list'),
	logToolbar: document.getElementById('log-toolbar-container'),
	replPanel: document.getElementById('repl-panel'),
	terminalContainer: document.getElementById('terminal-container'),
}

/** @type {HTMLElement[]} */
const allRows = []
let logFilterText = ''
let logLevelFilter = 'all'

const terminal = new Terminal({
	cursorBlink: true,
	allowTransparency: true,
	theme: { background: 'rgba(0,0,0,0)' },
	cursorStyle: 'underline',
	fontFamily: '\'Cascadia Code\', \'Fira Code\', ui-monospace, Consolas, monospace',
	fontSize: 13,
	linkHandler: {
		/**
		 * xterm 链接点击：左键在新标签页打开 URL。
		 * @param {MouseEvent} event - 指针事件。
		 * @param {string} text - 链接 URL。
		 */
		activate(event, text) {
			if (event.button === 2) return
			event.preventDefault()
			window.open(text, '_blank')
		},
	},
})
const fitAddon = new FitAddon()
terminal.loadAddon(fitAddon)
terminal.loadAddon(new WebLinksAddon())
terminal.loadAddon(new ClipboardAddon())
terminal.open(elements.terminalContainer)

const evalSession = createEvalSession(elements.logList, createTerminalSink(terminal))
const terminalState = new TerminalState(terminal)

const panel = mountReplPanel(elements.replPanel, {
	placeholder: 'JavaScript — top-level await, import, implicit return…',
	hint: 'enter run · shift+enter newline · args.x = 1 to inject bindings',
})
attachReplEditor(panel, evalSession)

createLogToolbar(elements.logToolbar, {
	/** 清空日志并恢复欢迎文案。 */
	onClear: () => {
		allRows.length = 0
		elements.logList.replaceChildren()
		terminal.clear()
		showWelcome()
	},
	/**
	 * 更新日志过滤条件并立即重绘可见行。
	 * @param {string} text - 文本过滤关键字。
	 * @param {string} level - 级别过滤（`all` 表示全部）。
	 */
	onFilter: (text, level) => {
		logFilterText = text
		logLevelFilter = level
		for (const row of allRows) applyRowFilter(row)
	},
})

/**
 * 按当前过滤条件显示或隐藏单行日志。
 * @param {HTMLElement} row - 日志行元素。
 */
function applyRowFilter(row) {
	row.style.display = rowMatchesFilter(row, logFilterText, logLevelFilter) ? '' : 'none'
}

// 日志渲染器直接 appendChild 到列表；在此拦截以登记行并即时套用当前过滤。
const appendRowToList = elements.logList.appendChild.bind(elements.logList)
/**
 * 拦截 `appendChild`：登记新行并套用当前过滤。
 * @param {Node} row - 待追加的日志行。
 * @returns {Node} 追加后的节点（与原生 `appendChild` 一致）。
 */
elements.logList.appendChild = row => {
	allRows.push(row)
	applyRowFilter(row)
	return appendRowToList(row)
}

/** 在日志区与终端写入欢迎语与空提示行。 */
function showWelcome() {
	appendTextRow(elements.logList, WELCOME)
	terminal.writeln(WELCOME)
	terminal.writeln('')
	terminal.write('> ')
}

/** 在现代 UI 与终端 UI 之间切换，并聚焦当前面板。 */
function switchUI() {
	const isTerminal = elements.uiToggle.checked
	elements.modernUI.classList.toggle('active-ui', !isTerminal)
	elements.modernUI.classList.toggle('inactive-ui', isTerminal)
	elements.terminalUI.classList.toggle('active-ui', isTerminal)
	elements.terminalUI.classList.toggle('inactive-ui', !isTerminal)
	if (isTerminal) {
		setTimeout(() => fitAddon.fit(), 100)
		terminal.focus()
	} else
		panel.focus()
}

/**
 * 提交当前终端输入行并触发求值。
 * @returns {Promise<void>}
 */
async function terminalSubmit() {
	const input = terminalState.currentLine
	terminalState.reset()
	if (!input.trim()) return terminal.write('\r\n> ')
	terminalState.addToHistory(input)
	await evalSession.submitEval(input)
}

/** 复制终端选区（无选区则复制当前输入行）。 */
async function copyTerminalSelection() {
	const text = terminal.getSelection() || terminalState.currentLine
	if (text) await navigator.clipboard.writeText(text)
	terminal.clearSelection()
}

/** 将剪贴板内容粘贴到当前输入行。 */
async function pasteToTerminal() {
	try {
		terminalState.insertText(await navigator.clipboard.readText())
	} catch { /* 剪贴板不可用时忽略 */ }
}

/**
 * 处理终端按键：回车提交、Ctrl+C/V、方向键与退格等。
 * @param {string} key - xterm 键序列。
 * @param {KeyboardEvent} domEvent - 原始 DOM 键盘事件。
 * @returns {boolean} 已消费该按键时为 `true`。
 */
function handleTerminalKey(key, domEvent) {
	if (domEvent.key === 'Insert') return false
	if (key === '\r' && !domEvent.shiftKey) { terminalSubmit(); return true }
	if (key === '\x03') { copyTerminalSelection(); return true } // Ctrl+C
	if (key === '\x16') { pasteToTerminal(); return true } // Ctrl+V
	if (key === '\x1b[D') { terminalState.moveCursor('left'); return true }
	if (key === '\x1b[C') { terminalState.moveCursor('right'); return true }
	if (key === '\x1b[A') { terminalState.recallHistory('up'); return true }
	if (key === '\x1b[B') { terminalState.recallHistory('down'); return true }
	if (domEvent.key === 'Backspace') { terminalState.deleteCharLeft(); return true }
	if (key.charCodeAt(0) >= 32 || key === '\n') { terminalState.insertText(key); return true }
	return false
}

terminal.onKey(event => handleTerminalKey(event.key, event.domEvent))
terminal.element?.addEventListener('contextmenu', event => {
	event.preventDefault()
	if (terminal.hasSelection()) copyTerminalSelection()
	else pasteToTerminal()
})
elements.uiToggle.addEventListener('change', switchUI)
window.addEventListener('resize', () => { if (elements.uiToggle.checked) fitAddon.fit() })
onHighlighterReady(() => terminalState.refreshTerminalLine())

switchUI()
showWelcome()
panel.focus()
