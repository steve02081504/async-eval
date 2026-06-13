/**
 * 按运行时选择 `npm:` 前缀并动态加载包。
 *
 * @param {string} specifier - npm 包名。
 * @returns {Promise<Record<string, unknown>>} 模块命名空间。
 */
export function importPackage(specifier) {
	if (globalThis.Deno)
		return import(`npm:${specifier}`).catch(() => import(specifier))
	return import(specifier)
}
