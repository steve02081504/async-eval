import { registerHooks } from 'node:module'

import { EVAL_RUNNER_URL } from '../eval_runner.mjs'

/** @type {RegExp} Deno 原生说明符前缀。 */
const DENO_NATIVE_PREFIX = /^(?:npm:|jsr:|https?:|node:|data:|file:)/

/**
 * 用 Deno 原生解析器解析说明符。
 *
 * @param {string} specifier - 模块说明符。
 * @returns {string | undefined} 解析后的 URL，失败时返回 `undefined`。
 */
function denoResolve(specifier) {
	try {
		return import.meta.resolve(specifier)
	} catch {
		return undefined
	}
}

/**
 * 判断 Node 兼容层是否将 bare 说明符误解析为相对 `parentURL` 的本地文件路径。
 *
 * @param {string} specifier - 模块说明符。
 * @param {string} parentURL - 导入方模块 URL。
 * @param {string} url - 解析结果 URL。
 * @returns {boolean} 是否为误解析的 bare 说明符。
 */
function isMisresolvedBareSpecifier(specifier, parentURL, url) {
	if (!url.startsWith('file:')) return false

	const parentDir = new URL(parentURL).pathname.replace(/\/[^/]*$/, '')
	const resolvedPath = new URL(url).pathname

	return resolvedPath === `${parentDir}/${specifier}`
		|| resolvedPath === `${parentDir}/${specifier}.js`
		|| resolvedPath === `${parentDir}/${specifier}/index.js`
}

/**
 * 为求值上下文解析模块说明符：原生 scheme 直解；bare 名优先 Node 兼容层，
 * 误解析为相对路径时回退 `node:` / `npm:`。
 *
 * @param {string} specifier - 模块说明符。
 * @param {import('node:module').ResolveHookContext} context - 解析上下文。
 * @param {import('node:module').ResolveHookNext} nextResolve - 默认解析链。
 * @returns {import('node:module').ResolveHookResult} 解析结果或默认链返回值。
 */
function resolveEvalSpecifier(specifier, context, nextResolve) {
	if (DENO_NATIVE_PREFIX.test(specifier)) {
		const url = denoResolve(specifier)
		if (url) return { url, shortCircuit: true }
	}

	if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
		const nodeCompat = nextResolve(specifier, context)
		if (nodeCompat?.url && !isMisresolvedBareSpecifier(specifier, context.parentURL, nodeCompat.url))
			return nodeCompat

		if (!specifier.startsWith('@')) {
			const nodeBuiltin = denoResolve(`node:${specifier}`)
			if (nodeBuiltin?.startsWith?.('node:'))
				return { url: nodeBuiltin, shortCircuit: true }
		}

		const npmUrl = denoResolve(`npm:${specifier}`)
		if (npmUrl) return { url: npmUrl, shortCircuit: true }
	}

	return nextResolve(specifier, context)
}

registerHooks({
	/**
	 * 求值运行器模块的解析钩子：仅对 `EVAL_RUNNER_URL` 子模块应用自定义解析。
	 *
	 * @param {string} specifier - 模块说明符。
	 * @param {import('node:module').ResolveHookContext} context - 解析上下文。
	 * @param {import('node:module').ResolveHookNext} nextResolve - 默认解析链。
	 * @returns {import('node:module').ResolveHookResult} 解析结果。
	 */
	resolve(specifier, context, nextResolve) {
		if (context.parentURL !== EVAL_RUNNER_URL) return nextResolve(specifier, context)
		return resolveEvalSpecifier(specifier, context, nextResolve)
	}
})
