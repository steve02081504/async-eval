import { editBackspace, editInsertChar, isPairInputEvent } from './pairs.mjs'

const HISTORY_KEY = 'async-eval.repl.history'
const MAX_HISTORY = 100
const COMPLETION_DEBOUNCE_MS = 150

/** @returns {string[]} 本地存储中的历史命令列表。 */
function loadHistory() {
	try {
		const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
		return Array.isArray(stored) ? stored.slice(-MAX_HISTORY) : []
	} catch { return [] }
}

/**
 * 把现代 UI 的输入面板接到求值会话上：自动配对、语法高亮重绘、命令历史与基于求值的补全下拉。
 * @param {ReturnType<import('./panel.mjs').mountReplPanel>} panel - REPL 面板实例。
 * @param {ReturnType<import('./session.mjs').createEvalSession>} session - 求值会话实例。
 */
export function attachReplEditor(panel, session) {
	const { inputEl, completionsEl, syncInputView, setBusy } = panel

	let history = loadHistory()
	let historyIndex = -1
	let historyDraft = ''

	/** @type {string[]} */
	let completionItems = []
	/** @type {string[]} */
	let completionSuffixes = []
	let completionIndex = 0
	let completionReplaceStart = 0
	let completionReplaceEnd = 0
	let completionRequestSeq = 0
	/** @type {ReturnType<typeof setTimeout> | null} */
	let completionRefreshTimer = null
	let completionSuppressed = false

	/**
	 * 保存历史命令到本地存储。
	 */
	function saveHistory() {
		try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) }
		catch { /* localStorage 不可用/超额时忽略 */ }
	}

	/**
	 * 隐藏补全列表。
	 */
	function hideCompletions() {
		completionItems = []
		completionSuffixes = []
		completionIndex = 0
		completionsEl.classList.add('hidden')
		completionsEl.replaceChildren()
	}

	/**
	 * 取消补全刷新定时器。
	 */
	function cancelCompletionRefresh() {
		if (completionRefreshTimer === null) return
		clearTimeout(completionRefreshTimer)
		completionRefreshTimer = null
	}

	/**
	 * 当前（或指定）候选项是否带可补全的后缀。
	 * @param {number} [index] - 候选项下标，默认当前选中项。
	 * @returns {boolean} 存在非空幽灵后缀时为 `true`。
	 */
	function completionPendingSuffix(index = completionIndex) {
		return completionItems.length > 0 && Boolean(completionSuffixes[index])
	}

	/**
	 * 接受补全。
	 */
	function acceptCompletion() {
		if (!completionPendingSuffix()) {
			hideCompletions()
			return
		}
		const item = completionItems[completionIndex]
		inputEl.value = inputEl.value.slice(0, completionReplaceStart) + item + inputEl.value.slice(completionReplaceEnd)
		const caret = completionReplaceStart + item.length
		inputEl.setSelectionRange(caret, caret)
		hideCompletions()
		syncInputView()
		scheduleCompletionRefresh()
	}

	/**
	 * 显示补全列表。
	 */
	function showCompletions() {
		completionsEl.replaceChildren()
		if (!completionItems.length) {
			hideCompletions()
			return
		}
		completionsEl.classList.remove('hidden')
		completionItems.forEach((candidate, index) => {
			const button = document.createElement('button')
			button.type = 'button'
			button.className = `block w-full text-left px-2 py-0.5 rounded${index === completionIndex ? ' bg-primary text-primary-content' : ''}`
			button.textContent = candidate
			button.addEventListener('mousedown', event => {
				event.preventDefault()
				completionIndex = index
				acceptCompletion()
			})
			const item = document.createElement('li')
			item.className = 'block w-full'
			item.appendChild(button)
			completionsEl.appendChild(item)
		})
	}

	/**
	 * 请求补全。
	 */
	async function requestCompletion() {
		const seq = ++completionRequestSeq
		const code = inputEl.value
		const cursor = inputEl.selectionStart ?? code.length
		try {
			const result = await session.computeCompletion(code, cursor)
			if (seq !== completionRequestSeq) return
			if (code !== inputEl.value || cursor !== (inputEl.selectionStart ?? inputEl.value.length)) return
			completionItems = result.items
			completionSuffixes = result.suffixes
			completionReplaceStart = result.replaceStart
			completionReplaceEnd = result.replaceEnd
			completionIndex = 0
			if (completionItems.length === 1 && !completionPendingSuffix(0)) hideCompletions()
			else showCompletions()
		} catch {
			if (seq === completionRequestSeq) hideCompletions()
		}
	}

	/**
	 * 调度补全刷新。
	 */
	function scheduleCompletionRefresh() {
		completionSuppressed = false
		cancelCompletionRefresh()
		completionRefreshTimer = setTimeout(() => {
			completionRefreshTimer = null
			if (completionSuppressed) return
			if (inputEl.value) requestCompletion()
			else hideCompletions()
		}, COMPLETION_DEBOUNCE_MS)
	}

	/**
	 * 处理提交。
	 */
	async function handleSubmit() {
		if (session.busy) return
		cancelCompletionRefresh()
		completionSuppressed = false
		hideCompletions()
		const code = inputEl.value.trim()
		if (!code) return
		if (history.at(-1) !== code) {
			history = [...history, code].slice(-MAX_HISTORY)
			saveHistory()
		}
		historyIndex = -1
		historyDraft = ''
		setBusy(true)
		try {
			await session.submitEval(code)
		} finally {
			setBusy(false)
			inputEl.value = ''
			syncInputView()
		}
	}

	inputEl.addEventListener('beforeinput', event => {
		if (!isPairInputEvent(event)) return
		const start = inputEl.selectionStart ?? 0
		if (start !== (inputEl.selectionEnd ?? start)) return
		if (event.inputType === 'insertText' && event.data?.length === 1) {
			const next = editInsertChar(inputEl.value, start, event.data)
			if (next.value === inputEl.value.slice(0, start) + event.data + inputEl.value.slice(start)
				&& next.caret === start + event.data.length) return
			event.preventDefault()
			inputEl.value = next.value
			inputEl.setSelectionRange(next.caret, next.caret)
			inputEl.dispatchEvent(new Event('input', { bubbles: true }))
		} else if (event.inputType === 'deleteContentBackward') {
			const next = editBackspace(inputEl.value, start)
			if (!next) return
			event.preventDefault()
			inputEl.value = next.value
			inputEl.setSelectionRange(next.caret, next.caret)
			inputEl.dispatchEvent(new Event('input', { bubbles: true }))
		}
	})

	inputEl.addEventListener('input', event => {
		syncInputView()
		historyIndex = -1
		if (!event.isComposing) scheduleCompletionRefresh()
	})

	inputEl.addEventListener('blur', () => {
		cancelCompletionRefresh()
		hideCompletions()
	})

	inputEl.addEventListener('keydown', event => {
		if (event.isComposing || event.keyCode === 229) return

		if (event.key === 'Tab') {
			event.preventDefault()
			if (completionItems.length) completionPendingSuffix() ? acceptCompletion() : hideCompletions()
			return
		}
		if (event.key === 'Escape') {
			if (completionItems.length || completionSuppressed) {
				completionSuppressed = true
				cancelCompletionRefresh()
				hideCompletions()
			}
			return
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			handleSubmit()
			return
		}
		if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && completionItems.length > 1) {
			event.preventDefault()
			const step = event.key === 'ArrowUp' ? -1 : 1
			completionIndex = (completionIndex + step + completionItems.length) % completionItems.length
			showCompletions()
			return
		}
		if (event.key === 'ArrowUp' && !completionItems.length) {
			if (inputEl.value.slice(0, inputEl.selectionStart ?? 0).includes('\n') || !history.length) return
			event.preventDefault()
			if (historyIndex === -1) historyDraft = inputEl.value
			historyIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
			inputEl.value = history[historyIndex]
			syncInputView()
			scheduleCompletionRefresh()
			return
		}
		if (event.key === 'ArrowDown' && !completionItems.length) {
			if (inputEl.value.slice(inputEl.selectionEnd ?? inputEl.value.length).includes('\n') || historyIndex === -1) return
			event.preventDefault()
			if (historyIndex >= history.length - 1) {
				historyIndex = -1
				inputEl.value = historyDraft
			} else {
				historyIndex++
				inputEl.value = history[historyIndex]
			}
			syncInputView()
			scheduleCompletionRefresh()
		}
	})
}
