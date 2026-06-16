import { highlightHtml, onHighlighterReady } from './highlight.mjs'

/**
 * 构建现代 UI 的 REPL 输入面板（行框、行号槽、高亮层、textarea、补全列表）。
 * @param {HTMLElement} container - 挂载面板的 DOM 容器。
 * @param {{ placeholder?: string, hint?: string }} [options] - 占位符与底部提示文案。
 * @returns {{
 *   inputEl: HTMLTextAreaElement,
 *   completionsEl: HTMLUListElement,
 *   syncInputView: () => void,
 *   setBusy: (busy: boolean) => void,
 *   focus: () => void,
 * }} 面板控件与同步/焦点方法。
 */
export function mountReplPanel(container, { placeholder = '', hint = '' } = {}) {
	container.innerHTML = `\
<div class="repl-frame-top">
	<span class="repl-frame-corner">╭─</span>
	<span class="repl-frame-label">js</span>
	<span class="repl-frame-line"></span>
	<span class="repl-frame-busy">⋯</span>
	<span class="repl-frame-corner-end">╮</span>
</div>
<div class="repl-input-area">
	<div class="repl-editor-wrap">
		<div class="repl-editor">
			<div class="repl-gutter"></div>
			<div class="repl-stack">
				<pre class="repl-highlight" aria-hidden="true"></pre>
				<textarea id="repl-input" class="repl-input-edit" rows="1" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="${placeholder}"></textarea>
			</div>
		</div>
	</div>
	<ul id="repl-completions" class="repl-completions hidden"></ul>
</div>
<div class="repl-frame-bottom">
	<span class="repl-frame-corner">╰</span>
	<span class="repl-frame-line"></span>
	<span class="repl-frame-hint">${hint}</span>
	<span class="repl-frame-line"></span>
	<span class="repl-frame-corner-end">╯</span>
</div>
`

	const gutter = container.querySelector('.repl-gutter')
	const stack = container.querySelector('.repl-stack')
	const highlightEl = container.querySelector('.repl-highlight')
	const inputEl = container.querySelector('#repl-input')
	const completionsEl = container.querySelector('#repl-completions')
	const busyEl = container.querySelector('.repl-frame-busy')

	/** 根据 textarea 内容同步行号槽、语法高亮与输入框高度。 */
	function syncInputView() {
		const lines = inputEl.value.split('\n')
		gutter.replaceChildren(...lines.map((lineText, lineIndex) => {
			const lineEl = document.createElement('div')
			lineEl.className = `repl-gutter-line ${lineIndex === 0 ? 'repl-gutter-prompt' : 'repl-gutter-cont'}`
			lineEl.textContent = lineIndex === 0 ? '❯' : '…'
			return lineEl
		}))
		highlightEl.innerHTML = lines.map(highlightHtml).join('\n') || '&nbsp;'
		inputEl.style.height = '0'
		inputEl.style.height = `${Math.max(inputEl.scrollHeight, stack.offsetHeight)}px`
	}

	onHighlighterReady(syncInputView)
	syncInputView()

	return {
		inputEl,
		completionsEl,
		syncInputView,
		/**
		 * 切换顶部忙状态指示器的可见性。
		 * @param {boolean} busy - 是否正在求值。
		 * @returns {void}
		 */
		setBusy: busy => busyEl.classList.toggle('active', busy),
		/** 将焦点移到代码输入 textarea。
		 * @returns {void}
		 */
		focus: () => inputEl.focus(),
	}
}
