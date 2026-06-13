# async-eval

[![npm version](https://badge.fury.io/js/@steve02081504%2Fasync-eval.svg)](https://badge.fury.io/js/@steve02081504%2Fasync-eval)

`async-eval` is a powerful JavaScript utility that asynchronously evaluates code strings. It enhances the standard `eval` by providing support for modern JavaScript features like top-level `import`, implicit returns, and a virtual console for capturing logs.

## Used by

- [GentianAphrodite](https://github.com/steve02081504/GentianAphrodite)
- [fount](https://github.com/steve02081504/fount)

## Features

- **Asynchronous Evaluation**: Evaluates code without blocking the main thread using `AsyncFunction`.
- **ESM Import Support**: Automatically transforms static `import` statements into dynamic `await import()` expressions, supporting default, named, and namespace imports.
- **Implicit Return**: Automatically returns the value of the last expression or variable declaration, similar to a browser's developer console.
- **Virtual Console**: Captures all `console` output (`log`, `warn`, `error`, `info`, etc.) and exposes structured [`LogEntry`](https://github.com/steve02081504/virtual-console#results-api) objects, plus aggregated plain-text (`output`) and HTML (`outputHtml`) views—derived from entries on access—with ANSI color and `%c` styling support.
- **Trusted Types Support**: Utilizes `trustedTypes` (if available) to create script policies, making it friendlier for environments with strict Content Security Policies (CSP).
- **Argument Injection**: Bindings from the second argument are available in evaluated code.

## Installation

```bash
npm install @steve02081504/async-eval
```

### Interactive REPL

An interactive REPL is included for exploring `async_eval` in the terminal (Node.js only).

```bash
# from the package root after install
npm run repl
# or
node scripts/repl.mjs
```

Each input line is evaluated with the same semantics as `async_eval`: top-level `await`, static `import`, implicit return, and virtual `console` capture.

After each evaluation, the REPL prints separate blocks for:

- **Captured console (ANSI)** — colored output from `VirtualConsole` (`output`)
- **Captured console (plain)** — plain-text logs via `LogEntry#toPlainText()`
- **Captured console (HTML)** — joined HTML (`outputHtml`)
- **Error** — when evaluation throws or fails to parse
- **Result** — the return value, formatted with `util.inspect` (colors enabled)

Use the REPL variable `args` to inject bindings (same as the second argument to `async_eval`):

```
ae> args.x = 10
ae> args.y = 5
ae> x * y
```

Exit with `.exit` or Ctrl+D.

### For Deno Users

For Deno, a specific entry point `deno.mjs` is provided which uses static imports for better compatibility with Deno's handling of npm specifiers.

```javascript
// Using jsDelivr
import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs';
```

## Usage

`async_eval(code)` asynchronously evaluates a string and yields an `EvalResult` holding the return value, any error, and captured console output:

```javascript
import { async_eval } from '@steve02081504/async-eval';

const code = `\
console.log('Hello from the evaluated code!');
console.warn('This is a warning');
const a = 5;
const b = 10;
a + b; // Implicit return
`;

async function run() {
	const evalResult = await async_eval(code);
	const { result, outputEntries, output, outputHtml, error } = evalResult;

	if (error) {
		console.error('Evaluation failed:', error);
	} else {
		console.log('--- Evaluation Result ---');
		console.log(result); // Output: 15

		console.log('--- Captured Console Output (Structured) ---');
		console.log(outputEntries.map(e => ({ level: e.level, text: e.toPlainText() })));
		// Output: [{ level: 'log', text: 'Hello from the evaluated code!\n' }, { level: 'warn', text: 'This is a warning\n' }]

		console.log('--- Captured Console Output (Text) ---');
		console.log(output);
		// Output: 'Hello from the evaluated code!\nThis is a warning\n'

		console.log('--- Captured Console Output (HTML) ---');
		console.log(outputHtml);
	}
}

run();
```

### Using Imports

`async-eval` transforms `import` statements so they work inside the evaluation context (which normally doesn't support static imports).

```javascript
const codeWithImport = `\
// Namespace import
import * as path from 'path';

// Named import
import { fileURLToPath } from 'url';

console.log('Path sep:', path.sep);
'import successful';
`;

const { result, output } = await async_eval(codeWithImport);
```

*Note: The evaluated code behaves as if it is inside an `async` function.*

### Injecting Arguments and Context

Pass a second argument to expose bindings inside the evaluated code:

```javascript
const code = 'x * y + helper(z)';
const args = { 
	x: 10, 
	y: 5, 
	z: 2,
	helper: (val) => val * 2 
};

const { result } = await async_eval(code, args);
console.log(result); // -> 54 (10 * 5 + 2 * 2)
```

### Advanced: Custom Console

By default, `async-eval` provisions a fresh [`VirtualConsole`](https://github.com/steve02081504/virtual-console). Supply your own via `{ console: ... }` to share one across multiple evaluations:

```javascript
import { VirtualConsole } from '@steve02081504/virtual-console';

const myConsole = new VirtualConsole({ realConsoleOutput: true });
const args = { console: myConsole };

await async_eval("console.log('Session 1')", args);
await async_eval("console.log('Session 2')", args);

console.log(myConsole.outputEntries.length); // entries from both sessions
console.log(myConsole.outputs);              // plain-text aggregation on the shared console
```

### Advanced: Structured output for frontends

For UI rendering (log levels, per-line HTML, stack traces), iterate **`outputEntries`**—the same shape as [`VirtualConsole.outputEntries`](https://github.com/steve02081504/virtual-console#results-api). Reach for **`output`** or **`outputHtml`** when a single joined string is enough:

```javascript
const { result, outputEntries, error } = await async_eval(`
  console.log('step 1');
  console.warn('slow path');
  42;
`);

if (!error) {
  for (const entry of outputEntries) {
    // entry.level, entry.method, entry.stack, entry.toHtml(), …
    document.body.insertAdjacentHTML('beforeend', entry.toHtml());
  }
}
```

Each `LogEntry` supports `toPlainText()`, `toString()` (ANSI), `toHtml()`, `toSegments()`, and `serializeArgs()` — see the [virtual-console Results API](https://github.com/steve02081504/virtual-console#results-api) for the full surface.

When a `VirtualConsole` is shared across calls, each `EvalResult` still scopes `outputEntries`, `output`, and `outputHtml` to that evaluation alone.

### Remote display (JSON / WebSocket)

Wire and serialization helpers live in [`@steve02081504/virtual-console`](https://github.com/steve02081504/virtual-console) — the same tools that power log wire and DevTools-style rendering.

**Server: build a JSON payload**

```javascript
import { async_eval } from '@steve02081504/async-eval';
import { serializeArgSnapshot } from '@steve02081504/virtual-console/node';

const { result, error, outputEntries } = await async_eval(`
  console.log({ ok: true });
  ({ n: 1 });
`);

const payload = {
  outputEntries: outputEntries.map(entry => entry.toJSON()),
  ...(result !== undefined && { result: serializeArgSnapshot(result) }),
  ...(error !== undefined && { error: serializeArgSnapshot(error) }),
};

const json = JSON.stringify(payload);
```

- **`outputEntries`** — `LogEntry#toJSON()`; same shape as [log wire](https://github.com/steve02081504/virtual-console#log-wire-protocol-websocket-json) `vc_log_append`.
- **`result` / `error`** — `serializeArgSnapshot` produces [`ArgSnapshot`](https://github.com/steve02081504/virtual-console#typescript) trees safe for JSON. Pass `{ maxDepth: 4 }` as the second argument to cap depth; deep graphs may emit `truncated` refs expandable via `vc_expand_request` / `expandSnapshotRef`.

**Client: render logs and return value**

```javascript
import { WireLogEntry } from '@steve02081504/virtual-console/wire/client';
import { renderHtml } from '@steve02081504/virtual-console/browser';

const payload = JSON.parse(json);

for (const entryJson of payload.outputEntries) {
  const wire = new WireLogEntry(entryJson, { requestExpand: async () => null });
  document.body.insertAdjacentHTML('beforeend', await wire.renderHtml());
}

if (payload.result)
  document.body.insertAdjacentHTML('beforeend', renderHtml([{ kind: 'value', snapshot: payload.result }]));
```

For live streaming instead of one-shot payloads, mount [`createLogWireWebSocketHandler`](https://github.com/steve02081504/virtual-console#log-wire-protocol-websocket-json) on a shared `VirtualConsole` and pass that console into `async_eval` via `{ console: myConsole }`.

## Return Value

`async_eval` resolves to an **`EvalResult`**:

```typescript
class EvalResult {
	result?: any;               // return value when evaluation succeeds
	error?: Error;              // populated when evaluation fails
	outputEntries: LogEntry[];  // this eval's log entries only
	get output(): string;       // plain/ANSI text joined from outputEntries
	get outputHtml(): string;   // HTML joined from outputEntries
}
```

`output` and `outputHtml` aggregate the snapshotted entries on read—they are not computed until accessed.

For cross-network payloads, serialize `outputEntries` with `LogEntry#toJSON()` and `result` / `error` with `serializeArgSnapshot` from `@steve02081504/virtual-console/node` or `/browser` — see [Remote display](#remote-display-json--websocket). Import `LogEntry` types from the same package.

## How It Works

1. **Parsing**: The input code is parsed into an Abstract Syntax Tree (AST) using `acorn`.
2. **Transformation**:
    - **Imports**: `import` declarations are converted into `await import()` calls. Destructuring is applied to simulate named and default imports.
    - **Exports**: `export` keywords are removed (variables become local to the scope).
    - **Implicit Return**: The walker finds the last statement. If it's an expression or a variable declaration, it wraps it in a `return` statement.
3. **Generation**: The modified AST is converted back to JavaScript code using `astring`.
4. **Trusted Types**: If available, a `trustedTypes` policy named `async-eval-policy` is created to sanitize the script generation.
5. **Execution**: The code is executed using the `AsyncFunction` constructor (`(async x => x).constructor`).
6. **Console capture**: A `VirtualConsole` is hooked into the async context to capture logs for that execution.

## Environment Differences

- **Node.js / Web (`main.mjs`)**: The `VirtualConsole` is imported dynamically. If the environment restricts dynamic imports, it may fail gracefully (though it is a dependency). It also uses `globalThis.trustedTypes` for security policies.
- **Deno (`deno.mjs`)**: Uses static imports for the `VirtualConsole` to ensure compatibility with Deno's module resolution, especially when using `npm:` specifiers.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/steve02081504/async-eval).
