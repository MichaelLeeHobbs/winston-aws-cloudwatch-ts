# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Winston transport for AWS CloudWatch Logs, written in TypeScript. Uses AWS SDK v3, Bottleneck for rate limiting, and publishes as CommonJS with type declarations. Package: `winston-aws-cloudwatch-ts`, requires Node.js >= 20.9.0.

## Commands

```bash
pnpm install                  # Install dependencies
pnpm run build                # Clean + build CJS + type declarations to dist/
pnpm run test                 # Format check + lint + unit tests
pnpm run test:unit            # Jest unit tests only
pnpm run test:cover           # Jest with coverage
pnpm run test:watch           # Jest in watch mode
npx jest tests/unit/queue.spec.ts           # Run a single test file
npx jest --testNamePattern="pattern"        # Run tests matching a name
pnpm run test:lint            # ESLint
pnpm run lint                 # ESLint with --fix
pnpm run test:format          # Prettier check
pnpm run format               # Prettier write
```

## Architecture

Data flows through a pipeline: **Winston Logger → CloudWatchTransport → Relay → CloudWatchClient → AWS CloudWatch Logs API**.

- **CloudWatchTransport** (`src/index.ts`) — Winston Transport subclass. Entry point that receives log calls and passes `LogItem` objects to the Relay.
- **Relay\<T\>** (`src/relay.ts`) — Generic batching/throttling layer. Uses Bottleneck for rate limiting, a Queue for buffering, and submits batches to any `RelayClient<T>` on a configurable interval. Handles retry on `InvalidSequenceTokenException`.
- **CloudWatchClient** (`src/cloudwatch-client.ts`) — Implements `RelayClient<LogItem>`. Manages the AWS SDK client, sequence token tracking, and optional auto-creation of log groups/streams.
- **CloudWatchEventFormatter** (`src/cloudwatch-event-formatter.ts`) — Converts `LogItem` to CloudWatch `InputLogEvent`. Default format: `[LEVEL] message {metadata}`. Customizable via formatter options.
- **Queue\<T\>** (`src/queue.ts`) — Simple FIFO queue (array-backed) with `push`, `head(n)`, `remove(n)`, `size`.
- **LogItem** (`src/log-item.ts`) — Immutable value object holding `date`, `level`, `message`, `meta`, `callback`.

## Code Conventions

- **TypeScript strict mode** with `@typescript-eslint/no-explicit-any` as error
- No semicolons, single quotes, 100-char line width, ES5 trailing commas (Prettier)
- Unused parameters prefixed with `_`
- Consistent inline type imports (`import { type Foo } from ...`)
- Generics for flexibility (`Relay<T>`, `RelayClient<T>`, `Queue<T>`)

## Testing

- Jest with ts-jest preset, tests in `tests/unit/`
- AWS SDK calls stubbed with Sinon
- `tests/helpers/client-mock.ts` provides `MockClient` implementing `RelayClient` for Relay tests
- Coverage excludes `src/index.ts` and `*.d.ts`

## Build Output

- CJS output → `dist/cjs/` (tsconfig.cjs.json)
- Type declarations → `dist/types/` (tsconfig.types.json)
- tsconfig.json is IDE-only (noEmit)
