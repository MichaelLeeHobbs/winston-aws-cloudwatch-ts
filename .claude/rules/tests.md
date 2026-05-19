---
paths:
  - 'tests/**/*.ts'
---

# Test conventions

## File layout

- `tests/unit/*.spec.ts` — default suite (`pnpm test`).
- `tests/stress/*.stress.ts` — memory soak harness; excluded from the default suite by `testPathIgnorePatterns` and from CI. Run via `pnpm run test:stress` (passes `node --expose-gc`).
- `tests/helpers/MockClient.ts` — `RelayClient` stub for `Relay` tests (sequenced failures via `new MockClient(['FAIL','FAIL', ...])`; codes become `err.name`).
- `tests/helpers/setupAwsSdkMock.ts` — registers `aws-sdk-client-mock-jest` matchers via Jest `setupFilesAfterEnv`.

## Real timers — never fake

There is **no `jest.useFakeTimers()` anywhere**, by design. Bottleneck's `minTime` rate-limiting is wall-clock; fake timers don't drive it. Always use real timers + polling helpers:

- `waitUntil(predicate, timeoutMs)` defined locally in `Relay.spec.ts` and `CloudWatchTransport.leak.spec.ts`.
- Prefer formula-based assertions over fixed `setTimeout` budgets. Windows `setTimeout` granularity is ~15.6 ms — keep intervals well above that (≥ ~100 ms when comparing gap deltas).

## AWS SDK mocking

- Use `mockClient(CloudWatchLogsClient)` from `aws-sdk-client-mock`; reset in `beforeEach`.
- Assert via `cwMock.commandCalls(Cmd)` and the custom Jest matchers from `aws-sdk-client-mock-jest`.
- For tests of the **injected** `cloudWatchLogs` option, use a plain object with `jest.fn()` `send`/`destroy` — the assertion is about the instance, not the SDK.

## Relay tests

- **Always attach** `relay.on('error', () => {})` when exercising a generic-error path. Node's `EventEmitter` throws on `emit('error')` with no listener — this is the failure mode that crashed the v1.3.0 build until we added explicit listeners.
- Pass `retryBackoffCap: 0` in timing-sensitive tests so retries are spaced by `submissionInterval` only.
- Pass `maxRetries: <small N>` to test the bounded-drop path; otherwise the default 10 may not drop within a fast test window.

## Lint scope

Test files have **lenient ESLint** (overrides in `eslint.config.mts` disable `explicit-function-return-type`, `prefer-readonly-parameter-types`, `no-unsafe-*`, `no-empty-function`, `max-lines-per-function`). Non-test source is held to the full strict set.
