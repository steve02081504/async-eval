import util from 'node:util'

const INSPECT_OPTIONS = {
	colors: true,
	depth: 10,
	maxArrayLength: 50,
	maxStringLength: 2000,
}

/**
 * 打印单次 `async_eval` 的结构化结果（ANSI）。
 *
 * @param {import('../../lib/eval_result.mjs').EvalResult} evalResult - 求值结果。
 * @param {(...args: unknown[]) => void} [write] - 输出行函数，默认 `console.log`。
 * @returns {void}
 */
export function displayEvalResult(evalResult) {
	const { result, error, outputEntries } = evalResult

	for (const entry of outputEntries)
		console.log(entry + '')

	if (error) return console.log(`\x1b[1;31m✖\x1b[0m ${error.stack || error}`)
	if (result !== undefined) console.log(`\x1b[1;36m←\x1b[0m ${util.inspect(result, INSPECT_OPTIONS)}`)
}
