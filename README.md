# async-eval

[![npm version](https://badge.fury.io/js/@steve02081504/async-eval.svg)](https://badge.fury.io/js/@steve02081504/async-eval)

`async-eval` is a powerful JavaScript utility that asynchronously evaluates code strings. It enhances the standard `eval` by providing support for modern JavaScript features like top-level `import`, implicit returns, and a sandboxed virtual console for capturing logs.

## Features

- **Asynchronous Evaluation**: Evaluates code without blocking the main thread using `AsyncFunction`.
- **ESM Import Support**: Automatically transforms static `import` statements into dynamic `await import()` expressions, supporting default, named, and namespace imports.
- **Implicit Return**: Automatically returns the value of the last expression or variable declaration, similar to a browser's developer console.
- **Virtual Console**: Captures all `console` output (`log`, `warn`, `error`, `info`, etc.) and provides both raw text and HTML formatted output with ANSI color and `%c` styling support.
- **Trusted Types Support**: Utilizes `trustedTypes` (if available) to create script policies, making it friendlier for environments with strict Content Security Policies (CSP).
- **Argument Injection**: Inject variables into the evaluation context.

## Installation

Install the package using npm:

```bash
npm install @steve02081504/async-eval
```

### For Deno Users

For Deno, a specific entry point `deno.mjs` is provided which uses static imports for better compatibility with Deno's handling of npm specifiers.

```javascript
// Using jsDelivr
import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs';
```

## Usage

Here's a comprehensive example of how to use `async-eval`:

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
	// The return object contains result, output (array), outputHtml (array), and error (if any)
	const { result, output, outputHtml, error } = await async_eval(code);

	if (error) {
		console.error('Evaluation failed:', error);
	} else {
		console.log('--- Evaluation Result ---');
		console.log(result); // Output: 15
		
		console.log('--- Captured Console Output (Text) ---');
		console.log(output); 
		// Output: ['Hello from the evaluated code!', 'This is a warning']
		
		console.log('--- Captured Console Output (HTML) ---');
		console.log(outputHtml);
		// Useful for displaying logs in a web UI
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

You can pass arguments to the evaluation context. This is useful for exposing variables or functions to the evaluated code.

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

By default, `async-eval` creates a new [`VirtualConsole` instance](https://github.com/steve02081504/virtual-console). You can pass your own console instance (or reuse one) via the `console` property in arguments.

```javascript
import { VirtualConsole } from '@steve02081504/virtual-console';

const myConsole = new VirtualConsole({ realConsoleOutput: true });
const args = { console: myConsole };

await async_eval("console.log('Session 1')", args);
await async_eval("console.log('Session 2')", args);

console.log(myConsole.outputs); // Contains logs from both sessions
```

## Return Value

The `async_eval` function returns a Promise that resolves to an object with the following structure:

```typescript
{
	result?: any;          // The return value of the last executed statement
	output: string[];      // Array of console log strings
	outputHtml: string[];  // Array of console logs formatted as HTML strings
	error?: Error;         // The error object if evaluation failed
}
```

## How It Works

1. **Parsing**: The input code is parsed into an Abstract Syntax Tree (AST) using `acorn`.
2. **Transformation**:
    - **Imports**: `import` declarations are converted into `await import()` calls. Destructuring is applied to simulate named and default imports.
    - **Exports**: `export` keywords are removed (variables become local to the scope).
    - **Implicit Return**: The walker finds the last statement. If it's an expression or a variable declaration, it wraps it in a `return` statement.
3. **Generation**: The modified AST is converted back to JavaScript code using `astring`.
4. **Trusted Types**: If available, a `trustedTypes` policy named `async-eval-policy` is created to sanitize the script generation.
5. **Execution**: The code is executed using the `AsyncFunction` constructor (`(async x => x).constructor`).
6. **Sandboxing**: A `VirtualConsole` is hooked into the async context to capture logs specifically for that execution.

## Environment Differences

- **Node.js / Web (`main.mjs`)**: The `VirtualConsole` is imported dynamically. If the environment restricts dynamic imports, it may fail gracefully (though it is a dependency). It also uses `globalThis.trustedTypes` for security policies.
- **Deno (`deno.mjs`)**: Uses static imports for the `VirtualConsole` to ensure compatibility with Deno's module resolution, especially when using `npm:` specifiers.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/steve02081504/async-eval).
