const passthroughScript = {
	/**
	 * 原样返回生成的脚本源码，供 `AsyncFunction` 构造使用。
	 *
	 * @param {string} input - 从转换后的 AST 生成的 JavaScript 源码。
	 * @returns {string} 相同的源码字符串。
	 */
	createScript: input => input
}

export const scriptPolicy = globalThis.trustedTypes?.createPolicy?.('async-eval-policy', passthroughScript) ?? passthroughScript
