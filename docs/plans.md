# Plans

## 1. Example App

Create a working example application that demonstrates real-world usage of `@ubercode/winston-cloudwatch`.

**Goals:**

- Minimal Node.js/TypeScript app that sets up Winston with the CloudWatch transport
- Show common patterns: basic logging, structured metadata, custom formatting, error handling, graceful shutdown
- Include a README with setup instructions (AWS credentials, region, log group/stream)
- Runnable with `npx ts-node` or as a compiled script

**Location:** `examples/`

---

## 2. Migrate to aws-sdk-client-mock for Unit Tests

Replace the current Sinon-based AWS SDK stubs with [`aws-sdk-client-mock`](https://github.com/m-radzikowski/aws-sdk-client-mock), the AWS-recommended mocking library for SDK v3.

**Why:**

- Current tests manually stub `CloudWatchLogsClient.prototype.send` with Sinon, which is fragile and doesn't validate command types
- `aws-sdk-client-mock` provides typed, command-level mocking — mock specific commands (`PutLogEventsCommand`, `CreateLogGroupCommand`, etc.) with type-checked responses
- [`aws-sdk-client-mock-jest`](https://www.npmjs.com/package/aws-sdk-client-mock-jest) adds custom Jest matchers (e.g. `expect(mock).toHaveReceivedCommand(PutLogEventsCommand)`)

**Scope:**

- Add `aws-sdk-client-mock` and `aws-sdk-client-mock-jest` as dev dependencies
- Rewrite `CloudWatchClient.spec.ts` to use `mockClient(CloudWatchLogsClient)` instead of Sinon stubs
- Remove Sinon dependency if no longer needed elsewhere
- Maintain 100% coverage

**Reference:** [Mocking modular AWS SDK for JavaScript v3 in Unit Tests](https://aws.amazon.com/blogs/developer/mocking-modular-aws-sdk-for-javascript-v3-in-unit-tests/)

---

## 3. Memory Leak / Stress Test

Create a standalone stress test that hammers the transport with sustained high-volume logging to verify there are no memory leaks.

**Approach:**

- Use `aws-sdk-client-mock` as the backend (from Plan 2) so we can run at full speed without AWS costs
- Inject the mocked `CloudWatchLogsClient` via the `cloudWatchLogs` option
- Log tens of thousands of messages over an extended period (e.g. 100k+ messages over several minutes)
- Monitor `process.memoryUsage()` at intervals and assert that heap growth stays within acceptable bounds
- Test with various configurations: small batch size, large batch size, fast submission interval, metadata-heavy logs
- Verify queue backpressure works correctly under sustained load (maxQueueSize)

**Location:** `tests/stress/` (separate from unit tests, not part of the default `pnpm test` run)

**Run command:** A dedicated script, e.g. `pnpm run test:stress`
