# async-eval

[![npm version](https://badge.fury.io/js/@steve02081504%2Fasync-eval.svg)](https://badge.fury.io/js/@steve02081504%2Fasync-eval)

`async-eval` is a powerful JavaScript utility that asynchronously evaluates code strings. It enhances the standard `eval` by providing support for modern JavaScript features like top-level `import`, implicit returns, and a virtual console for capturing logs.

**Try it in the browser:** <https://steve02081504.github.io/async-eval/>

> [!WARNING]
> `async_eval` runs arbitrary JavaScript with full host privileges.
> There is no sandbox. Treat input like `eval` and only evaluate trusted code.

## Used by

- [GentianAphrodite](https://github.com/steve02081504/GentianAphrodite)
- [fount](https://github.com/steve02081504/fount)

## Features

- **Asynchronous Evaluation**: Evaluates code without blocking the main thread using `AsyncFunction`.
- **ESM Import Support**: Automatically transforms static `import` statements into dynamic `await import()` expressions, supporting default, named, and namespace imports.
- **Implicit Return**: Automatically returns the value of the last expression or variable declaration, similar to a browser's developer console.
- **Completion Values**: Control-flow statements yield their value just like `eval` — `if (1) { 2 } else { 3 }` returns `2`, and `for`/`while`/`do…while`/`switch`/`try` follow the same "last non-empty completion value" semantics.
- **Virtual Console**: Captures all `console` output (`log`, `warn`, `error`, `info`, etc.) and exposes structured [`LogEntry`](https://github.com/steve02081504/virtual-console#results-api) objects, plus aggregated plain-text (`output`) and HTML (`outputHtml`) views—derived from entries on access—with ANSI color and `%c` styling support.
- **Trusted Types Support**: Utilizes `trustedTypes` (if available) to create script policies, making it friendlier for environments with strict Content Security Policies (CSP).
- **Argument Injection**: Bindings from the second argument are available in evaluated code.
- **Scope Isolation**: Evaluated code runs in an `AsyncFunction`, so top-level `var` / `let` / `const` bindings stay function-scoped and do not attach to `globalThis`. Pass state via `args` (or `args.x = …` in the REPL) to share bindings across evaluations.
- **Synchronous Evaluation**: `sync_eval(code, args)` evaluates code synchronously and returns an `EvalResult` directly. Unlike `async_eval`, it does **not** transform static `import` / `import.meta` module syntax, so code containing them fails as a syntax error.

## Installation

```bash
npm install @steve02081504/async-eval
```

### Interactive REPL

#### Web REPL (GitHub Pages)

A static browser REPL lives in [`pages/`](./pages/) and is published to GitHub Pages. It loads `async_eval` from [esm.sh](https://esm.sh) and runs **entirely in your browser** — no backend.

- **Modern UI** — DevTools-style log output and a Shiki-highlighted multiline input
- **Terminal UI** — xterm.js session with the same eval semantics

Open <https://steve02081504.github.io/async-eval/> or serve [`pages/`](./pages/) locally, e.g. `npx serve pages`.

Code executes in the page context (like DevTools). Do not evaluate untrusted input. Static `import` becomes dynamic `import()`; only modules the browser can resolve are available (unlike the Node REPL).

Use `args` to inject bindings, same as the library API:

```javascript
args.x = 10;
args.y = 5;
x * y;
```

#### Terminal REPL (Node.js)

Run from anywhere after install:

```bash
npx @steve02081504/async-eval
```

Syntax-highlighted input, ANSI console capture, colored return values. End a line with `\` to continue. **↑/↓** recalls history; **Ctrl+C** clears input (quits when empty).

Use `args` to inject bindings (same as the second argument to `async_eval`):

```
ae> args.x = 10
← 10
ae> args.y = 5
← 5
ae> x * y
← 50
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

const {
  result = undefined,
  outputEntries,
  output,
  outputHtml,
  error = undefined,
} = await async_eval(code);

if (error) {
  console.error('Evaluation failed:', error);
} else {
  console.log('--- Evaluation Result ---');
  console.log(result); // 15
  console.log('--- Captured Console Output (Structured) ---');
  console.log(
    outputEntries.map((e) => ({ level: e.level, text: e.toPlainText() })),
  ); // [ { level: 'log', text: 'Hello from the evaluated code!\n' }, { level: 'warn', text: 'This is a warning\n' } ]
  console.log('--- Captured Console Output (Plain Text) ---');
  console.log(output); // "Hello from the evaluated code!\nThis is a warning\n"
  console.log('--- Captured Console Output (HTML) ---');
  console.log(outputHtml);
}
```

### Synchronous Evaluation

`sync_eval(code, args)` runs synchronously and returns an `EvalResult` directly (no `await`). It shares the same implicit-return, completion-value, argument-injection, and virtual-console behaviors as `async_eval`, but does **not** transform static `import` / `import.meta` module syntax — code containing them is reported as a syntax error.

```javascript
import { sync_eval } from '@steve02081504/async-eval';

const { result, error, output } = sync_eval(`
  const a = 5;
  const b = 10;
  a + b; // Implicit return
`);
console.log(result); // 15

const { result: injected } = sync_eval('x * y + helper(z)', {
  x: 10,
  y: 5,
  z: 2,
  helper: (val) => val * 2,
});
console.log(injected); // 54
```

### Completion Values

Like `eval`, the value of a trailing control-flow statement becomes the result, following ECMAScript's completion-value semantics:

```javascript
(await async_eval('if (1) { 2 } else { 3 }')).result             ;// -> 2
(await async_eval('for (let i = 0; i < 3; i++) { i }')).result   ;// -> 2
(await async_eval('switch (2) { case 1: 1; case 2: 2 }')).result ;// -> 2
(await async_eval('try { 2 } finally { 3 }')).result             ;// -> 2 (finally value discarded)
(await async_eval('while (false) { 1 }')).result                 ;// -> undefined
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

### Injecting Arguments and Context

Pass a second argument to expose bindings inside the evaluated code:

```javascript
const code = 'x * y + helper(z)';
const args = {
  x: 10,
  y: 5,
  z: 2,
  helper: (val) => val * 2,
};

const { result } = await async_eval(code, args);
console.log(result); // 54
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
console.log(myConsole.outputs); // plain-text aggregation on the shared console
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

Do not run concurrent `async_eval` calls against the same shared `VirtualConsole`; captured logs may interleave (see [Console capture](#console-capture)).

### Remote display (JSON / WebSocket)

Wire and serialization helpers live in [`@steve02081504/virtual-console`](https://github.com/steve02081504/virtual-console) — the same tools that power log wire and DevTools-style rendering.

**Server: build a JSON payload**

```javascript
import { async_eval } from '@steve02081504/async-eval';
import { serializeArgSnapshot } from '@steve02081504/virtual-console/node';

const result = await async_eval(`
  console.log({ ok: true });
  ({ n: 1 });
`);

const payload = {
  outputEntries: result.outputEntries,
  ...('result' in result && { result: serializeArgSnapshot(result.result) }),
  ...('error' in result && { error: serializeArgSnapshot(result.error) }),
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
  document.body.insertAdjacentHTML(
    'beforeend',
    renderHtml([{ kind: 'value', snapshot: payload.result }]),
  );
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

For cross-network payloads, serialize `outputEntries` with `LogEntry#toJSON()` and `result` / `error` with `serializeArgSnapshot` from `@steve02081504/virtual-console/node` or `/browser` — see [Remote display](#remote-display-json--websocket). Import `LogEntry` types from the same package.

## How It Works

1. **Parsing**: The input code is parsed into an Abstract Syntax Tree (AST) using `acorn`.
2. **Transformation**:
   - **Imports**: `import` declarations are converted into `await import()` calls. Destructuring is applied to simulate named and default imports.
   - **Exports**: `export` keywords are removed (variables become local to the scope).
   - **Implicit Return**: The walker finds the last statement. If it's an expression or a variable declaration, it wraps it in a `return` statement.
3. **Generation**: The modified AST is converted back to JavaScript code using `astring`.
4. **Trusted Types**: If available, a `trustedTypes` policy named `async-eval-policy` is created to sanitize the script generation.
5. **Execution**: The code is executed via `AsyncFunction` in `lib/eval_runner.mjs` so Deno can recognize evaluated `import()` calls.
6. **Console capture**: A `VirtualConsole` is hooked into the async context to capture logs for that execution.

## Environment Differences

- **Node.js / Web**: When `globalThis.trustedTypes` is available, script generation goes through a policy named `async-eval-policy`.
- **Deno**: Installs `registerHooks` on load (see [`lib/deno/register_hooks.mjs`](./lib/deno/register_hooks.mjs)) so evaluated `import()` resolves in Deno-native style. Use `npm:` to import the library and set `"nodeModulesDir": "auto"` in `deno.json`.

## Limitations

Behavior that differs from native `eval`, browser DevTools, or strict Content Security Policy (CSP) environments.

### `import.meta`

`import.meta` is not valid inside `AsyncFunction` bodies. The transformer expands each occurrence to a dynamic `import()` of a tiny `data:text/javascript,…` module whose default export is that module's own `import.meta`—no extra bindings are injected. Two caveats remain:

1. **CSP** — Strict `script-src` policies often block `data:` URIs. Evaluated code that reads `import.meta` may fail on locked-down browser pages.
2. **URL semantics** — `import.meta.url` resolves to the `data:` module URL, not the host page or source file URL you would get from native ESM.

### Console capture

Each call runs inside [`VirtualConsole#hookAsyncContext`](https://github.com/steve02081504/virtual-console#methods). Evaluated code receives `console` as an injected binding, so `console.log(…)` is always captured by that instance. `globalThis.console` goes through virtual-console's global proxy and depends on async-context routing.

**Shared console, concurrent calls.** Overlapping evaluations on one `VirtualConsole` can interleave log capture: each `EvalResult` snapshots `outputEntries` from a start index, so concurrent runs may include each other's logs. Prefer a dedicated `VirtualConsole` per concurrent evaluation, or await one call before starting the next.

**Node.js.** `hookAsyncContext` uses `AsyncLocalStorage`, so child async work (timers, I/O continuations) keeps the correct console for `globalThis.console`. When calls run sequentially, reusing one shared `VirtualConsole` scopes each `EvalResult`'s `outputEntries`, `output`, and `outputHtml` to that evaluation alone.

**Browser.** Context routing uses a save/restore stack rather than `AsyncLocalStorage`. It follows synchronous code and `await` chains, but macro-tasks started inside evaluated code—such as bare `setTimeout` / `setInterval` callbacks—do not inherit the context. `globalThis.console` from those callbacks may miss capture or hit the wrong console; use the injected `console` binding instead.

### Scope vs. browser DevTools

Top-level bindings in evaluated code are function-scoped (see [Scope Isolation](#scope-isolation) above) and do not appear on `globalThis`, unlike variables declared in the browser DevTools console. Use `args` to persist bindings across REPL lines or multiple `async_eval` calls.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/steve02081504/async-eval).
