import type { VirtualConsole } from '@steve02081504/virtual-console'

export type { EvalResultFields } from './lib/eval_result.d.mts'
export { EvalResult } from './lib/eval_result.d.mts'

/**
 * 注入求值环境的变量与可选 `console`。
 *
 * 除 `console` 外的键会作为 `AsyncFunction` 形参传入求值代码；
 * `console` 未提供时会自动创建带 `realConsoleOutput: true` 的 {@link VirtualConsole}。
 */
export interface AsyncEvalArgs extends Record<string, unknown> {
	/**
	 * 求值期间使用的控制台实例。
	 * - 未提供：新建 {@link VirtualConsole}（`realConsoleOutput: true`）
	 * - 已是 {@link VirtualConsole}：直接复用
	 * - 其他值：作为 `baseConsole` 包裹为新的 {@link VirtualConsole}
	 */
	console?: VirtualConsole | Console
}

/**
 * 异步求值 JavaScript 代码，支持顶层 `await`、隐式 return、completion value、
 * 静态 `import` 改写与虚拟控制台输出捕获。
 *
 * @param code - 待求值的 JavaScript 源码字符串。
 * @param args - 注入求值环境的绑定与可选 `console`（默认 `{}`）。
 * @returns 含返回值、错误与本次捕获日志的 {@link EvalResult}。
 */
export declare function async_eval(code: string, args?: AsyncEvalArgs): Promise<EvalResult>
