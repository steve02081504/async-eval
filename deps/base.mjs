/**
 * 按运行时选择 `npm:` 前缀并动态加载包。
 *
 * @param {string} specifier - npm 包名。
 * @returns {Promise<Record<string, unknown>>} 模块命名空间。
 */
export function importPackage(specifier) {
	if (globalThis.Deno)
		return import(`npm:${specifier}`).catch(() => import(specifier))
	if (globalThis.document)
		switch (import.meta.url.hostname) {
			case 'cdn.jsdelivr.net':
				return import(`https://cdn.jsdelivr.net/npm/${specifier}`)
			case 'unpkg.com':
				return import(`https://unpkg.com/${specifier}`)
			default:
			case 'esm.sh':
				return import(`https://esm.sh/${specifier}`)
		}
	return import(specifier)
}
