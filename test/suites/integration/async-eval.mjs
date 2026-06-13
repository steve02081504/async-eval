import { VirtualConsole } from '@steve02081504/virtual-console'

import { async_eval, EvalResult } from '../../../main.mjs'
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
 * 验证表达式与变量声明的隐式 return。
 *
 * @returns {Promise<void>}
 */
async function testImplicitReturn() {
	console.log('\n=== [隐式 return] ===')

	const expr = await async_eval('1 + 2', { console: quietConsole() })
	assertEqual(expr.result, 3, '表达式隐式返回计算结果')
	assert(expr instanceof EvalResult, '返回 EvalResult 实例')

	const decl = await async_eval('const a = 5;\nconst b = 10;\nb;', { console: quietConsole() })
	assertEqual(decl.result, 10, '最后一条变量声明隐式返回变量值')

	const explicit = await async_eval('return 99;', { console: quietConsole() })
	assertEqual(explicit.result, 99, '显式 return 仍然有效')

	const objectLiteral = await async_eval('{a:{}}', { console: quietConsole() })
	assertEqual(JSON.stringify(objectLiteral.result), JSON.stringify({ a: {} }), '顶层 {a:{}} 解析为对象字面量而非块语句')

	const commentedObjectLiteral = await async_eval('/*a*/{a:{}}', { console: quietConsole() })
	assertEqual(JSON.stringify(commentedObjectLiteral.result), JSON.stringify({ a: {} }), '前导注释后的对象字面量仍可隐式返回')

	const trailingObjectLiteral = await async_eval('1;{a:{}}', { console: quietConsole() })
	assertEqual(JSON.stringify(trailingObjectLiteral.result), JSON.stringify({ a: {} }), '多语句时最后一条对象字面量仍可隐式返回')
}

/**
 * 验证顶层 await 与参数注入。
 *
 * @returns {Promise<void>}
 */
async function testAwaitAndArgs() {
	console.log('\n=== [顶层 await 与参数注入] ===')

	const awaited = await async_eval('await Promise.resolve(42)', { console: quietConsole() })
	assertEqual(awaited.result, 42, '顶层 await 可求值')

	/**
	 * @param {number} val - 注入到求值代码中的操作数。
	 * @returns {number} 翻倍后的值。
	 */
	const double = val => val * 2

	const injected = await async_eval('x * y + helper(z)', {
		console: quietConsole(),
		x: 10,
		y: 5,
		z: 2,
		helper: double,
	})
	assertEqual(injected.result, 54, '注入变量与函数可用')
}

/**
 * 验证 VirtualConsole 日志捕获与 EvalResult 的 output getter。
 *
 * @returns {Promise<void>}
 */
async function testConsoleCapture() {
	console.log('\n=== [VirtualConsole 捕获] ===')

	const code = `\
console.log('hello');
console.warn('slow path');
42;
`
	const evalResult = await async_eval(code, { console: quietConsole() })

	assertEqual(evalResult.result, 42, '求值结果正确')
	assertEqual(evalResult.outputEntries.length, 2, '捕获两条日志')
	assertEqual(evalResult.outputEntries[0].level, 'log', '第1条为 log')
	assertEqual(evalResult.outputEntries[1].level, 'warn', '第2条为 warn')
	assertIncludes(evalResult.output, 'hello', 'output 聚合含 log')
	assertIncludes(evalResult.output, 'slow path', 'output 聚合含 warn')
	assertIncludes(evalResult.outputHtml, 'slow&nbsp;path', 'outputHtml 含 warn 内容')
}

/**
 * 验证复用共享 VirtualConsole 时每次 eval 的日志隔离。
 *
 * @returns {Promise<void>}
 */
async function testPerEvalOutputSnapshot() {
	console.log('\n=== [共享 console 按次隔离日志] ===')

	const shared = quietConsole()
	await async_eval('console.log(\'session 1\')', { console: shared })
	const second = await async_eval('console.log(\'session 2\')', { console: shared })

	assertEqual(shared.outputEntries.length, 2, '共享 console 累计两条')
	assertEqual(second.outputEntries.length, 1, '第二次 eval 只返回本次一条')
	assert(second.outputEntries[0].args[0] === 'session 2', '第二条仅为 session 2')
	assertIncludes(second.output, 'session 2', '第二次 output 含 session 2')
	assert(!second.output.includes('session 1'), '第二次 output 不含 session 1')
}

/**
 * 验证静态 import 语句被转换为动态 import。
 *
 * @returns {Promise<void>}
 */
async function testImportTransformation() {
	console.log('\n=== [import 转换] ===')

	const named = await async_eval(`\
import { sep } from 'path';
sep;
`, { console: quietConsole() })
	assert(typeof named.result === 'string', '命名导入 path.sep 为字符串')
	assert(named.result.length, 'path.sep 非空')

	const namespace = await async_eval(`\
import * as url from 'url';
typeof url.fileURLToPath;
`, { console: quietConsole() })
	assertEqual(namespace.result, 'function', '命名空间导入可用')

	const sideEffect = await async_eval(`\
import 'node:assert';
'ok';
`, { console: quietConsole() })
	assertEqual(sideEffect.result, 'ok', '副作用 import 不阻断求值')
}

/**
 * 验证运行时与语法错误通过 `error` 字段返回。
 *
 * @returns {Promise<void>}
 */
async function testErrors() {
	console.log('\n=== [错误处理] ===')

	const runtime = await async_eval('throw new Error("boom")', { console: quietConsole() })
	assert(runtime.error instanceof Error, '运行时错误捕获为 Error')
	assertEqual(runtime.error.message, 'boom', '错误消息保留')
	assert(runtime.result === undefined, '出错时无 result')

	const syntax = await async_eval('const x = ;', { console: quietConsole() })
	assert(syntax.error instanceof Error, '语法错误捕获为 Error')
	assert(syntax.result === undefined, '语法错误时无 result')
}

/**
 * 运行 async-eval 集成测试分组。
 *
 * @returns {Promise<void>}
 */
export async function runAsyncEvalTests() {
	await runTestGroup('async-eval 求值与输出', [
		testImplicitReturn,
		testAwaitAndArgs,
		testConsoleCapture,
		testPerEvalOutputSnapshot,
		testImportTransformation,
		testErrors,
	])
}
