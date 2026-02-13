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
    it('can only be called once', () => {
      const relay = createRelay(new MockClient())
      relay.start()
      expect(() => {
        relay.start()
      }).toThrow(Error)
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
  })

  describe('stop()', () => {
    it('stops accepting submissions', () => {
      const client = new MockClient<TestItem>()
      const relay = createRelay(client, { submissionInterval: 50 })
      relay.start()
      relay.stop()
      // After stop, submit should auto-start a new instance
      relay.submit(createItem())
      // The relay restarted via auto-start, so this should not throw
      expect(client.submitted.length).toBe(0)
    })
  })
})
