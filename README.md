# async-eval

[![npm version](https://badge.fury.io/js/@steve02081504/async-eval.svg)](https://badge.fury.io/js/@steve02081504/async-eval)

`async-eval` is a powerful JavaScript utility that asynchronously evaluates code strings. It enhances the standard `eval` by providing support for modern JavaScript features like top-level `import`, implicit returns, and a sandboxed virtual console for capturing logs.

## Features

- **Asynchronous Evaluation**: Evaluates code without blocking the main thread.
- **ESM Import Support**: Handles `import` statements by transforming them into dynamic `import()` expressions.
- **Implicit Return**: Automatically returns the value of the last expression, similar to a browser's developer console.
- **Virtual Console**: Captures all `console` output (`log`, `warn`, `error`, etc.) without polluting the global console.
- **Argument Injection**: Inject variables into the evaluation context.

## Installation

Install the package using npm:

```bash
npm install @steve02081504/async-eval
```

for deno user, you can use `deno.mjs` to get an better compatibility with `node-modules-dir=auto`:

```mjs
import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs';
```

## Usage

Here's a simple example of how to use `async-eval`:

```javascript
import { async_eval } from '@steve02081504/async-eval';

const code = `
  console.log('Hello from the evaluated code!');
  const a = 5;
  const b = 10;
  a + b;
`;

async function run() {
  const { result, output, error } = await async_eval(code);

  if (error) {
    console.error('Evaluation failed:', error);
  } else {
    console.log('--- Captured Console Output ---');
    console.log(output);
    console.log('--- Evaluation Result ---');
    console.log(result); // Output: 15
  }
}

run();
```

### Using Imports

`async-eval` can handle module imports within the evaluated code.

```javascript
import { async_eval } from '@steve02081504/async-eval';

const codeWithImport = `
  import { fileURLToPath } from 'url';
  import { dirname } from 'path';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  console.log('Current directory:', __dirname);
  'import successful';
`;

const { result, output } = await async_eval(codeWithImport);
console.log(output);   // -> Current directory: ...
console.log(result);   // -> 'import successful'
```

### Injecting Arguments

You can pass arguments to the evaluation context.

```javascript
import { async_eval } from '@steve02081504/async-eval';

const code = 'x * y';
const args = { x: 10, y: 5 };

const { result } = await async_eval(code, args);

console.log(result); // -> 50
```

## How It Works

`async-eval` parses the input code into an Abstract Syntax Tree (AST) using `acorn`. It then walks the tree with `estree-walker` to transform `import` and `export` statements and to inject an implicit `return` for the last expression. The modified AST is then converted back into code using `astring` and executed within an `async` function constructor, providing a sandboxed and asynchronous environment.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/steve02081504/async-eval).
