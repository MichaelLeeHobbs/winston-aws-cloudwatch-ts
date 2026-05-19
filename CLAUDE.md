# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Winston transport for AWS CloudWatch Logs (TypeScript, AWS SDK v3, Bottleneck rate limiting). Publishes as dual ESM/CJS with type declarations via tsup. Package: `@ubercode/winston-cloudwatch`. Requires Node.js >= 20.9.0.

## Commands

```bash
pnpm install
pnpm run build         # ESM + CJS + d.ts to dist/
pnpm run test          # format + lint + unit
pnpm run test:cover    # unit + coverage (must stay 100%)
pnpm run test:ci       # what CI runs
pnpm run test:stress   # sustained memory soak (--expose-gc; NOT in default test/CI)
pnpm run lint          # eslint --fix
pnpm run format        # prettier --write
pnpm run example       # run examples/basic-usage.ts via ts-node
```

## Architecture

Pipeline: **Winston Logger → CloudWatchTransport → Relay → CloudWatchClient → AWS CloudWatch Logs API**.

- **CloudWatchTransport** (`src/CloudWatchTransport.ts`) — `winston-transport` subclass; entry point.
- **Relay\<T\>** (`src/Relay.ts`) — Generic batching/throttling. Bottleneck-rate-limited; bounded queue (oldest-dropped); bounded retry with exponential backoff (`maxRetries`/`retryBackoffCap`) — the head batch is dropped after the cap to prevent head-of-line blocking during a sustained outage (issue #9).
- **CloudWatchClient** (`src/CloudWatchClient.ts`) — implements `RelayClient<LogItem>`. Wraps the AWS SDK v3 client; optional auto-create of log groups/streams; lazy-initialized with idempotent `??=` memoization (reset on failure).
- **CloudWatchEventFormatter** (`src/CloudWatchEventFormatter.ts`) — default format `[LEVEL] message {metadata}`; UTF-8-safe truncation; optional `jsonMessage` and user-supplied `formatLog`/`formatLogItem`.

Broader rationale and the mission-critical TypeScript standard this project follows: [`docs/CodingStandards.md`](docs/CodingStandards.md).

## Non-obvious behaviors

- **Delivery is decoupled from the Winston write callback** (issue #9, v1.2.0 contract). `CloudWatchTransport.log()` resolves the stream callback **immediately** and passes a `noop` into the relay. Re-coupling reintroduces the head-of-line OOM leak — preserve this whenever modifying `log()` or `Relay`.
- **No `jest.useFakeTimers()` anywhere**, by design. Bottleneck's `minTime` is wall-clock; tests use real timers + `waitUntil(predicate, timeoutMs)` polling helpers. See `.claude/rules/tests.md`.
- **Adding a public option** means three places: `CloudWatchTransportOptions` (`src/CloudWatchTransport.ts`), `RelayOptions` + `DEFAULT_OPTIONS` (`src/Relay.ts`) if it flows through the relay, and the config table in `README.md`. The DTS build catches type breakage; `test:cover` must stay at 100%.
- **Releases are automated.** `.github/workflows/publish.yml` triggers on `v*` tag push and runs `npm publish --provenance` + auto-creates the GitHub Release. Never run `npm publish` manually.
- `tsconfig.json` is IDE-only (`noEmit`); production output is built by `tsup.config.ts`.

## Code conventions

- PascalCase filenames matching the class/type they export.
- No semicolons, single quotes, 100-char line width, ES5 trailing commas (Prettier).
- Unused parameters prefixed with `_`.
- Private fields/methods use `_` prefix **only** when a public getter shares the same name (e.g. `_date` + `get date()`); otherwise no prefix.
- Inline type imports: `import { type Foo } from ...`.

## Testing

- Jest with ts-jest; unit tests in `tests/unit/`.
- AWS SDK calls mocked with [`aws-sdk-client-mock`](https://github.com/m-radzikowski/aws-sdk-client-mock); matchers wired via `tests/helpers/setupAwsSdkMock.ts` (`setupFilesAfterEnv`).
- `tests/helpers/MockClient.ts` is a `RelayClient` stub for `Relay` tests.
- `tests/stress/*.stress.ts` — memory soak via `jest.stress.config.ts` / `pnpm run test:stress`; excluded from the default suite and CI by `testPathIgnorePatterns`.
- Coverage excludes `src/index.ts` (barrel) and `*.d.ts`; everything else stays at 100%.
- **See `.claude/rules/tests.md` for test-file conventions** (real timers, mocking, error-listener gotcha, lint overrides).
