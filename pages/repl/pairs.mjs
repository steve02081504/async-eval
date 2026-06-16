/** 开符号 → 闭符号。 @type {ReadonlyMap<string, string>} */
const OPEN_TO_CLOSE = new Map([
	['\'', '\''], ['"', '"'], ['`', '`'],
	['(', ')'], ['[', ']'], ['{', '}'],
])

/** @type {ReadonlySet<string>} */
const CLOSE_CHARS = new Set(OPEN_TO_CLOSE.values())

/**
 * 取 `offset` 左侧的一个完整码点（正确跨越代理对）。
 * @param {string} text - 输入字符串。
 * @param {number} offset - 光标位置（字符下标）。
 * @returns {string | null} 左侧完整码点，越界时返回 `null`。
 */
function charBefore(text, offset) {
	if (offset <= 0) return null
	const lastIndex = offset - 1
	const isLowSurrogate = text.charCodeAt(lastIndex) >= 0xDC00 && text.charCodeAt(lastIndex) <= 0xDFFF
	return String.fromCodePoint(text.codePointAt(isLowSurrogate && lastIndex >= 1 ? lastIndex - 1 : lastIndex))
}

/**
 * 取 `offset` 处的一个完整码点。
 * @param {string} text - 输入字符串。
 * @param {number} offset - 光标位置（字符下标）。
 * @returns {string | null} 该位置的完整码点，越界时返回 `null`。
 */
function charAt(text, offset) {
	return offset >= text.length ? null : String.fromCodePoint(text.codePointAt(offset))
}

/**
 * 插入字符并处理自动配对：开符号补闭符号、闭符号遇到既有闭符号则跳过。
 * @param {string} value - 当前输入全文。
 * @param {number} caret - 插入位置。
 * @param {string} char - 待插入的单个字符。
 * @returns {{ value: string, caret: number }} 更新后的文本与光标位置。
 */
export function editInsertChar(value, caret, char) {
	const close = OPEN_TO_CLOSE.get(char)
	if (close !== undefined)
		return { value: value.slice(0, caret) + char + close + value.slice(caret), caret: caret + char.length }
	if (CLOSE_CHARS.has(char) && charAt(value, caret) === char)
		return { value, caret: caret + char.length }
	return { value: value.slice(0, caret) + char + value.slice(caret), caret: caret + char.length }
}

/**
 * 退格：删除左侧码点，若其与右侧恰好构成配对则一并删除。
 * @param {string} value - 当前输入全文。
 * @param {number} caret - 退格位置。
 * @returns {{ value: string, caret: number } | null} 更新后的文本与光标；无法退格时返回 `null`。
 */
export function editBackspace(value, caret) {
	const before = charBefore(value, caret)
	if (!before) return null
	const after = charAt(value, caret)
	const removeAfter = after && OPEN_TO_CLOSE.get(before) === after ? after.length : 0
	return {
		value: value.slice(0, caret - before.length) + value.slice(caret + removeAfter),
		caret: caret - before.length,
	}
}

/**
 * 该输入事件是否需要自动配对处理（插入配对符号或退格）。
 * @param {InputEvent} event - `beforeinput` 事件。
 * @returns {boolean} 需要拦截并自定义处理时为 `true`。
 */
export function isPairInputEvent(event) {
	if (event.inputType === 'insertText' && event.data?.length === 1)
		return OPEN_TO_CLOSE.has(event.data) || CLOSE_CHARS.has(event.data)
	return event.inputType === 'deleteContentBackward'
}
