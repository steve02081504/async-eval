const FILTER_LEVELS = ['all', 'log', 'info', 'warn', 'error', 'debug']

/**
 * 构建日志工具栏（清空、文本过滤、级别过滤）。
 * @param {HTMLElement} container - 工具栏挂载容器。
 * @param {{ onClear: () => void, onFilter: (text: string, level: string) => void }} handlers - 清空与过滤回调。
 */
export function createLogToolbar(container, { onClear, onFilter }) {
	const toolbar = document.createElement('div')
	toolbar.className = 'log-toolbar'

	const clearButton = document.createElement('button')
	clearButton.type = 'button'
	clearButton.className = 'log-clear-btn'
	clearButton.textContent = 'Clear'
	clearButton.addEventListener('click', onClear)

	const filterInput = document.createElement('input')
	filterInput.type = 'text'
	filterInput.className = 'log-filter-input'
	filterInput.placeholder = 'Filter…'
	filterInput.addEventListener('input', () => onFilter(filterInput.value, activeLevel))

	const levelGroup = document.createElement('div')
	levelGroup.className = 'log-level-btns'

	let activeLevel = 'all'
	const levelButtons = FILTER_LEVELS.map(level => {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = `log-level-btn${level === 'all' ? ' active' : ''}`
		button.dataset.lvl = level
		button.textContent = level
		button.addEventListener('click', () => {
			activeLevel = level
			for (const other of levelButtons) other.classList.toggle('active', other === button)
			onFilter(filterInput.value, activeLevel)
		})
		levelGroup.appendChild(button)
		return button
	})

	toolbar.append(clearButton, filterInput, levelGroup)
	container.replaceChildren(toolbar)
}

/**
 * 行是否匹配当前过滤条件（级别 + 文本）。
 * @param {HTMLElement} row - 日志行元素。
 * @param {string} filterText - 文本过滤关键字。
 * @param {string} levelFilter - 级别过滤（`all` 表示全部）。
 * @returns {boolean} 该行应显示时为 `true`。
 */
export function rowMatchesFilter(row, filterText, levelFilter) {
	if (levelFilter !== 'all') {
		const level = [...row.classList].find(name => name.startsWith('log-level-'))?.slice('log-level-'.length)
		if (level && level !== levelFilter) return false
	}
	return !filterText || row.textContent.toLowerCase().includes(filterText.toLowerCase())
}
