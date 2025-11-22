import { passed, failed, failures, resetHarness } from '../../harness.mjs'

import { runAsyncEvalTests } from './async-eval.mjs'

/**
 * 运行全部集成测试套件并汇总结果。
 */
export async function runAllTests() {
	resetHarness()
	console.log('🚀 开始运行所有测试...\n')
	await runAsyncEvalTests()

	console.log(`\n${'='.repeat(50)}`)
	if (failed === 0)
		console.log(`✅ 全部通过！共 ${passed} 项测试。`)
	else {
		console.log(`\n❌ 测试结束：${passed} 通过，${failed} 失败。`)
		console.log(`\n── 失败汇总（共 ${failures.length} 条）──`)
		for (let i = 0; i < failures.length; i++)
			console.log(`\n${i + 1}. ${failures[i]}`)
		console.log('')
		process.exit(1)
	}
}
