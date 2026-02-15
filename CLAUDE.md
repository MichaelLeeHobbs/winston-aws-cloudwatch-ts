# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Winston transport for AWS CloudWatch Logs, written in TypeScript. Uses AWS SDK v3, Bottleneck for rate limiting, and publishes as dual ESM/CJS with type declarations via tsup. Package: `@ubercode/winston-cloudwatch`, requires Node.js >= 20.9.0.

## Commands

```bash
pnpm install                  # Install dependencies
pnpm run build                # Build ESM + CJS + type declarations to dist/
pnpm run build:watch          # Build in watch mode
pnpm run test                 # Format check + lint + unit tests
pnpm run test:unit            # Jest unit tests only
pnpm run test:cover           # Jest with coverage
pnpm run test:watch           # Jest in watch mode
npx jest tests/unit/Queue.spec.ts             # Run a single test file
npx jest --testNamePattern="pattern"          # Run tests matching a name
pnpm run test:lint            # ESLint
pnpm run lint                 # ESLint with --fix
pnpm run test:format          # Prettier check
pnpm run format               # Prettier write
```

## Architecture

Data flows through a pipeline: **Winston Logger → CloudWatchTransport → Relay → CloudWatchClient → AWS CloudWatch Logs API**.

- **CloudWatchTransport** (`src/CloudWatchTransport.ts`) — Winston Transport subclass. Entry point that receives log calls and passes `LogItem` objects to the Relay.
- **Relay\<T\>** (`src/Relay.ts`) — Generic batching/throttling layer. Uses Bottleneck for rate limiting, a Queue for buffering, and submits batches to any `RelayClient<T>` on a configurable interval. Handles retry on `InvalidSequenceTokenException`.
- **CloudWatchClient** (`src/CloudWatchClient.ts`) — Implements `RelayClient<LogItem>`. Manages the AWS SDK client, sequence token tracking, and optional auto-creation of log groups/streams.
- **CloudWatchEventFormatter** (`src/CloudWatchEventFormatter.ts`) — Converts `LogItem` to CloudWatch `InputLogEvent`. Default format: `[LEVEL] message {metadata}`. Customizable via formatter options.
- **Queue\<T\>** (`src/Queue.ts`) — Simple FIFO queue (array-backed) with `push`, `head(n)`, `remove(n)`, `size`.
- **LogItem** (`src/LogItem.ts`) — Readonly interface representing a log entry: `date`, `level`, `message`, `meta`, `callback`.
- **Barrel** (`src/index.ts`) — Re-exports all public modules. Default export is `CloudWatchTransport`.

## Code Conventions

- **PascalCase filenames** matching the class/type they export
- **TypeScript strict mode** with `@typescript-eslint/no-explicit-any` as error
- No semicolons, single quotes, 100-char line width, ES5 trailing commas (Prettier)
- Unused parameters prefixed with `_`
- Private fields/methods use `_` prefix **only** when a public getter shares the same name (e.g. `private readonly _date` + `get date()`); otherwise no prefix
- Consistent inline type imports (`import { type Foo } from ...`)
- Generics for flexibility (`Relay<T>`, `RelayClient<T>`, `Queue<T>`)

## Testing

- Jest with ts-jest preset, tests in `tests/unit/`
- AWS SDK calls stubbed with Sinon
- `tests/helpers/MockClient.ts` provides `MockClient` implementing `RelayClient` for Relay tests
- Coverage excludes `src/index.ts` (barrel) and `*.d.ts`

## Build Output

- Built with tsup (`tsup.config.ts`)
- ESM → `dist/index.mjs`
- CJS → `dist/index.js`
- Type declarations → `dist/index.d.ts`, `dist/index.d.mts`
- Source maps included
- tsconfig.json is IDE-only (noEmit)
