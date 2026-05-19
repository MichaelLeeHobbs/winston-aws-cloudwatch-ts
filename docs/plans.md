# Plans

## 1. Example App — ✅ done

Working example demonstrating real-world usage of `@ubercode/winston-cloudwatch`.

**Delivered:**

- `examples/basic-usage.ts` — Winston + CloudWatch transport: basic logging,
  structured metadata, custom/JSON formatting, transport **and** logger
  `error` handling, graceful shutdown (`flush` + `close`, `SIGINT`/`SIGTERM`)
- `examples/README.md` — setup, env-var config table, AWS credential/IAM notes
- Runnable via `pnpm run example` or `npx ts-node examples/basic-usage.ts`
  (imports from `../src`, no build step); env-configurable
- Not shipped to npm (`files` excludes `examples/`); eslint-ignored as
  illustrative code

---

## 2. Migrate to aws-sdk-client-mock for Unit Tests — ✅ done (v1.3.0)

Replaced the Sinon-based AWS SDK stubs with [`aws-sdk-client-mock`](https://github.com/m-radzikowski/aws-sdk-client-mock) + [`aws-sdk-client-mock-jest`](https://www.npmjs.com/package/aws-sdk-client-mock-jest), the AWS-recommended approach for mocking modular SDK v3.

**Delivered:**

- Added `aws-sdk-client-mock` / `aws-sdk-client-mock-jest` dev deps; removed `sinon` and `@types/sinon`
- `tests/unit/CloudWatchClient.spec.ts` rewritten on `mockClient(CloudWatchLogsClient)` (typed, command-level: `commandCalls(PutLogEventsCommand)`, etc.)
- Matchers wired via `tests/helpers/setupAwsSdkMock.ts` (jest `setupFilesAfterEnv`)
- 100% coverage maintained

**Reference:** [Mocking modular AWS SDK for JavaScript v3 in Unit Tests](https://aws.amazon.com/blogs/developer/mocking-modular-aws-sdk-for-javascript-v3-in-unit-tests/)

---

## 3. Memory Leak / Stress Test — ✅ done (v1.3.0)

Regression + soak coverage for the head-of-line memory leak (issue #9).

**Delivered:**

- Deterministic unit regression: `tests/unit/CloudWatchTransport.leak.spec.ts` (callback always resolves, bounded buffering, recovery, bounded-retry frees the head batch)
- Sustained soak harness: `tests/stress/memory.stress.ts` — 100k logs under both steady delivery and permanent failure; asserts `_writableState.bufferedRequestCount` stays 0, the relay queue respects `maxQueueSize`, and GC'd heap growth is bounded
- Separate `jest.stress.config.ts`; excluded from the default suite (`testPathIgnorePatterns`) and CI

**Run command:** `pnpm run test:stress` (passes `node --expose-gc`)
