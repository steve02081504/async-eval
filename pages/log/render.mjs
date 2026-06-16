import {
	createExpansionScope,
	expandSnapshotRef,
	serializeArgSnapshot,
} from 'https://esm.sh/@steve02081504/virtual-console/browser'

import { escapeHtml } from '../repl/highlight.mjs'

import { buildArgNode, buildFragmentFromSegments } from './tree.mjs'

const LEVEL_CLASS = {
	log: 'log-level-log',
	info: 'log-level-info',
	warn: 'log-level-warn',
	error: 'log-level-error',
	debug: 'log-level-debug',
	result: 'log-level-log',
	repl: 'log-level-log',
}

const VALUE_MAX_DEPTH = 6

/**
 * 按需展开快照引用。
 * @param {string} ref - 展开引用 ID。
 * @returns {Promise<unknown>} 展开后的快照对象。
 */
async function requestExpandRef(ref) {
	const result = expandSnapshotRef(ref)
	if (!result.ok) throw new Error(result.error)
	return result.snapshot
}

/**
 * 向日志列表追加一行 DOM 结构。
 * @param {HTMLElement} container - 日志列表容器。
 * @param {{ level?: string, method?: string, content: HTMLElement }} row - 行元数据与内容节点。
 * @returns {HTMLElement} 创建的行元素。
 */
function appendDomRow(container, { level = 'log', method = 'log', content }) {
	const row = document.createElement('div')
	row.className = `log-row ${LEVEL_CLASS[level] || 'log-level-log'}`
	row.dataset.kind = method
	const contentWrap = document.createElement('div')
	contentWrap.className = 'log-content'
	contentWrap.appendChild(content)
	row.appendChild(contentWrap)
	container.appendChild(row)
	container.scrollTop = container.scrollHeight
	return row
}

/**
 * 渲染一条 virtual-console 日志条目。
 * @param {HTMLElement} container - 日志列表容器。
 * @param {import('@steve02081504/virtual-console').LogEntry} entry - 日志条目。
 */
export function appendLogEntry(container, entry) {
	const args = document.createElement('span')
	args.className = 'log-args'
	args.appendChild(buildFragmentFromSegments(entry.toSegments(), { requestExpandRef }))
	appendDomRow(container, { level: entry.level, method: entry.method, content: args })
}

/**
 * 渲染求值结果或错误值行。
 * @param {HTMLElement} container - 日志列表容器。
 * @param {'result' | 'error'} kind - 行类型。
 * @param {unknown} value - 求值返回值或抛出的错误。
 */
export function appendValueRow(container, kind, value) {
	const isError = kind === 'error'
	const anchor = {}
	const expansionScope = createExpansionScope(anchor)
	const snapshot = serializeArgSnapshot(value, { maxDepth: VALUE_MAX_DEPTH, expansionScope })

	const args = document.createElement('span')
	args.className = 'log-args'

	const prefix = document.createElement('span')
	if (isError) {
		prefix.className = 'log-val-error-text'
		prefix.textContent = '✖ '
	} else {
		prefix.style.color = 'var(--color-info,#3b82f6)'
		prefix.textContent = '← '
	}
	args.appendChild(prefix)
	args.appendChild(buildArgNode(snapshot, 0, true, { requestExpandRef }))

	const row = appendDomRow(container, {
		level: isError ? 'error' : 'log',
		method: kind,
		content: args,
	})
	row._expandAnchor = anchor
}

/**
 * 追加纯文本行（如 REPL 提示）。
 * @param {HTMLElement} container - 日志列表容器。
 * @param {string} text - 显示文本。
 */
export function appendTextRow(container, text) {
	const span = document.createElement('span')
	span.className = 'log-str'
	span.innerHTML = escapeHtml(text)
	appendDomRow(container, { method: 'repl', content: span })
}
