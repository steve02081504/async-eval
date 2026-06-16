import { createHighlighter } from 'https://esm.sh/shiki'

const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark-dimmed' }

/** @type {import('https://esm.sh/shiki').Highlighter | null} */
let highlighter = null
/** @type {Set<() => void>} */
const readyCallbacks = new Set()

createHighlighter({
	themes: Object.values(SHIKI_THEMES),
	langs: ['javascript'],
}).then(instance => {
	highlighter = instance
	for (const callback of readyCallbacks) callback()
	readyCallbacks.clear()
}).catch(() => { /* 加载失败时静默降级为纯文本 */ })

/**
 * 注册高亮器就绪回调（已就绪则立即触发），用于异步加载完成后重绘已有内容。
 * @param {() => void} callback - 高亮器就绪后调用的函数。
 */
export function onHighlighterReady(callback) {
	if (highlighter) callback()
	else readyCallbacks.add(callback)
}

/**
 * 转义 HTML 特殊字符。
 * @param {string} text - 原始文本。
 * @returns {string} 可安全插入 HTML 的字符串。
 */
export function escapeHtml(text) {
	return String(text)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
}

/**
 * 单行 JS 高亮为内联 HTML（双主题，靠 CSS 变量切换明暗）。降级为转义纯文本。
 * @param {string} line - 待高亮的 JS 源码行。
 * @returns {string} 内联高亮 HTML；未加载高亮器时为转义纯文本。
 */
export function highlightHtml(line) {
	if (!highlighter) return escapeHtml(line)
	try {
		return highlighter.codeToHtml(line || ' ', {
			lang: 'javascript',
			themes: SHIKI_THEMES,
			defaultColor: false,
			structure: 'inline',
		})
	} catch {
		return escapeHtml(line)
	}
}

/**
 * @param {string} [hex] - `#rrggbb`
 * @returns {string} 24-bit 前景色 SGR；无法解析时返回空串。
 */
function fgFromHex(hex) {
	if (!hex || !/^#[\da-f]{6}$/i.test(hex)) return ''
	return `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`
}

/**
 * 将 JS 代码高亮为 24-bit ANSI（供 xterm 终端实时回显）。按当前明暗主题取色，降级为原文。
 * @param {string} code - 待高亮的 JS 源码。
 * @returns {string} 带 ANSI 前景色的字符串；失败或未加载时返回原文。
 */
export function highlightAnsi(code) {
	if (!highlighter || !code) return code
	try {
		const { tokens } = highlighter.codeToTokens(code, {
			lang: 'javascript',
			theme: document.documentElement.dataset.theme === 'light' ? SHIKI_THEMES.light : SHIKI_THEMES.dark,
		})
		return tokens.map(line => line.map(token => {
			const fg = fgFromHex(token.color)
			return fg ? `${fg}${token.content}\x1b[39m` : token.content
		}).join('')).join('\n')
	} catch {
		return code
	}
}
