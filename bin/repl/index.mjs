import { importOrInstall } from '../../lib/import/import-or-install.mjs'
import { async_eval } from '../../main.mjs'

import { displayEvalResult } from './display.mjs'
import { createInput, EOF } from './input.mjs'

/** 项目 GitHub Pages 地址。 */
const WEB_URL = 'https://steve02081504.github.io/async-eval/'
/** 项目源码仓库地址。 */
const REPO_URL = 'https://github.com/steve02081504/async-eval'

/**
 * 懒加载 cli-highlight 作为 JS 高亮器（仅 REPL 需要，缺失时按需安装）。不可用则降级为原样返回。
 * @returns {Promise<(code: string) => string>} 高亮函数，不可用时为恒等函数。
 */
async function loadHighlighter() {
	const highlightModule = await importOrInstall('cli-highlight', {
		/**
		 * 安装 cli-highlight 前向 stderr 提示。
		 * @returns {void}
		 */
		onInstall: () => console.error('\x1b[2m· installing cli-highlight for syntax highlighting…\x1b[0m'),
	}).catch(() => 0)
	return code => {
		try { return highlightModule.highlight(code, { language: 'js', ignoreIllegals: true }) }
		catch { return code }
	}
}

/**
 * 生成 OSC8 链接格式字符串。
 * @param {string} link - 链接 URL。
 * @param {string} [text=link] - 链接文本。
 * @returns {string} OSC8 链接格式字符串。
 */
function osc8link(link, text = link) {
	return `\x1b]8;;${link}\x1b\\${text}\x1b]8;;\x1b\\`
}

console.log(`\
Web:  ${osc8link(WEB_URL)}
Repo: ${osc8link(REPO_URL)}

\x1b[1masync-eval REPL\x1b[0m
· Top-level await, import, implicit return, virtual console capture.
· Set bindings via \x1b[33margs\x1b[0m (e.g. \`args.x = 1\`). Trailing \`\\\` continues the input.
· \x1b[33m↑/↓\x1b[0m history · \x1b[33mCtrl+C\x1b[0m clear (quit when empty).
`)

const highlightJs = await loadHighlighter()

const bindings = {}
bindings.args = bindings

const terminalInput = createInput()

try {
	while (true) {
		const code = await terminalInput.readMultiline(highlightJs)
		if (code === EOF) break
		if (!code.trim()) continue

		displayEvalResult(await async_eval(code, bindings))
		console.log('')
	}
} finally {
	terminalInput.close()
}
