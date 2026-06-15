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
 * 在静默控制台下执行 `async_eval`。
 *
 * @param {string} code - 待求值代码。
 * @param {object} [args={}] - 额外注入参数（`console` 由本函数提供）。
 * @returns {Promise<import('../../../lib/eval_result.mjs').EvalResult>}
 */
async function evalCode(code, args = {}) {
	return async_eval(code, { console: quietConsole(), ...args })
}

/**
 * 断言求值成功且 `result` 严格等于期望值（单条断言）。
 *
 * @param {object} options - 用例选项。
 * @param {string} options.label - 用例说明。
 * @param {string} options.code - 待求值代码。
 * @param {unknown} options.result - 期望的 `result`。
 * @param {object} [options.args] - 额外注入参数。
 * @returns {Promise<void>}
 */
async function assertEvalResult({ label, code, result, args }) {
	const evalResult = await evalCode(code, args)
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
 * @returns {Promise<void>}
 */
async function assertEvalJson({ label, code, result }) {
	const evalResult = await evalCode(code)
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
 * @returns {Promise<void>}
 */
async function runEvalCases(cases) {
	for (const testCase of cases)
		await assertEvalResult(testCase)
}

/**
 * 验证隐式 return：表达式、变量声明、对象字面量、括号包裹表达式与末尾多余分号。
 *
 * @returns {Promise<void>}
 */
async function testImplicitReturn() {
	console.log('\n=== [隐式 return · 基础] ===')

	const expr = await evalCode('1 + 2')
	assertEqual(expr.result, 3, '表达式隐式返回计算结果')
	assert(expr instanceof EvalResult, '返回 EvalResult 实例')

	const decl = await evalCode('const a = 5;\nconst b = 10;\nb;')
	assertEqual(decl.result, 10, '最后一条变量声明隐式返回变量值')

	const explicit = await evalCode('return 99;')
	assertEqual(explicit.result, 99, '显式 return 仍然有效')

	const trailingSemicolons = await evalCode('5;;;')
	assertEqual(trailingSemicolons.result, 5, '末尾多余分号不丢失前一个表达式的值')

	console.log('\n=== [隐式 return · 对象字面量] ===')

	for (const { label, code, result } of [
		// 单层 {a:{}} 能直接 parse 成功，走的是常规 parse 后的对象字面量识别。
		{ label: '前导注释后的对象字面量识别为对象而非块语句', code: '/*a*/{a:{}}', result: { a: {} } },
		// 同名嵌套键令常规 parse 抛错（重复 label），强制走语句切分回退路径。
		{ label: '回退路径下嵌套对象字面量解析为对象', code: '{a:{a:{}}}', result: { a: { a: {} } } },
		{ label: '回退路径下多语句末尾对象字面量仍可隐式返回', code: '1;{a:{a:{}}}', result: { a: { a: {} } } },
		// 末尾对象前还有非表达式语句，触发 extractTrailingObjectLiteral 的前缀拆分。
		{ label: 'try/catch 后无分号的尾随对象字面量可隐式返回', code: 'let x = 1;\ntry { x = 2 } catch {}\n{ a: { a: x } }', result: { a: { a: 2 } } },
		// 字符串里的 `;`/`}` 与注释里的 `;` 都不应干扰顶层语句切分。
		{ label: '字符串与注释内的分号、花括号不干扰语句切分', code: "/*;*/1;{a:{a:[1,'};']}}", result: { a: { a: [1, '};'] } } },
	])
		await assertEvalJson({ label, code, result })

	console.log('\n=== [隐式 return · 括号表达式] ===')

	// acorn 解析括号包裹表达式时节点 end 落在右括号前，残留的 `)` 须被当作 trivia。
	await assertEvalJson({ label: '括号包裹的对象字面量隐式返回', code: '({ a: 1 })', result: { a: 1 } })
	await assertEvalResult({ label: '括号包裹的单值表达式隐式返回', code: '(42)', result: 42 })
	await assertEvalResult({ label: '括号包裹的逗号表达式返回最后一项', code: '(1, 2, 3)', result: 3 })
	await assertEvalResult({ label: '前有语句、末尾为括号表达式时隐式返回', code: 'let q = 1;\n(q + 1)', result: 2 })

	console.log('\n=== [隐式 return · 解构] ===')

	await assertEvalResult({ label: '末尾对象解构声明返回最后一个绑定值', code: 'const {a} = {a: 1}', result: 1 })
	await assertEvalResult({ label: '末尾数组解构声明返回最后一个绑定值', code: 'const [a,b] = [1,2]', result: 2 })
}

/**
 * 验证控制流语句的 completion value 语义，与原生 `eval` 对齐。
 *
 * `eval('if(1){2}else{3}')` 得到 `2`，循环/`switch`/`try` 等也有类似的「最后一个非空完成值」
 * 语义。async_eval 通过 AST 插桩复现这一行为。
 *
 * @returns {Promise<void>}
 */
async function testControlFlowCompletion() {
	console.log('\n=== [completion value · if] ===')

	await runEvalCases([
		{ label: 'if 真分支取块内末值', code: 'if(1){2}else{3}', result: 2 },
		{ label: 'if 假分支取 else 块内末值', code: 'if(0){2}else{3}', result: 3 },
		{ label: 'if 无 else 且条件为假返回 undefined', code: 'if(0){2}', result: undefined },
		{ label: 'if 真分支为空块返回 undefined', code: 'if(1){}', result: undefined },
		{ label: 'if 无花括号单语句分支', code: 'if(1) 7', result: 7 },
		{ label: '嵌套 if 取内层分支末值', code: 'if(1){if(0){1}else{2}}', result: 2 },
		{ label: '悬垂 if（内层条件为假）返回 undefined', code: 'if(1) if(0) 1', result: undefined },
		{ label: 'if 内显式 return 优先生效', code: 'if(1){return 5}', result: 5 },
	])

	console.log('\n=== [completion value · 循环] ===')

	await runEvalCases([
		{ label: 'for 取最后一次迭代体的值', code: 'for(let i=0;i<3;i++){i}', result: 2 },
		{ label: 'for 无花括号循环体', code: 'for(let i=0;i<3;i++) i', result: 2 },
		{ label: 'for 零次迭代返回 undefined', code: 'for(let i=0;i<0;i++) i', result: undefined },
		{ label: 'for…of 取最后一次迭代的值', code: 'for(const x of [1,2,3]) x', result: 3 },
		{ label: 'for…in 取最后一个键', code: 'for(let k in {a:1,b:2}) k', result: 'b' },
		{ label: 'while 零次迭代返回 undefined', code: 'while(false) 1', result: undefined },
		{ label: 'while 多次迭代后取分号前末值', code: 'let n=0; while(n<3){n++}; n', result: 3 },
		{ label: 'do…while 至少执行一次取体内值', code: 'do{7}while(false)', result: 7 },
		{ label: 'continue 跳过的迭代不计入完成值', code: 'for(let i=0;i<3;i++){ i; if(i===1) continue; i*10 }', result: 20 },
		{ label: 'continue 出现在末次迭代使完成值回退为 undefined', code: 'for(let i=0;i<2;i++){ i*10; if(i===1) continue }', result: undefined },
		{ label: '带标签的 continue 仍正确求值', code: 'foo: for(let i=0;i<3;i++){ if(i===1) continue foo; i }', result: 2 },
	])

	console.log('\n=== [completion value · switch] ===')

	await runEvalCases([
		{ label: 'switch 命中后贯穿取最后子句值', code: 'switch(2){case 1: 1; case 2: 2}', result: 2 },
		{ label: 'switch 命中后 break 取该子句值', code: 'switch(2){case 1: 1; break; case 2: 2}', result: 2 },
		{ label: 'switch 命中首个子句并 break', code: 'switch(1){case 1: 1; break; default: 2}', result: 1 },
		{ label: 'switch 落入 default 子句', code: 'switch(5){default: 8}', result: 8 },
		{ label: 'switch 无命中且无 default 返回 undefined', code: 'switch(99){case 1: 1}', result: undefined },
	])

	console.log('\n=== [completion value · try/catch/finally] ===')

	await runEvalCases([
		{ label: 'try 正常完成取 try 块末值', code: 'try{2}catch{3}', result: 2 },
		{ label: 'try 抛错由 catch 块接管取其末值', code: 'try{throw 1}catch(e){2}', result: 2 },
		{ label: 'finally 的正常完成值被丢弃', code: 'try{2}finally{3}', result: 2 },
		{ label: 'finally 不覆盖 try 块的完成值', code: 'try{1}finally{}', result: 1 },
		{ label: 'try 块为空时 finally 值仍被丢弃返回 undefined', code: 'try{}finally{9}', result: undefined },
	])

	console.log('\n=== [completion value · 空完成值的延续] ===')

	await runEvalCases([
		{ label: '条件为假的 if 产出 undefined 覆盖前值', code: '1; if(0){2}', result: undefined },
		{ label: '仅含声明的块为空完成值不覆盖前值', code: '9; { let y = 2 }', result: 9 },
		{ label: '零次循环产出 undefined 覆盖前值', code: '1; while(false){2}', result: undefined },
		{ label: '裸块取块内末值', code: '{ 2 }', result: 2 },
	])
}

/**
 * 验证尾随对象字面量中出现花括号字符时仍应可被识别并隐式返回。
 *
 * 这些输入在真实代码里是常见合法写法（字符串、模板串、计算属性、正则都可能含花括号），
 * 但在当前实现下会触发回退路径的边界问题。将其纳入回归测试，便于后续修复时验证。
 *
 * @returns {Promise<void>}
 */
async function testTrailingObjectLiteralBraceCharacters() {
	console.log('\n=== [隐式 return · 花括号字符边界] ===')

	await assertEvalJson({
		label: 'try/catch 后尾随对象字面量支持字符串右花括号',
		code: 'let x = 1;\ntry {} catch {}\n{ a: "}", b: x }',
		result: { a: '}', b: 1 },
	})

	await assertEvalJson({
		label: 'try/catch 后尾随对象字面量支持字符串左花括号',
		code: 'let x = 1;\ntry {} catch {}\n{ a: "{", b: x }',
		result: { a: '{', b: 1 },
	})

	await assertEvalJson({
		label: 'try/catch 后尾随对象字面量支持模板字符串花括号',
		code: 'let x = 1;\ntry {} catch {}\n{ a: `}`, b: x }',
		result: { a: '}', b: 1 },
	})

	await assertEvalJson({
		label: 'try/catch 后尾随对象字面量支持模板表达式后接右花括号',
		code: 'let x = 1;\ntry {} catch {}\n{ a: `${x}}`, b: x }',
		result: { a: '1}', b: 1 },
	})

	await assertEvalJson({
		label: 'try/catch 后尾随对象字面量支持计算属性里的右花括号',
		code: 'let x = 1;\ntry {} catch {}\n{ ["}"]: 1, b: x }',
		result: { '}': 1, b: 1 },
	})

	await assertEvalJson({
		label: 'try/catch 后尾随对象字面量支持正则中的右花括号',
		code: 'let x = 1;\ntry {} catch {}\n{ a: /\\}/.test("}"), b: x }',
		result: { a: true, b: 1 },
	})
}

/**
 * 验证顶层 await 与参数注入。
 *
 * @returns {Promise<void>}
 */
async function testAwaitAndArgs() {
	console.log('\n=== [顶层 await 与参数注入] ===')

	await assertEvalResult({ label: '顶层 await 可求值', code: 'await Promise.resolve(42)', result: 42 })

	/**
	 * @param {number} val - 注入到求值代码中的操作数。
	 * @returns {number} 翻倍后的值。
	 */
	const double = val => val * 2

	await assertEvalResult({
		label: '注入变量与函数可用',
		code: 'x * y + helper(z)',
		result: 54,
		args: { x: 10, y: 5, z: 2, helper: double },
	})
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
	const evalResult = await evalCode(code)

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
 * 验证静态 import 语句被转换为动态 import（含命名、命名空间、副作用与 import attributes）。
 *
 * @returns {Promise<void>}
 */
async function testImportTransformation() {
	console.log('\n=== [import 转换] ===')

	const named = await evalCode(`\
import { sep } from 'path';
sep;
`)
	assert(typeof named.result === 'string', '命名导入 path.sep 为字符串')
	assert(named.result.length, 'path.sep 非空')

	await assertEvalResult({
		label: '命名空间导入可用',
		code: `import * as url from 'url';\ntypeof url.fileURLToPath`,
		result: 'function',
	})

	await assertEvalResult({
		label: '副作用 import 不阻断求值',
		code: `import 'node:assert';\n'ok'`,
		result: 'ok',
	})

	await assertEvalResult({
		label: '默认+命名空间混合导入的默认绑定不丢失',
		code: "import os, * as osAll from 'node:os';\ntypeof os.platform",
		result: 'function',
	})

	// import attributes（`with { type: 'json' }`）须随动态 import 一并保留，否则 JSON 模块加载失败。
	const jsonUrl = 'data:application/json,' + encodeURIComponent('{"v":5}')
	const withAttributes = await evalCode(
		`import data from ${JSON.stringify(jsonUrl)} with { type: 'json' }\ndata.v`,
	)
	assert(withAttributes.error === undefined, '带 import attributes 的 JSON 模块导入不报错')
	assertEqual(withAttributes.result, 5, 'import attributes 被保留以正确加载 JSON 模块')

	const importMeta = await evalCode('import.meta.url')
	assert(importMeta.error === undefined, 'import.meta 改写后 import.meta.url 可用')
	assertEqual(typeof importMeta.result, 'string', 'import.meta.url 为字符串')
}

/**
 * 验证运行时与语法错误通过 `error` 字段返回。
 *
 * @returns {Promise<void>}
 */
async function testErrors() {
	console.log('\n=== [错误处理] ===')

	const runtime = await evalCode('throw new Error("boom")')
	assert(runtime.error instanceof Error, '运行时错误捕获为 Error')
	assertEqual(runtime.error.message, 'boom', '错误消息保留')
	assert(runtime.result === undefined, '出错时无 result')

	const syntax = await evalCode('const x = ;')
	assert(syntax.error instanceof Error, '语法错误捕获为 Error')
	assert(syntax.result === undefined, '语法错误时无 result')
}

/**
 * 验证 export 语法剥离、声明保留与隐式返回。
 *
 * @returns {Promise<void>}
 */
async function testExportSyntax() {
	console.log('\n=== [export · 剥离与求值] ===')

	await assertEvalResult({ label: 'export default 字面量作为结果返回', code: 'export default 42', result: 42 })
	await assertEvalResult({ label: 'export { x } 被剥离后变量仍可求值', code: 'const x = 5;\nexport { x };\nx', result: 5 })
	await assertEvalResult({ label: 'export * from 被移除后续语句仍求值', code: "export * from 'node:os';\n'ok'", result: 'ok' })

	console.log('\n=== [export · 声明隐式返回] ===')

	await runEvalCases([
		{ label: 'export const 末尾声明隐式返回值', code: 'export const x = 7', result: 7 },
		{ label: 'export let 末尾声明隐式返回值', code: 'export let y = 8', result: 8 },
		{ label: 'export var 末尾声明隐式返回值', code: 'export var z = 9', result: 9 },
	])

	console.log('\n=== [export · 具名声明] ===')

	await assertEvalResult({
		label: 'export function 保留可用函数绑定',
		code: 'export function f(){ return 9 }\ntypeof f',
		result: 'function',
	})
	await assertEvalResult({
		label: 'export default function 保留函数绑定',
		code: 'export default function f(){ return 1 }\ntypeof f',
		result: 'function',
	})
	await assertEvalResult({
		label: 'export default class 保留类绑定',
		code: 'export default class C {}\ntypeof C',
		result: 'function',
	})

	console.log('\n=== [export · 匿名 default 与后续语句] ===')

	await runEvalCases([
		{
			label: '匿名 default function 后表达式仍可求值',
			code: 'export default function () { return 1 }\n123',
			result: 123,
		},
		{
			label: '匿名 default async function 后表达式仍可求值',
			code: 'export default async function () { return await Promise.resolve(1) }\n123',
			result: 123,
		},
		{
			label: '匿名 default generator function 后表达式仍可求值',
			code: 'export default function* () { yield 1 }\n123',
			result: 123,
		},
		{
			label: '匿名 default class 后表达式仍可求值',
			code: 'export default class {}\n123',
			result: 123,
		},
		{
			label: '匿名 default class（带继承）后表达式仍可求值',
			code: 'class Base {}\nexport default class extends Base {}\n123',
			result: 123,
		},
		{
			label: '匿名 default async generator function 后表达式仍可求值',
			code: 'export default async function* () { yield 1 }\n123',
			result: 123,
		},
	])
}

/**
 * 运行 async-eval 集成测试分组。
 *
 * @returns {Promise<void>}
 */
export async function runAsyncEvalTests() {
	await runTestGroup('async-eval 求值与输出', [
		testImplicitReturn,
		testControlFlowCompletion,
		testTrailingObjectLiteralBraceCharacters,
		testAwaitAndArgs,
		testConsoleCapture,
		testPerEvalOutputSnapshot,
		testImportTransformation,
		testErrors,
		testExportSyntax,
	])
}
