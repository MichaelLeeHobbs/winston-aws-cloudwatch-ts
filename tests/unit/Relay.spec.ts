import { describe, it, expect, jest, afterEach } from '@jest/globals'
import MockClient from '../helpers/MockClient'
import Relay, { type RelayItem } from '../../src/Relay'
import { setTimeout } from 'timers/promises'

interface TestItem extends RelayItem {
  callback: jest.Mock
}

const createItem = (): TestItem => ({ callback: jest.fn() })

describe('Relay', () => {
  const relays: Relay<TestItem>[] = []

  const createRelay = (
    client: MockClient<TestItem>,
    options?: Partial<{ submissionInterval: number; batchSize: number; maxQueueSize: number }>
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
      const relay = createRelay(client, { submissionInterval })
      relay.on('error', errorSpy)
      relay.start()
      relay.submit(createItem())
      await setTimeout(submissionInterval * failures.length * 1.1)
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

    it('calls callback with overflow error when queue is full', () => {
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
      expect(item1.callback).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Queue overflow: log item dropped' })
      )
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

    it('notifies pending items with Transport closed error', () => {
      const client = new MockClient<TestItem>()
      // Long interval keeps items queued until stop() drains them
      const relay = createRelay(client, { submissionInterval: 60_000 })
      relay.start()
      const items = [createItem(), createItem(), createItem()]
      for (const item of items) relay.submit(item)
      relay.stop()
      for (const item of items) {
        expect(item.callback).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'Transport closed' })
        )
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
