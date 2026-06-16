/** 补全候选项的展示上限。 */
export const COMPLETION_LIMIT = 50

/** @type {ReadonlySet<string>} */
const JS_KEYWORDS = new Set([
	'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
	'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
	'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
	'new', 'null', 'of', 'return', 'super', 'switch', 'this', 'throw', 'true',
	'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
])

/**
 * 查找不在字符串/模板字面量内的最后一个 `.`（成员补全的分隔点）。
 * @param {string} before - 光标前的代码。
 * @returns {number} 最后一个合法 `.` 的下标，无则为 `-1`。
 */
function findLastDotOutsideStrings(before) {
	let inSingle = false
	let inDouble = false
	let inTemplate = false
	let escape = false
	let lastDot = -1
	for (let index = 0; index < before.length; index++) {
		const char = before[index]
		if (escape) { escape = false; continue }
		if (char === '\\') { escape = true; continue }
		if (!inDouble && !inTemplate && char === '\'') { inSingle = !inSingle; continue }
		if (!inSingle && !inTemplate && char === '"') { inDouble = !inDouble; continue }
		if (!inSingle && !inDouble && char === '`') { inTemplate = !inTemplate; continue }
		if (!inSingle && !inDouble && !inTemplate && char === '.') lastDot = index
	}
	return lastDot
}

/**
 * 解析光标处的补全上下文：成员补全（`obj.frag`）或标识符补全（`frag`）。
 * @param {string} code - 完整输入代码。
 * @param {number} cursor - 光标位置（字符下标）。
 * @returns {{ kind: 'member', receiver: string, fragment: string, replaceStart: number, replaceEnd: number }
 *   | { kind: 'identifier', fragment: string, replaceStart: number, replaceEnd: number }
 *   | null} 补全上下文；无法补全时返回 `null`。
 */
export function parseCompletionContext(code, cursor) {
	const before = code.slice(0, Math.max(0, Math.min(cursor, code.length)))
	const lastDot = findLastDotOutsideStrings(before)
	if (lastDot >= 0) {
		const receiver = before.slice(0, lastDot).trimEnd()
		if (!receiver) return null
		return { kind: 'member', receiver, fragment: before.slice(lastDot + 1), replaceStart: lastDot + 1, replaceEnd: cursor }
	}
	const fragment = before.match(/[\w$]*$/)[0]
	if (!fragment) return null
	return { kind: 'identifier', fragment, replaceStart: cursor - fragment.length, replaceEnd: cursor }
}

/**
 * 已输入文本与候选项的公共前缀长度（忽略大小写）。
 * @param {string} typed - 用户已输入的片段。
 * @param {string} candidate - 候选项名称。
 * @returns {number} 公共前缀字符数。
 */
function sharedPrefixLength(typed, candidate) {
	let length = 0
	while (length < typed.length && length < candidate.length
		&& typed[length].toLowerCase() === candidate[length].toLowerCase())
		length++
	return length
}

/**
 * 按已输入片段（忽略大小写前缀）筛选候选项。
 * @param {string} fragment - 用户已输入的标识符片段。
 * @param {Iterable<string>} names - 候选名称集合。
 * @returns {string[]} 匹配前缀的候选项列表。
 */
export function filterByCompletionPrefix(fragment, names) {
	return [...names].filter(name => sharedPrefixLength(fragment, name) === fragment.length)
}

/**
 * 候选项相对已输入文本的“幽灵”补全后缀（用于内联预览）；不构成纯追加则为空串。
 * @param {string} typed - 用户已输入的片段。
 * @param {string} candidate - 候选项名称。
 * @returns {string} 可幽灵显示的后缀，无可追加内容时为空串。
 */
function ghostSuffix(typed, candidate) {
	const matched = sharedPrefixLength(typed, candidate)
	return matched < typed.length || matched >= candidate.length ? '' : candidate.slice(matched)
}

/**
 * 为补全结果补充每个候选项的幽灵后缀。
 * @param {string} code - 完整输入代码。
 * @param {{ items: string[], replaceStart: number, replaceEnd: number }} result - 原始补全结果。
 * @returns {{ items: string[], replaceStart: number, replaceEnd: number, suffixes: string[] }}
 *   附带 `suffixes` 数组的补全载荷。
 */
export function enrichCompletionPayload(code, { items, replaceStart, replaceEnd }) {
	const typed = code.slice(replaceStart, replaceEnd)
	return { items, replaceStart, replaceEnd, suffixes: items.map(item => ghostSuffix(typed, item)) }
}

/**
 * 收集匹配片段的全局标识符与关键字候选。
 * @param {string} fragment - 用户已输入的标识符片段。
 * @returns {string[]} 排序并截断后的候选项列表。
 */
export function collectGlobalCandidates(fragment) {
	const names = new Set(JS_KEYWORDS)
	for (const name of Object.getOwnPropertyNames(globalThis))
		if (/^[\w$]+$/.test(name)) names.add(name)
	return filterByCompletionPrefix(fragment, names).sort().slice(0, COMPLETION_LIMIT)
}

/**
 * 收集对象及其原型链上的可补全属性名。对象可能是任意运行期值（含会抛错的 Proxy），故遍历容错。
 * @param {unknown} object - 成员补全的接收者对象。
 * @param {number} [limit] - 返回候选项数量上限。
 * @returns {string[]} 排序并截断后的属性名列表。
 */
export function collectPropertyNames(object, limit = COMPLETION_LIMIT) {
	const names = new Set()
	const seen = new Set()
	let current = object
	while (current && current !== Object.prototype && typeof current === 'object' && !seen.has(current)) {
		seen.add(current)
		try {
			for (const name of Object.getOwnPropertyNames(current))
				if (name !== 'constructor' && !name.startsWith('__') && /^[\w$]+$/.test(name)) names.add(name)
			current = Object.getPrototypeOf(current)
		} catch { break }
	}
	return [...names].sort().slice(0, limit)
}
