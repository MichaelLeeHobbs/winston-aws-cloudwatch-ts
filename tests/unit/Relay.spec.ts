import { describe, it, expect, jest, afterEach } from '@jest/globals'
import MockClient from '../helpers/MockClient'
import Relay, { type RelayItem } from '../../src/Relay'
import { setTimeout } from 'timers/promises'

interface TestItem extends RelayItem {
  callback: jest.Mock
}

const createItem = (): TestItem => ({ callback: jest.fn() })

/** Polls `predicate` on real timers; resolves when true or after `timeoutMs`. */
const waitUntil = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return
    await setTimeout(10)
  }
}

describe('Relay', () => {
  const relays: Relay<TestItem>[] = []

  const createRelay = (
    client: MockClient<TestItem>,
    options?: Partial<{
      submissionInterval: number
      batchSize: number
      maxQueueSize: number
      maxRetries: number
      retryBackoffCap: number
    }>
  ): Relay<TestItem> => {
    const relay = new Relay(client, options)
    relays.push(relay)
    return relay
  }

  afterEach(() => {
    for (const relay of relays) {
      relay.stop()
    }
    relays.length = 0
  })

  describe('start()', () => {
    it('is a no-op if already started', () => {
      const relay = createRelay(new MockClient())
      relay.start()
      // Second call should not throw
      expect(() => {
        relay.start()
      }).not.toThrow()
    })

    it('submits queue items to the client', async () => {
      const submissionInterval = 50
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval })
      relay.start()
      const items = [createItem(), createItem(), createItem()]
      for (const item of items) {
        relay.submit(item)
      }
      await setTimeout(submissionInterval * 1.1)
      expect(client.submitted).toEqual(items)
    })

    it('calls the callback function for every item', async () => {
      const submissionInterval = 50
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval })
      relay.start()
      const items = [createItem(), createItem(), createItem()]
      for (const item of items) {
        relay.submit(item)
      }
      await setTimeout(submissionInterval * 1.1)
      expect(items.map(item => item.callback.mock.calls.length)).toEqual(
        new Array(items.length).fill(1)
      )
      expect(items.map(item => item.callback.mock.calls[0])).toEqual(
        new Array(items.length).fill([null, true])
      )
    })

    it('throttles submissions', async () => {
      const submissionInterval = 100
      const batchSize = 10
      const totalItems = 30
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval, batchSize })
      relay.start()

      for (let i = 0; i < totalItems; ++i) {
        relay.submit(createItem())
      }

      // First batch runs immediately; not everything should be done yet
      await setTimeout(10)
      expect(client.submitted.length).toBeLessThanOrEqual(batchSize)

      // After enough intervals, all items should be submitted
      await setTimeout(submissionInterval * 3)
      expect(client.submitted.length).toBe(totalItems)
    })

    it('emits an error event', async () => {
      const submissionInterval = 50
      const failures = ['FAIL', 'FAIL', 'FAIL']
      const errorSpy = jest.fn()
      const client = new MockClient<TestItem>(failures)
      // retryBackoffCap:0 keeps retries spaced by submissionInterval only
      // (no exponential backoff); maxRetries defaults to 10 > 3 so the batch
      // is retried (not dropped) and succeeds on the 4th attempt.
      const relay = createRelay(client, { submissionInterval, retryBackoffCap: 0 })
      relay.on('error', errorSpy)
      relay.start()
      relay.submit(createItem())
      await setTimeout(submissionInterval * (failures.length + 1) * 1.1)
      expect(errorSpy).toHaveBeenCalledTimes(failures.length)
    })

    it('silently handles a DataAlreadyAcceptedException error', async () => {
      const submissionInterval = 50
      const failures = ['DataAlreadyAcceptedException']
      const errorSpy = jest.fn()
      const client = new MockClient<TestItem>(failures)
      const relay = createRelay(client, { submissionInterval })
      relay.on('error', errorSpy)
      relay.start()
      relay.submit(createItem())
      await setTimeout(submissionInterval * failures.length * 1.1)
      expect(errorSpy).toHaveBeenCalledTimes(0)
    })

    it('silently handles an InvalidSequenceTokenException error', async () => {
      const submissionInterval = 50
      const failures = ['InvalidSequenceTokenException']
      const errorSpy = jest.fn()
      const client = new MockClient<TestItem>(failures)
      const relay = createRelay(client, { submissionInterval })
      relay.on('error', errorSpy)
      relay.start()
      relay.submit(createItem())
      await setTimeout(submissionInterval * (failures.length + 1) * 1.1)
      expect(errorSpy).toHaveBeenCalledTimes(0)
      // Item should be retried and succeed on second attempt
      expect(client.submitted.length).toBe(1)
    })
  })

  describe('retry policy (bounded retry + backoff)', () => {
    it('drops the head batch after maxRetries (not-delivered, no Error)', async () => {
      const submissionInterval = 20
      const maxRetries = 3
      // More failures than maxRetries so every attempt fails.
      const client = new MockClient<TestItem>(Array.from({ length: 10 }, () => 'FAIL'))
      const errorSpy = jest.fn()
      const relay = createRelay(client, {
        submissionInterval,
        maxRetries,
        retryBackoffCap: 0,
      })
      relay.on('error', errorSpy)
      relay.start()
      const item = createItem()
      relay.submit(item)
      // Allow more than maxRetries intervals to elapse.
      await setTimeout(submissionInterval * (maxRetries + 3) * 1.1)
      // Dropped after exactly maxRetries failed attempts.
      expect(errorSpy).toHaveBeenCalledTimes(maxRetries)
      // Callback resolved once, WITHOUT an Error (ok=false) — never delivered.
      expect(item.callback).toHaveBeenCalledTimes(1)
      expect(item.callback).toHaveBeenCalledWith(null, false)
      expect(client.submitted).toEqual([])
    })

    it('does not drop while failures stay below maxRetries (resets on success)', async () => {
      const submissionInterval = 20
      // Fails the first 2 calls of each "round", succeeds on the 3rd. With
      // maxRetries=3 a counter that did NOT reset on success would reach 3 on
      // the 4th call (2nd failure of round 2) and wrongly drop item2.
      let call = 0
      const submitted: TestItem[] = []
      const client = {
        submit: (batch: readonly TestItem[]): Promise<void> => {
          call += 1
          const failThisCall = call === 1 || call === 2 || call === 4 || call === 5
          if (failThisCall) {
            const err = new Error('FAIL')
            err.name = 'FAIL'
            return Promise.reject(err)
          }
          submitted.push(...batch)
          return Promise.resolve()
        },
      }
      const relay = new Relay<TestItem>(client, {
        submissionInterval,
        maxRetries: 3,
        retryBackoffCap: 0,
      })
      relays.push(relay)
      relay.on('error', () => {}) // generic errors throw on an EventEmitter with no listener
      relay.start()
      const item1 = createItem()
      relay.submit(item1)
      await waitUntil(() => item1.callback.mock.calls.length > 0)
      expect(item1.callback).toHaveBeenCalledWith(null, true)
      const item2 = createItem()
      relay.submit(item2)
      await waitUntil(() => item2.callback.mock.calls.length > 0)
      // Counter reset after item1 delivered, so item2 is also delivered
      // (round 2 only saw 2 consecutive failures, not 4).
      expect(item2.callback).toHaveBeenCalledWith(null, true)
      expect(submitted).toEqual([item1, item2])
    })

    it('does not count InvalidSequenceTokenException toward maxRetries', async () => {
      const submissionInterval = 20
      // 5 sequence-token failures (> maxRetries) then success.
      const client = new MockClient<TestItem>(
        Array.from({ length: 5 }, () => 'InvalidSequenceTokenException')
      )
      const errorSpy = jest.fn()
      const relay = createRelay(client, {
        submissionInterval,
        maxRetries: 3,
        retryBackoffCap: 0,
      })
      relay.on('error', errorSpy)
      relay.start()
      const item = createItem()
      relay.submit(item)
      await waitUntil(() => client.submitted.length > 0)
      // Never dropped, never surfaced as an error — retried until delivered.
      expect(errorSpy).not.toHaveBeenCalled()
      expect(item.callback).toHaveBeenCalledWith(null, true)
      expect(client.submitted).toEqual([item])
    })

    it('applies exponentially growing backoff between failed attempts', async () => {
      const submissionInterval = 20
      const timestamps: number[] = []
      const client = {
        submit: (): Promise<void> => {
          timestamps.push(Date.now())
          const err = new Error('FAIL')
          err.name = 'FAIL'
          return Promise.reject(err)
        },
      }
      const relay = new Relay<TestItem>(client, {
        submissionInterval,
        maxRetries: 100,
        retryBackoffCap: 10_000,
      })
      relays.push(relay)
      relay.on('error', () => {}) // generic errors throw on an EventEmitter with no listener
      relay.start()
      relay.submit(createItem())
      // Wait until enough attempts accumulate to compare three gaps.
      await waitUntil(() => timestamps.length >= 4)
      relay.stop()
      expect(timestamps.length).toBeGreaterThanOrEqual(4)
      const gap1 = timestamps[1]! - timestamps[0]!
      const gap2 = timestamps[2]! - timestamps[1]!
      const gap3 = timestamps[3]! - timestamps[2]!
      // gap1 ≈ minTime (no extra after the 1st failure); gaps then grow as the
      // exponential backoff kicks in.
      expect(gap2).toBeGreaterThan(gap1)
      expect(gap3).toBeGreaterThan(gap2)
    })
  })

  describe('submit()', () => {
    it('auto-starts when called before start()', async () => {
      const submissionInterval = 50
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval })
      // Do NOT call relay.start() -- submit should auto-start
      const item = createItem()
      relay.submit(item)
      await setTimeout(submissionInterval * 1.1)
      expect(client.submitted).toEqual([item])
    })

    it('completes the dropped callback (not-delivered, no Error) when queue is full', () => {
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval: 60_000, maxQueueSize: 2 })
      relay.start()
      const item1 = createItem()
      const item2 = createItem()
      const item3 = createItem()
      relay.submit(item1)
      relay.submit(item2)
      // Queue is full (size=2). Next submit evicts the oldest item.
      relay.submit(item3)
      // Must NOT pass an Error: that would crash a Winston host with no
      // 'error' listener. Report not-delivered instead.
      expect(item1.callback).toHaveBeenCalledWith(null, false)
      expect(item2.callback).not.toHaveBeenCalled()
      expect(item3.callback).not.toHaveBeenCalled()
    })
  })

  describe('stop()', () => {
    it('can auto-restart after being stopped', () => {
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval: 50 })
      relay.start()
      relay.stop()
      // submit() after stop() auto-starts a fresh relay without throwing
      relay.submit(createItem())
      // Item is queued but not yet processed (no time for async submission)
      expect(client.submitted.length).toBe(0)
    })

    it('can be called multiple times without throwing', () => {
      const relay = createRelay(new MockClient())
      relay.start()
      relay.stop()
      expect(() => relay.stop()).not.toThrow()
    })

    it('completes pending item callbacks as not-delivered (no Error) on stop', () => {
      const client = new MockClient<TestItem>()
      // Long interval keeps items queued until stop() drains them
      const relay = createRelay(client, { submissionInterval: 60_000 })
      relay.start()
      const items = [createItem(), createItem(), createItem()]
      for (const item of items) relay.submit(item)
      relay.stop()
      for (const item of items) {
        // Must NOT pass an Error: a Winston host with no 'error' listener
        // would crash on shutdown. Report not-delivered instead.
        expect(item.callback).toHaveBeenCalledWith(null, false)
      }
    })

    it('does not double-call callbacks when submission completes after stop', async () => {
      let resolveSubmit!: () => void
      let signalSubmitCalled!: () => void
      const submitCalled = new Promise<void>(r => {
        signalSubmitCalled = r
      })
      const client = {
        submit: () =>
          new Promise<void>(resolve => {
            resolveSubmit = resolve
            signalSubmitCalled()
          }),
      }
      const relay = new Relay<TestItem>(client, { submissionInterval: 10 })
      relays.push(relay)
      relay.start()
      const item = createItem()
      relay.submit(item)
      // Wait until Bottleneck fires and client.submit() is in-flight
      await submitCalled
      relay.stop()
      expect(item.callback).toHaveBeenCalledTimes(1)
      // Resolve the in-flight submission after stop
      resolveSubmit()
      await setTimeout(10)
      // onSubmitted bails because queue is null — no second callback
      expect(item.callback).toHaveBeenCalledTimes(1)
    })

    it('resolves flush when stop() is called during a pending flush', async () => {
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval: 60_000 })
      relay.start()
      relay.submit(createItem())
      const flushPromise = relay.flush(5000)
      relay.stop()
      await expect(flushPromise).resolves.toBeUndefined()
    })

    it('does not emit error when submission fails after stop', async () => {
      let rejectSubmit!: (err: Error) => void
      let signalSubmitCalled!: () => void
      const submitCalled = new Promise<void>(r => {
        signalSubmitCalled = r
      })
      const client = {
        submit: () =>
          new Promise<void>((_, reject) => {
            rejectSubmit = reject
            signalSubmitCalled()
          }),
      }
      const relay = new Relay<TestItem>(client, { submissionInterval: 10 })
      relays.push(relay)
      const errorSpy = jest.fn()
      relay.on('error', errorSpy)
      relay.start()
      relay.submit(createItem())
      // Wait until Bottleneck fires and client.submit() is in-flight
      await submitCalled
      relay.stop()
      // Reject the in-flight submission after stop
      rejectSubmit(new Error('late failure'))
      await setTimeout(10)
      // onError bails because queue is null — no error emitted
      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  describe('flush()', () => {
    it('resolves immediately when queue is empty', async () => {
      const relay = createRelay(new MockClient())
      relay.start()
      await expect(relay.flush()).resolves.toBeUndefined()
    })

    it('resolves immediately when relay is not started', async () => {
      const relay = createRelay(new MockClient())
      await expect(relay.flush()).resolves.toBeUndefined()
    })

    it('resolves after draining queued items', async () => {
      const submissionInterval = 50
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval })
      relay.start()
      const items = [createItem(), createItem(), createItem()]
      for (const item of items) relay.submit(item)
      await relay.flush()
      expect(client.submitted).toEqual(items)
    })

    it('resolves on timeout when queue cannot drain', async () => {
      // Client never resolves, so the queue can't drain
      let signalSubmitCalled!: () => void
      const submitCalled = new Promise<void>(r => {
        signalSubmitCalled = r
      })
      const client = {
        submit: () =>
          new Promise<void>(() => {
            signalSubmitCalled()
          }),
      }
      const relay = new Relay<TestItem>(client, { submissionInterval: 10 })
      relays.push(relay)
      relay.start()
      relay.submit(createItem())
      await submitCalled
      // Flush with a very short timeout
      await expect(relay.flush(50)).resolves.toBeUndefined()
    })

    it('resolves all concurrent callers', async () => {
      const submissionInterval = 50
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval })
      relay.start()
      relay.submit(createItem())
      relay.submit(createItem())
      const flush1 = relay.flush()
      const flush2 = relay.flush()
      await expect(Promise.all([flush1, flush2])).resolves.toBeDefined()
      expect(client.submitted.length).toBe(2)
    })
  })
})
