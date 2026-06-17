# TODOs — shared-backend bugs surfaced by the pino-cloudwatch-ts review

These issues were found during a multi-agent review of the sibling
`@ubercode/pino-cloudwatch` project and **also exist here**, because both
packages were born from the same vendor-copied backend (`Relay`,
`CloudWatchClient`, `CloudWatchEventFormatter`, `Queue`). The two projects now
diverge and are maintained separately; the fixes below were already applied in
pino-cloudwatch-ts and are logged here so they can be reviewed and ported into
winston-aws-cloudwatch-ts on its own schedule (this package is feature-complete;
these qualify as bug fixes).

Use the pino-cloudwatch-ts commit as the reference implementation for each.

## Correctness

- [ ] **Duplicate log delivery on a partially-failed split batch** —
      `src/CloudWatchClient.ts` (`putLogEvents` / `splitByByteLimit`).
      When one relay batch's formatted events exceed 1 MB, it is split into
      multiple `PutLogEvents` calls. If an earlier sub-batch succeeds and a later
      one fails, the relay retries the **whole** batch, re-sending the
      already-accepted events (at-least-once duplication).
      **Fix (pino):** carry each event's source `LogItem` through formatting,
      track accepted items in a `WeakSet<LogItem>`, and skip already-delivered
      items when a retry re-submits the batch. Severity: Med-High (only triggers
      when a single relay batch > 1 MB).

- [ ] **Exponential backoff bypassed during a busy outage** —
      `src/Relay.ts` (`scheduleSubmission` / `scheduleNextSubmission`).
      While a retry-backoff timer is pending, an incoming `submit()` calls
      `scheduleSubmission()` and immediately re-drains the failing head batch,
      defeating the backoff (hammers CloudWatch / floods the `error` event during
      an outage). The `/* istanbul ignore next */` "retryTimer is always null
      here" comment is also wrong without the fix.
      **Fix (pino):** add `this.retryTimer` to the early-return guard in
      `scheduleSubmission()`. Severity: Med.

- [ ] **`CloudWatchClient.destroy()` is not idempotent** — `src/CloudWatchClient.ts`.
      A second `destroy()` calls the underlying SDK client's `destroy()` again.
      **Fix (pino):** a `destroyed` guard flag; return early on re-entry.
      Severity: Low (defensive; pairs with the relay's stop/teardown paths).

## Quality (optional for a feature-complete package)

- [ ] **Default formatter pretty-prints metadata** —
      `src/CloudWatchEventFormatter.ts` (`defaultFormatLog`) uses
      `JSON.stringify(meta, null, 2)`. The 2-space indentation inflates every
      event ~30-60% (counts against the 1 MB limit + ingestion cost) and breaks
      CloudWatch Logs Insights single-line field discovery. `jsonFormatLog`
      already uses compact JSON.
      **Fix (pino):** `JSON.stringify(meta)` (compact). NOTE: this changes the
      emitted log format, so treat as a deliberate (possibly breaking) change for
      winston, not a silent patch.

- [ ] **Uncommented non-null assertion** — `src/Relay.ts` `submit()`
      (`this.queue!.push(item)`). Add a one-line justification comment
      (`start()` unconditionally assigns `this.queue`).

## Test robustness (optional)

- [ ] **Flaky drop-head retry test** — `tests/unit/Relay.spec.ts` "drops the head
      batch after maxRetries" uses a fixed `setTimeout(... * 1.1)` window then an
      exact-count assertion, which flakes under CPU load / Windows timer jitter.
      **Fix (pino):** poll with `waitUntil(() => errorSpy.mock.calls.length >= maxRetries)`,
      then a short settle, then assert the exact count.

## NOT applicable to winston (pino-only)

- `messageKey`/`timestampKey`/`levelKey` support and the worker-thread
  `for await`-vs-`close` resurrection race are specific to the pino transport's
  front-end and do not exist in `CloudWatchTransport.ts`.
