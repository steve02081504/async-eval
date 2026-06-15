/**
 * 本模块的 URL，作为「求值上下文」的稳定标识。
 *
 * `AsyncFunction` 在此模块内构造，因此其内部动态 `import()` 的 `parentURL` 恒等于该值。
 * Deno 的解析钩子（见 `lib/deno/register_hooks.mjs`）据此精确识别求值代码发起的 `import()`。
 *
 * @type {string}
 */
export const EVAL_RUNNER_URL = import.meta.url

// deno-lint-ignore require-await
const AsyncFunction = (async x => x).constructor

/**
 * 在本模块内构造并运行 `AsyncFunction`，使动态 `import()` 的 `parentURL` 固定为
 * `EVAL_RUNNER_URL`，供 Deno `registerHooks` 识别求值上下文。
 *
 * @param {string} source - 函数体源码。
 * @param {Record<string, unknown>} args - 注入参数。
 * @returns {Promise<unknown>} 求值结果。
 */
export function runInAsyncFunction(source, args) {
	return new AsyncFunction(
		...Object.keys(args), source
	)(...Object.values(args))
}
