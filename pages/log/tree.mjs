/**
 * Chrome DevTools 风格的快照树 DOM 渲染（可交互展开 / truncated 懒加载）。
 */

import { ansiToHtml } from 'https://esm.sh/@steve02081504/ansi2html'

/** 折叠行「单行预览」中复合类型最多再向下展开几层 */
const SNAPSHOT_PREVIEW_NEST_MAX = 5

/**
 * 生成 truncated 节点的占位预览文本。
 * @param {{ label?: string }} node - 快照节点。
 * @returns {string} 单行预览字符串。
 */
function truncatedPlaceholderText(node) {
	const label = node.label || ''
	if (label === 'Object') return '{…}'
	return label ? `[${label}]` : '{…}'
}

/**
 * 递归收集并批量展开节点中的 truncated 引用。
 * @param {object} node - 快照树根节点。
 * @param {(ref: string) => Promise<unknown>} requestExpandRef - 按引用 ID 加载完整快照。
 */
async function resolveAllTruncated(node, requestExpandRef) {
	/** @type {Map<string, object[]>} */
	const refToNodes = new Map()

	/** @param {unknown} n - 遍历中的子节点。 */
	function collect(n) {
		if (!n || typeof n !== 'object') return
		const o = /** @type {Record<string, unknown>} */ n
		if (o.kind === 'truncated' && o.ref) {
			const r = String(o.ref)
			let list = refToNodes.get(r)
			if (!list) {
				list = []
				refToNodes.set(r, list)
			}
			list.push(o)
			return
		}
		if (Array.isArray(o.entries))
			for (const e of o.entries)
				collect(e?.value)
		if (Array.isArray(o.items))
			for (const i of o.items) {
				collect(i?.key)
				collect(i?.value ?? i)
			}
	}
	collect(node)
	if (refToNodes.size === 0) return

	await Promise.all([...refToNodes.entries()].map(async ([ref, nodes]) => {
		try {
			const result = await requestExpandRef(ref)
			for (const n of nodes) {
				for (const k of Object.keys(n))
					delete n[k]
				Object.assign(n, result)
			}
		} catch {
			for (const n of nodes)
				n.ref = ''
		}
	}))
}

/**
 * 将带 ANSI 的字符串渲染为日志 DOM 节点。
 * @param {string} text - 原始文本。
 * @param {{ quoted?: boolean, className?: string }} [opts] - 是否加引号与 CSS 类名。
 * @returns {HTMLElement} 包装后的 span 元素。
 */
function renderLogStringNode(text, { quoted = false, className = 'log-str' } = {}) {
	const wrapper = document.createElement('span')
	wrapper.className = className
	const html = ansiToHtml(String(text || ''))
	wrapper.innerHTML = quoted ? `"${html}"` : html
	return wrapper
}

/**
 * 生成快照节点的单行折叠预览文本。
 * @param {object} node - 快照节点。
 * @param {number} [maxLen] - 标量字符串最大长度。
 * @param {number} [nestDepth] - 当前嵌套深度（限制复合类型展开）。
 * @returns {string} 预览字符串。
 */
function getNodePreview(node, maxLen = 50, nestDepth = 0) {
	if (!node) return 'undefined'
	switch (node.kind) {
		case 'string': {
			const s = String(node.value)
			const truncated = s.length > maxLen ? `${s.slice(0, maxLen)}…` : s
			return `"${truncated}"`
		}
		case 'number':
		case 'boolean': return String(node.value)
		case 'bigint': return `${node.value}n`
		case 'null': return 'null'
		case 'undefined': return 'undefined'
		case 'function': return `ƒ ${node.value}()`
		case 'symbol': return String(node.value)
		case 'circular': return '[Circular ↑]'
		case 'truncated': return truncatedPlaceholderText(node)
		case 'Date': return node.value
		case 'RegExp': return node.value
		case 'Error': return `${node.name || 'Error'}: ${node.message || ''}`
		case 'array': {
			const count = node.items?.length || 0
			if (count === 0) return '[]'
			if (nestDepth >= SNAPSHOT_PREVIEW_NEST_MAX)
				return `(${count})\u00a0[…]`
			const preview = (node.items || []).slice(0, 4).map(i => getNodePreview(i, 15, nestDepth + 1)).join(', ')
			return `(${count})\u00a0[${preview}${count > 4 ? ', …' : ''}]`
		}
		case 'Map': {
			const count = node.items?.length || 0
			return `Map(${count})\u00a0{${count > 0 ? '…' : ''}}`
		}
		case 'Set': {
			const count = node.items?.length || 0
			return `Set(${count})\u00a0{${count > 0 ? '…' : ''}}`
		}
		default: {
			const entries = node.entries || []
			const prefix = node.kind && node.kind !== 'object' ? `${node.kind}\u00a0` : ''
			if (entries.length === 0) return `${prefix}{}`
			if (nestDepth >= SNAPSHOT_PREVIEW_NEST_MAX)
				return `${prefix}{…}`
			const preview = entries.slice(0, 4).map(e => `${e.key}:\u00a0${getNodePreview(e.value, 12, nestDepth + 1)}`).join(',\u00a0')
			return `${prefix}{${preview}${entries.length > 4 ? ',\u00a0…' : ''}}`
		}
	}
}

/**
 * 构建可展开节点的子属性列表容器。
 * @param {object} node - 父快照节点。
 * @param {number} depth - 当前树深度。
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - 懒加载展开回调。
 * @returns {HTMLDivElement} 子节点容器。
 */
function buildChildren(node, depth, renderOpts = {}) {
	const container = document.createElement('div')
	container.className = 'log-node-children'

	if (node.kind === 'array')
		for (let i = 0; i < (node.items || []).length; i++)
			container.appendChild(makeProp(String(i), buildArgNode(node.items[i], depth, false, renderOpts)))
	else if (node.kind === 'Set')
		for (let i = 0; i < (node.items || []).length; i++)
			container.appendChild(makeProp(String(i), buildArgNode(node.items[i], depth, false, renderOpts)))
	else if (node.kind === 'Map')
		for (const item of node.items || []) {
			const prop = document.createElement('div')
			prop.className = 'log-node-prop'
			prop.appendChild(buildArgNode(item.key, depth, false, renderOpts))
			const arrow = document.createElement('span')
			arrow.className = 'log-node-colon'
			arrow.textContent = '\u00a0=>\u00a0'
			prop.appendChild(arrow)
			prop.appendChild(buildArgNode(item.value, depth, false, renderOpts))
			container.appendChild(prop)
		}
	else {
		for (const entry of node.entries || [])
			container.appendChild(makeProp(String(entry.key), buildArgNode(entry.value, depth, false, renderOpts)))
		if (node.kind === 'Error' && node.stack) {
			const stackRow = document.createElement('div')
			stackRow.className = 'log-node-prop'
			const pre = document.createElement('pre')
			pre.className = 'log-error-stack'
			pre.textContent = Array.isArray(node.stack)
				? node.stack.map(frame => frame?.raw ?? String(frame)).join('\n')
				: String(node.stack)
			stackRow.appendChild(pre)
			container.appendChild(stackRow)
		}
	}

	return container
}

/**
 * 构建 `key: value` 形式的属性行。
 * @param {string} key - 属性名。
 * @param {HTMLElement} valueEl - 值节点。
 * @returns {HTMLDivElement} 属性行元素。
 */
function makeProp(key, valueEl) {
	const prop = document.createElement('div')
	prop.className = 'log-node-prop'
	const keyEl = document.createElement('span')
	keyEl.className = 'log-node-key'
	keyEl.textContent = key
	const colon = document.createElement('span')
	colon.className = 'log-node-colon'
	colon.textContent = ':\u00a0'
	prop.appendChild(keyEl)
	prop.appendChild(colon)
	prop.appendChild(valueEl)
	return prop
}

/**
 * 构建带折叠头的复合类型节点（数组、对象、Map 等）。
 * @param {object} node - 快照节点。
 * @param {number} depth - 当前树深度。
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - 懒加载展开回调。
 * @returns {HTMLSpanElement} 可交互节点根元素。
 */
function buildExpandableNode(node, depth, renderOpts = {}) {
	const hasChildren = (() => {
		switch (node.kind) {
			case 'array': return (node.items?.length || 0) > 0
			case 'Map':
			case 'Set': return (node.items?.length || 0) > 0
			case 'Error': return true
			default: return (node.entries?.length || 0) > 0
		}
	})()

	const el = document.createElement('span')
	el.className = 'log-node'

	const header = document.createElement('span')
	header.className = `log-node-header${hasChildren ? ' expandable' : ''}`

	const toggle = document.createElement('span')
	toggle.className = 'log-toggle'
	toggle.textContent = hasChildren ? '▶' : ''

	const preview = document.createElement('span')
	preview.className = node.kind === 'Error' ? 'log-node-preview log-val-error-text' : 'log-node-preview'
	preview.textContent = getNodePreview(node)

	header.appendChild(toggle)
	header.appendChild(preview)
	el.appendChild(header)

	if (hasChildren) {
		let expanded = false
		/** @type {HTMLElement | null} */
		let childrenEl = null
		let loading = false

		/** @param {MouseEvent} [e] - 点击事件（用于阻止冒泡）。 */
		const toggleExpand = async e => {
			e?.stopPropagation()
			if (loading) return
			if (childrenEl) {
				expanded = !expanded
				toggle.classList.toggle('open', expanded)
				if (expanded) el.appendChild(childrenEl)
				else el.removeChild(childrenEl)
				return
			}
			expanded = true
			toggle.classList.add('open')
			const expandRef = renderOpts.requestExpandRef
			if (typeof expandRef === 'function') {
				loading = true
				const loadingEl = document.createElement('span')
				loadingEl.className = 'log-node-children'
				loadingEl.textContent = '…'
				el.appendChild(loadingEl)
				try {
					await resolveAllTruncated(node, expandRef)
				} finally {
					loading = false
					if (loadingEl.parentNode) el.removeChild(loadingEl)
				}
			}
			childrenEl = buildChildren(node, depth + 1, renderOpts)
			el.appendChild(childrenEl)
		}

		header.addEventListener('click', toggleExpand)
	}

	return el
}

/**
 * 创建带类名的纯文本 span。
 * @param {string} text - 文本内容。
 * @param {string} className - CSS 类名。
 * @returns {HTMLSpanElement} span 元素。
 */
function span(text, className) {
	const el = document.createElement('span')
	el.className = className
	el.textContent = text
	return el
}

/**
 * 将单个快照节点渲染为 DOM（递归入口）。
 * @param {object} node - 快照节点。
 * @param {number} [depth] - 当前树深度。
 * @param {boolean} [topLevel] - 是否为顶层值（影响字符串引号样式）。
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - 懒加载展开回调。
 * @returns {HTMLElement} 节点对应的 DOM 元素。
 */
export function buildArgNode(node, depth = 0, topLevel = false, renderOpts = {}) {
	if (!node) return span('undefined', 'log-val-undefined')

	switch (node.kind) {
		case 'string':
			return renderLogStringNode(String(node.value), {
				quoted: !topLevel,
				className: topLevel ? 'log-str' : 'log-str log-val-string',
			})
		case 'number': return span(String(node.value), 'log-val-number')
		case 'boolean': return span(String(node.value), 'log-val-boolean')
		case 'bigint': return span(`${node.value}n`, 'log-val-number')
		case 'symbol': return span(String(node.value), 'log-val-symbol')
		case 'function': return span(`ƒ\u00a0${node.value}()`, 'log-val-function')
		case 'null': return span('null', 'log-val-null')
		case 'undefined': return span('undefined', 'log-val-undefined')
		case 'circular': return span('[Circular\u00a0↑]', 'log-val-circular')
		case 'Date': return span(node.value, 'log-val-date')
		case 'RegExp': return span(node.value, 'log-val-regexp')
		case 'truncated': {
			const wrap = document.createElement('span')
			wrap.className = 'log-val-truncated'
			wrap.textContent = truncatedPlaceholderText(node)
			if (node.ref) wrap.title = String(node.ref)
			const fn = renderOpts.requestExpandRef
			if (node.ref && typeof fn === 'function') {
				wrap.classList.add('log-expandable-truncated')
				wrap.addEventListener('click', async e => {
					e.stopPropagation()
					if (wrap.dataset.loading === '1') return
					wrap.dataset.loading = '1'
					const prev = wrap.textContent
					wrap.textContent = '…'
					try {
						const result = await fn(String(node.ref))
						for (const k of Object.keys(node)) delete node[k]
						Object.assign(node, result)
						wrap.replaceWith(buildArgNode(node, depth, topLevel, renderOpts))
					} catch {
						wrap.textContent = prev
						wrap.dataset.loading = '0'
					}
				})
			}
			return wrap
		}
		default:
			return buildExpandableNode(node, depth, renderOpts)
	}
}

/**
 * 将 virtual-console `LogEntry#toSegments()` 产物渲染为可交互 DOM。
 * @param {import('@steve02081504/virtual-console').LogSegment[]} segments - 日志分段数组。
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - 懒加载展开回调。
 * @returns {DocumentFragment} 可插入 DOM 的文档片段。
 */
export function buildFragmentFromSegments(segments, renderOpts = {}) {
	const frag = document.createDocumentFragment()
	/** @type {HTMLSpanElement | null} */
	let styleWrap = null

	/**
	 * 结束当前 CSS 样式包装并追加到片段。
	 */
	const closeStyle = () => {
		if (styleWrap) {
			frag.appendChild(styleWrap)
			styleWrap = null
		}
	}

	/** @param {HTMLElement} node - 待追加的 DOM 子节点。 */
	const appendStyled = node => {
		if (styleWrap) styleWrap.appendChild(node)
		else frag.appendChild(node)
	}

	for (const seg of segments) {
		if (seg.kind === 'text' && seg.text === '\n') continue

		if (seg.kind === 'css') {
			closeStyle()
			if (seg.css) {
				styleWrap = document.createElement('span')
				styleWrap.style.cssText = seg.css
			}
			continue
		}

		if (seg.kind === 'text')
			appendStyled(renderLogStringNode(seg.text, { quoted: false, className: 'log-str' }))
		else if (seg.kind === 'value')
			appendStyled(buildArgNode(seg.snapshot, 0, false, renderOpts))
		else if (seg.kind === 'trace') {
			closeStyle()
			const wrap = document.createElement('span')
			wrap.style.cssText = 'color:gray;font-size:0.9em;display:block'
			for (const frame of seg.stack || []) {
				const line = document.createElement('span')
				line.style.display = 'block'
				line.textContent = frame.raw
				wrap.appendChild(line)
			}
			frag.appendChild(wrap)
		}
	}

	closeStyle()
	return frag
}
