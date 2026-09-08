import { VirtualConsole } from '@steve02081504/virtual-console'

import { sync_eval, EvalResult } from '../../../main.mjs'
import { assert, assertEqual, assertIncludes, runTestGroup } from '../../harness.mjs'

/**
 * 仅记录输出、不写入真实控制台的 VirtualConsole。
 *
 * @param {object} [overrides] - 合并传入 VirtualConsole 构造函数的选项。
 * @returns {VirtualConsole} 用于测试断言的静默控制台。
 */
function quietConsole(overrides = {}) {
	return new VirtualConsole({ recordOutput: true, realConsoleOutput: false, ...overrides })
}

/**
 * 在静默控制台下执行同步 `sync_eval`。
 *
 * @param {string} code - 待求值代码。
 * @param {object} [args={}] - 额外注入参数（`console` 由本函数提供）。
 * @returns {import('../../../lib/eval_result.mjs').EvalResult} `sync_eval` 返回值。
 */
function evalCode(code, args = {}) {
	return sync_eval(code, { console: quietConsole(), ...args })
}

/**
 * 断言求值成功且 `result` 严格等于期望值（单条断言）。
 *
 * @param {object} options - 用例选项。
 * @param {string} options.label - 用例说明。
 * @param {string} options.code - 待求值代码。
 * @param {unknown} options.result - 期望的 `result`。
 * @param {object} [options.args] - 额外注入参数。
 * @returns {void}
 */
function assertEvalResult({ label, code, result, args }) {
	const evalResult = evalCode(code, args)
	if (evalResult.error !== undefined) {
		assertEqual(evalResult.error, undefined, label)
		return
	}
	assertEqual(evalResult.result, result, label)
}

/**
 * 断言求值成功且 `result` 与期望值 JSON 序列化后相等（单条断言）。
 *
 * @param {object} options - 用例选项。
 * @param {string} options.label - 用例说明。
 * @param {string} options.code - 待求值代码。
 * @param {unknown} options.result - 期望的 `result`。
 * @returns {void}
 */
function assertEvalJson({ label, code, result }) {
	const evalResult = evalCode(code)
	if (evalResult.error !== undefined) {
		assertEqual(evalResult.error, undefined, label)
		return
	}
	assertEqual(JSON.stringify(evalResult.result), JSON.stringify(result), label)
}

/**
 * 批量运行表驱动用例。
 *
 * @param {Array<{ label: string, code: string, result: unknown, args?: object }>} cases - 用例列表。
 * @returns {void}
 */
function runEvalCases(cases) {
	for (const testCase of cases)
		assertEvalResult(testCase)
}

/**
 * 验证同步求值的基础行为与同步返回。
 *
 * @returns {void}
 */
function testBasicEval() {
	console.log('\n=== [同步求值 · 基础] ===')

	const expr = evalCode('1 + 2')
	assertEqual(expr.result, 3, '表达式同步返回计算结果')
	assert(expr instanceof EvalResult, '返回 EvalResult 实例')

	const decl = evalCode('const a = 5;\nconst b = 10;\nb;')
	assertEqual(decl.result, 10, '最后一条变量声明隐式返回变量值')

	const explicit = evalCode('return 99;')
	assertEqual(explicit.result, 99, '显式 return 仍然有效')

	assertEvalJson({ label: '末尾对象字面量隐式返回', code: '{ a: 1 }', result: { a: 1 } })
	assertEvalResult({ label: 'if 真分支取块内末值', code: 'if(1){2}else{3}', result: 2 })
}

/**
 * 验证第二参数注入变量与 `console`。
 *
 * @returns {void}
 */
function testArgsInjection() {
	console.log('\n=== [同步求值 · 参数注入] ===')

	/**
	 * @param {number} val - 注入到求值代码中的操作数。
	 * @returns {number} 翻倍后的值。
	 */
	const double = val => val * 2
	assertEvalResult({
		label: '注入变量与函数可用',
		code: 'x * y + helper(z)',
		result: 54,
		args: { x: 10, y: 5, z: 2, helper: double },
	})
}

/**
 * 验证 VirtualConsole 日志捕获与 EvalResult 的 output getter。
 *
 * @returns {void}
 */
function testConsoleCapture() {
	console.log('\n=== [同步求值 · VirtualConsole 捕获] ===')

	const code = `\
console.log('hello');
console.warn('slow path');
42;
`
	const evalResult = evalCode(code)

	assertEqual(evalResult.result, 42, '求值结果正确')
	assertEqual(evalResult.outputEntries.length, 2, '捕获两条日志')
	assertEqual(evalResult.outputEntries[0].level, 'log', '第1条为 log')
	assertEqual(evalResult.outputEntries[1].level, 'warn', '第2条为 warn')
	assertIncludes(evalResult.output, 'hello', 'output 聚合含 log')
	assertIncludes(evalResult.output, 'slow path', 'output 聚合含 warn')

	const shared = quietConsole()
	sync_eval('console.log(\'session 1\')', { console: shared })
	const second = sync_eval('console.log(\'session 2\')', { console: shared })
	assertEqual(shared.outputEntries.length, 2, '共享 console 累计两条')
	assertEqual(second.outputEntries.length, 1, '第二次 eval 只返回本次一条')
	assertIncludes(second.output, 'session 2', '第二次 output 含 session 2')
	assert(!second.output.includes('session 1'), '第二次 output 不含 session 1')
}

/**
 * 验证运行时与语法错误通过 `error` 字段返回。
 *
 * @returns {void}
 */
function testErrors() {
	console.log('\n=== [同步求值 · 错误处理] ===')

	const runtime = evalCode('throw new Error("boom")')
	assert(runtime.error instanceof Error, '运行时错误捕获为 Error')
	assertEqual(runtime.error.message, 'boom', '错误消息保留')
	assert(runtime.result === undefined, '出错时无 result')

	const syntax = evalCode('const x = ;')
	assert(syntax.error instanceof Error, '语法错误捕获为 Error')
	assert(syntax.result === undefined, '语法错误时无 result')
}

/**
 * 验证同步求值不做包导入处理：含静态 `import` 的代码应作为语法错误返回，
 * 而非像 async_eval 那样改写为动态 import。
 *
 * @returns {void}
 */
function testNoImportHandling() {
	console.log('\n=== [同步求值 · 不做包导入处理] ===')

	const imported = evalCode('import { sep } from \'path\';\nsep;')
	assert(imported.error instanceof Error, '静态 import 不做改写，作为语法错误返回')
	assert(imported.result === undefined, '含 import 时无 result')
}

/**
 * 运行同步 sync_eval 集成测试分组。
 *
 * @returns {void}
 */
export function runSyncEvalTests() {
	runTestGroup('sync_eval 同步求值', [
		testBasicEval,
		testArgsInjection,
		testConsoleCapture,
		testErrors,
		testNoImportHandling,
	])
}
