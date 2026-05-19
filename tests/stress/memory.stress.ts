import { describe, it, expect, beforeAll } from '@jest/globals'
import { type CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs'
import CloudWatchTransport from '../../src/CloudWatchTransport'

// Sustained high-volume memory/throughput harness for docs/plans.md Plan 3.
// NOT part of the default suite or CI — run with:
//   pnpm run test:stress      (which passes node --expose-gc)
//
// Goal: prove memory stays bounded under hundreds of thousands of logs, both
// when CloudWatch delivery succeeds and when it permanently fails (issue #9 at
// scale). The deterministic unit-level regression lives in
// tests/unit/CloudWatchTransport.leak.spec.ts; this is the soak test.

const gc = (global as unknown as { gc?: () => void }).gc

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const settle = async (turns = 30): Promise<void> => {
  for (let i = 0; i < turns; i++) await new Promise(resolve => setImmediate(resolve))
}

const waitUntil = async (predicate: () => boolean, timeoutMs = 30_000): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return
    await sleep(20)
  }
}

const heapUsedMB = (): number => {
  if (gc) gc()
  return process.memoryUsage().heapUsed / 1024 / 1024
}

/** RSS catches leaks invisible to heapUsed (V8 arenas, off-heap buffers). */
const rssMB = (): number => process.memoryUsage().rss / 1024 / 1024

function bufferedWrites(transport: CloudWatchTransport): number {
  const state = (transport as unknown as { _writableState: { bufferedRequestCount?: number } })
    ._writableState
  return state.bufferedRequestCount ?? 0
}

function relayQueueSize(transport: CloudWatchTransport): number {
  const relay = (transport as unknown as { relay: { queue: { size: number } | null } }).relay
  return relay.queue ? relay.queue.size : 0
}

function stop(transport: CloudWatchTransport): void {
  ;(transport as unknown as { relay: { stop: () => void } }).relay.stop()
}

// Heap may grow modestly (V8 arenas, JIT) but must NOT scale with the number
// of logs. The real leak signal was hundreds of MB → OOM.
const MAX_HEAP_GROWTH_MB = 60
// RSS is allowed more slack (V8 working set, JIT code, libuv buffers).
const MAX_RSS_GROWTH_MB = 300

describe('CloudWatchTransport — sustained memory soak (Plan 3)', () => {
  beforeAll(() => {
    if (!gc) {
      console.warn(
        '[stress] global.gc unavailable — heap assertions are skipped. Run via `pnpm run test:stress` (node --expose-gc).'
      )
    }
  })

  it('steady delivery: 100k logs stay memory-bounded and the queue respects maxQueueSize', async () => {
    const fastClient = {
      send: () => Promise.resolve({}),
      destroy() {},
    } as unknown as CloudWatchLogsClient

    const maxQueueSize = 10_000
    const transport = new CloudWatchTransport({
      logGroupName: 'g',
      logStreamName: 's',
      cloudWatchLogs: fastClient,
      submissionInterval: 1,
      batchSize: 500,
      maxQueueSize,
      retryBackoffCap: 0,
    })
    transport.on('error', () => {})

    try {
      const N = 100_000
      const chunk = 1000
      // Warm up, then take a GC'd baseline.
      for (let i = 0; i < chunk; i++) {
        transport.write({ level: 'info', message: `warmup ${i}`, i, ctx: { a: 1, b: 'x' } })
      }
      await settle()
      await waitUntil(() => relayQueueSize(transport) === 0)
      const baselineMB = heapUsedMB()
      const baselineRss = rssMB()

      let maxQueueObserved = 0
      for (let written = 0; written < N; written += chunk) {
        for (let i = 0; i < chunk; i++) {
          transport.write({
            level: 'info',
            message: `event ${written + i}`,
            i: written + i,
            ctx: { requestId: `req-${written + i}`, nested: { x: 1, y: 2 } },
          })
        }
        maxQueueObserved = Math.max(maxQueueObserved, relayQueueSize(transport))
        await settle(5)
      }
      await waitUntil(() => relayQueueSize(transport) === 0)
      const endMB = heapUsedMB()
      const endRss = rssMB()

      // The bounded queue is the memory backstop and must never be exceeded.
      expect(maxQueueObserved).toBeLessThanOrEqual(maxQueueSize)
      // Stream never stalls.
      expect(bufferedWrites(transport)).toBe(0)
      if (gc) {
        expect(endMB - baselineMB).toBeLessThan(MAX_HEAP_GROWTH_MB)
      }
      // RSS growth is the coarse leak detector that catches V8-arena / off-heap
      // regressions that heapUsed misses.
      expect(endRss - baselineRss).toBeLessThan(MAX_RSS_GROWTH_MB)
    } finally {
      stop(transport)
    }
  })

  it('permanent failure: 100k logs stay memory-bounded (issue #9 at scale)', async () => {
    let sends = 0
    const failingClient = {
      send: () => {
        sends += 1
        return Promise.reject(
          Object.assign(new Error('throttled'), { name: 'ThrottlingException' })
        )
      },
      destroy() {},
    } as unknown as CloudWatchLogsClient

    const maxQueueSize = 5000
    const transport = new CloudWatchTransport({
      logGroupName: 'g',
      logStreamName: 's',
      cloudWatchLogs: failingClient,
      submissionInterval: 1,
      batchSize: 500,
      maxQueueSize,
      maxRetries: 3,
      retryBackoffCap: 0,
    })
    transport.on('error', () => {})

    try {
      const N = 100_000
      const chunk = 1000
      for (let i = 0; i < chunk; i++) {
        transport.write({ level: 'info', message: `warmup ${i}`, i })
      }
      await settle()
      const baselineMB = heapUsedMB()
      const baselineRss = rssMB()

      let maxQueueObserved = 0
      let maxBufferedObserved = 0
      for (let written = 0; written < N; written += chunk) {
        for (let i = 0; i < chunk; i++) {
          transport.write({
            level: 'info',
            message: `event ${written + i}`,
            i: written + i,
            ctx: { requestId: `req-${written + i}` },
          })
        }
        maxQueueObserved = Math.max(maxQueueObserved, relayQueueSize(transport))
        maxBufferedObserved = Math.max(maxBufferedObserved, bufferedWrites(transport))
        await settle(5)
      }

      // Prove the bounded-retry drop path actually fires, not just buffering.
      // Stop writing and let real time elapse so retries can run; each head
      // batch fails maxRetries times then is dropped, shrinking the queue.
      // Pure infinite-retry (no drop) would leave queue.size pinned forever.
      const queueBeforeDrain = relayQueueSize(transport)
      await sleep(500)
      const queueAfterDrain = relayQueueSize(transport)
      expect(queueAfterDrain).toBeLessThan(queueBeforeDrain)

      const endMB = heapUsedMB()
      const endRss = rssMB()

      // Even though delivery NEVER succeeds: the Writable never stalls, the
      // queue stays bounded, retries happen, batches drop, and memory does
      // not scale with N.
      expect(maxBufferedObserved).toBe(0)
      expect(bufferedWrites(transport)).toBe(0)
      expect(maxQueueObserved).toBeLessThanOrEqual(maxQueueSize)
      expect(sends).toBeGreaterThan(0)
      if (gc) {
        expect(endMB - baselineMB).toBeLessThan(MAX_HEAP_GROWTH_MB)
      }
      expect(endRss - baselineRss).toBeLessThan(MAX_RSS_GROWTH_MB)
    } finally {
      stop(transport)
    }
  })
})
