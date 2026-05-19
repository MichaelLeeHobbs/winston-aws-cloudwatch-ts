import { describe, it, expect, jest, afterEach } from '@jest/globals'
import { type CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs'
import CloudWatchTransport from '../../src/CloudWatchTransport'

// Regression tests for issue #9:
// "Unbounded memory leak: a persistently-failing PutLogEvents permanently
//  stalls the Winston transport stream (callback never resolved), buffering
//  every subsequent log to OOM."
//
// Root cause: CloudWatchTransport.log() handed the Winston Writable stream's
// own write callback to the relay, which only resolved it on a *successful*
// submit (or overflow/stop). A persistent submit() failure retried the same
// head batch forever and never resolved the callback. Because the upstream
// objectMode Writable serializes writes, the first stuck item blocked every
// subsequent log into _writableState's buffered linked list — unbounded — so
// the relay's maxQueueSize backpressure was never even exercised.

/** A CloudWatch client whose every send() rejects with a generic, non-special-cased error. */
function alwaysThrottled(): CloudWatchLogsClient {
  return {
    send: () =>
      Promise.reject(Object.assign(new Error('throttled'), { name: 'ThrottlingException' })),
    destroy() {},
  } as unknown as CloudWatchLogsClient
}

/** A client that rejects the first `failures` sends, then resolves forever. Records send count. */
function failsThenRecovers(failures: number): {
  client: CloudWatchLogsClient
  sends: () => number
} {
  let count = 0
  const client = {
    send: () => {
      count += 1
      if (count <= failures) {
        return Promise.reject(
          Object.assign(new Error('throttled'), { name: 'ThrottlingException' })
        )
      }
      return Promise.resolve({})
    },
    destroy() {},
  } as unknown as CloudWatchLogsClient
  return { client, sends: () => count }
}

/** Drains pending micro/macro tasks so the Writable stream can process its buffer. */
async function settle(turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

/** Polls `predicate` on real timers (Bottleneck's minTime gating is real-time). */
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function bufferedWrites(transport: CloudWatchTransport): number {
  // readable-stream@3 keeps un-processed writes in a { chunk, callback, next }
  // linked list counted by bufferedRequestCount. This is exactly the structure
  // that grew unbounded in the production heap snapshots.
  const state = (transport as unknown as { _writableState: { bufferedRequestCount?: number } })
    ._writableState
  return state.bufferedRequestCount ?? 0
}

function relayQueueSize(transport: CloudWatchTransport): number {
  const relay = (transport as unknown as { relay: { queue: { size: number } | null } }).relay
  return relay.queue ? relay.queue.size : 0
}

describe('CloudWatchTransport — issue #9 head-of-line memory leak', () => {
  const transports: CloudWatchTransport[] = []

  function makeTransport(
    client: CloudWatchLogsClient,
    overrides: Partial<{
      submissionInterval: number
      maxQueueSize: number
      maxRetries: number
      retryBackoffCap: number
      batchSize: number
    }> = {}
  ): CloudWatchTransport {
    const transport = new CloudWatchTransport({
      logGroupName: 'g',
      logStreamName: 's',
      cloudWatchLogs: client,
      submissionInterval: 5,
      maxQueueSize: 1000,
      // High retry budget + no backoff keeps these tests fast and isolates
      // them from the bounded-retry policy (covered by its own test below).
      maxRetries: 50,
      retryBackoffCap: 0,
      ...overrides,
    })
    // Real apps attach an 'error' handler (or Winston re-emits and crashes).
    transport.on('error', () => {})
    transports.push(transport)
    return transport
  }

  afterEach(() => {
    // Stop each relay so Bottleneck's timer does not leak across tests.
    for (const transport of transports.splice(0)) {
      ;(transport as unknown as { relay: { stop: () => void } }).relay.stop()
    }
  })

  it('resolves the Winston write callback even when delivery never succeeds', () => {
    const transport = makeTransport(alwaysThrottled())

    const callbacks = Array.from({ length: 50 }, () => jest.fn())
    for (const cb of callbacks) {
      transport.log({ level: 'info', message: 'leak' }, cb)
    }

    // The callback must be resolved synchronously on enqueue. If it is only
    // resolved on a *successful* submit, none of these ever fire (the client
    // always rejects) and the stream stalls forever.
    for (const cb of callbacks) {
      expect(cb).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps the Writable stream draining (buffered writes bounded) under a persistent failure', async () => {
    const transport = makeTransport(alwaysThrottled(), { maxQueueSize: 1000 })

    const N = 10_000
    for (let i = 0; i < N; i++) {
      transport.write({ level: 'info', message: 'leak', i })
    }
    await settle()

    // Pre-fix: the first write's callback never resolves, so the stream never
    // drains and bufferedRequestCount climbs to ~N. Post-fix: it stays at 0.
    expect(bufferedWrites(transport)).toBe(0)

    // The relay queue is the *intended* bounded buffer and must respect
    // maxQueueSize even though CloudWatch delivery never succeeds.
    expect(relayQueueSize(transport)).toBeLessThanOrEqual(1000)
  })

  it('recovers and drains once delivery succeeds again (no permanent stall)', async () => {
    // Fail the first few batches, then start succeeding.
    const { client, sends } = failsThenRecovers(3)
    const transport = makeTransport(client, { maxQueueSize: 1000 })

    for (let i = 0; i < 200; i++) {
      transport.write({ level: 'info', message: 'recover', i })
    }
    await settle()
    await waitUntil(() => relayQueueSize(transport) === 0)

    expect(sends()).toBeGreaterThan(3) // it kept trying past the failures
    expect(bufferedWrites(transport)).toBe(0) // stream never stalled
    expect(relayQueueSize(transport)).toBe(0) // queue fully drained after recovery
  })

  it('drops the stuck head batch after maxRetries so newer logs keep flowing', async () => {
    // Capture which log messages each PutLogEvents attempt carried, and always
    // fail. Pre-Option-1 the relay retried batch #1 forever, so only the first
    // batch's messages would ever be attempted. With bounded retries the stuck
    // head batch is dropped and later logs get their turn.
    const attemptedMessages = new Set<string>()
    const recordingClient = {
      send: (command: { input?: { logEvents?: { message?: string }[] } }): Promise<never> => {
        for (const e of command.input?.logEvents ?? []) {
          if (typeof e.message === 'string') attemptedMessages.add(e.message)
        }
        return Promise.reject(
          Object.assign(new Error('throttled'), { name: 'ThrottlingException' })
        )
      },
      destroy() {},
    } as unknown as CloudWatchLogsClient

    const batchSize = 2
    const transport = makeTransport(recordingClient, {
      maxRetries: 2,
      retryBackoffCap: 0,
      submissionInterval: 2,
      batchSize,
    })
    const N = 20
    for (let i = 0; i < N; i++) {
      transport.write({ level: 'info', message: `m${i}` })
    }

    // If the head batch were retried forever, only ~batchSize distinct
    // messages would ever be attempted. Bounded retry frees the head so many
    // more get attempted.
    await waitUntil(() => attemptedMessages.size > batchSize, 3000)
    expect(attemptedMessages.size).toBeGreaterThan(batchSize)
    expect(bufferedWrites(transport)).toBe(0)
  })
})
