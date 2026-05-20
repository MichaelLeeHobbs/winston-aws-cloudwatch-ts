# Changelog

All notable changes to `@ubercode/winston-cloudwatch` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Dependabot config (`.github/dependabot.yml`) — weekly npm + `github-actions` updates, minor/patch grouped into a single PR per ecosystem so the project stays current with minimal review overhead.
- End-to-end tests through a real `winston.Logger` (`tests/unit/winston-integration.spec.ts`): asserts message/metadata round-trip, decoupled-delivery contract, and `logger.on('error')` propagation.
- `AbortSignal.timeout` behavior is now exercised end-to-end in `CloudWatchClient.spec.ts`.
- Concurrent `CloudWatchClient.initialize()` (`??=` memoization) is tested under both shared-success and failure-then-shared-retry.
- Stress harness now samples RSS alongside `heapUsed` (catches V8-arena/off-heap leaks) and verifies the bounded-retry drop path actually fires during a permanent outage (queue shrinks after writes stop).

### Fixed

- Backoff timing assertion in `Relay.spec.ts` no longer flakes on slow/Windows CI: asserts against the explicit formula with tolerance instead of `gap_{n+1} > gap_n` on near-equal first gaps.
- `CLAUDE.md` no longer claims `CloudWatchClient` performs "sequence token tracking" — AWS SDK v3 manages tokens internally; the code does not.

### Changed

- `CLAUDE.md` trimmed to current Anthropic best practices (under 200 lines, non-obvious behaviors highlighted); test conventions moved into a path-scoped `.claude/rules/tests.md` so they only load when working in `tests/`.

### Removed

- `docs/plans.md` — all three plans (example app, `aws-sdk-client-mock` migration, stress harness) shipped in v1.3.0; the document had outlived its purpose.

### Changed (CI)

- CI matrix anchors the declared Node floor explicitly: `node-version: [20.9.0, 22, 24]`.

## [1.3.0] — 2026-05-19

[GitHub Release](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.3.0)

### Added

- **Bounded retry + exponential backoff** in `Relay.onError` ([issue #9 Option 1](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/issues/9)). New options on `CloudWatchTransport`/`Relay`:
  - `maxRetries` (default `10`) — consecutive failed delivery attempts of the head batch before it is dropped (callbacks resolved as not-delivered, never as an `Error`).
  - `retryBackoffCap` (default `30_000` ms) — exponential-backoff cap between failed retries; `0` disables backoff.
- `tests/stress/memory.stress.ts` + `jest.stress.config.ts` + `pnpm run test:stress` — sustained 100k-log soak (steady delivery + permanent failure). Excluded from the default suite and CI.
- `examples/basic-usage.ts` + `examples/README.md` — runnable Winston-CloudWatch sample app (`pnpm run example`).
- `.github/workflows/publish.yml` now auto-creates a GitHub Release for every `v*` tag (`contents: write` + `gh release create … --verify-tag --generate-notes`).

### Changed

- AWS SDK unit tests migrated from Sinon to [`aws-sdk-client-mock`](https://github.com/m-radzikowski/aws-sdk-client-mock) + `aws-sdk-client-mock-jest`; `sinon`/`@types/sinon` removed from `devDependencies`.
- Behaviour change for a permanently-undeliverable batch: dropped after `maxRetries` instead of retried forever (memory was already bounded by `maxQueueSize`; this frees the head-of-line so newer logs flow during a long outage).

### Fixed

- Migration guides updated to document the v1.2.0+ decoupled-delivery / backpressure semantics.

### Removed

- Stale `docs/reviews/review-2026-02-13*.md` and the two never-posted outreach issue drafts.

## [1.2.0] — 2026-05-19

[GitHub Release](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.2.0)

### Fixed

- **Unbounded memory leak** — head-of-line stall when CloudWatch delivery persistently fails ([issue #9](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/issues/9)). `CloudWatchTransport.log()` had handed Winston's `objectMode` Writable write callback to the relay, which only resolved it on a successful submit; a stuck head batch blocked every subsequent log into the stream's internal buffer until OOM. This was the long-standing leak inherited from the original `winston-cloudwatch` / `winston-aws-cloudwatch` lineage.

### Changed

- **Delivery is now decoupled from the Winston write callback.** Entries are accepted into the relay's bounded queue and the stream callback is resolved immediately; delivery is asynchronous and failures surface via the `'error'` event. `maxQueueSize` is now the effective, strictly-enforced memory bound regardless of CloudWatch availability. Note: a logging call returning now means the entry was accepted into the queue, not that it reached CloudWatch.
- README gained a "Backpressure & Delivery Semantics" section documenting the contract.

## [1.1.0] — 2026-05-18

[GitHub Release](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.1.0)

### Fixed

- Process crash on transport close / queue overflow: passing an `Error` to a Winston write callback could crash a host with no `'error'` listener. Dropped or closed logs are now reported as not-delivered (`ok=false`) instead.

### Added

- Claude Code agents and skills scaffolding under `.claude/`.

## [1.0.1] — 2026-02-15

[GitHub Release](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.0.1)

### Fixed

- Publish workflow tuned for npm trusted publishers (provenance + OIDC).

## [1.0.0] — 2026-02-15

[GitHub Release](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.0.0)

### Added

- Initial release of `@ubercode/winston-cloudwatch` — a modern TypeScript / AWS SDK v3 fork of `winston-aws-cloudwatch`.
- Feature parity with the upstream: `name`, `jsonMessage`, chronological sorting, retention policy, client injection, byte-aware batch splitting, `flush()`.
- Dual ESM/CJS output via tsup, full TypeScript types.

[Unreleased]: https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.3.0
[1.2.0]: https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.2.0
[1.1.0]: https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.1.0
[1.0.1]: https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.0.1
[1.0.0]: https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/releases/tag/v1.0.0
