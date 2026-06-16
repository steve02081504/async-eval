import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * 运行 `npm install <specifier> --no-save`，返回是否成功。
 * @param {string} specifier - 包名（可带版本）。
 * @param {string} [cwd=PACKAGE_ROOT] - 安装目录（应为 package.json 所在目录）。
 * @returns {Promise<boolean>} 安装是否成功退出。
 */
function npmInstall(specifier, cwd = PACKAGE_ROOT) {
	return new Promise(resolve => {
		const npmProcess = spawn(
			'npm',
			['install', specifier, '--no-save', '--no-audit', '--no-fund', '--loglevel=error'],
			{ cwd, stdio: 'inherit', shell: process.platform === 'win32' },
		)
		npmProcess.on('error', () => resolve(0))
		npmProcess.on('close', code => resolve(!code))
	})
}

/**
 * 懒加载模块；首次缺失（`ERR_MODULE_NOT_FOUND`）时按需 `npm install` 后重试。
 * 安装或二次加载仍失败则返回 `null`，由调用方决定降级行为。
 * @param {string} specifier - 包名。
 * @param {{ cwd?: string, onInstall?: (specifier: string) => void }} [options] - 安装目录与安装前回调。
 * @returns {Promise<Record<string, unknown> | null>} 模块命名空间，失败时返回 `null`。
 */
export async function importOrInstall(specifier, { cwd, onInstall } = {}) {
	try {
		return await import(specifier)
	} catch (error) {
		if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
	}
	onInstall?.(specifier)
	if (!await npmInstall(specifier, cwd)) return null
	try {
		return await import(specifier)
	} catch {
		return null
	}
}
