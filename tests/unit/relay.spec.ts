import { describe, it, expect, jest } from '@jest/globals'
import MockClient from '../helpers/client-mock'
import Relay, { type RelayItem } from '../../src/relay'
import { setTimeout } from 'timers/promises'

interface TestItem extends RelayItem {
  callback: jest.Mock
}

const createItem = (): TestItem => ({ callback: jest.fn() })

describe('Relay', () => {
  describe('start()', () => {
    it('can only be called once', () => {
      const relay = new Relay(new MockClient())
      relay.start()
      expect(() => {
        relay.start()
      }).toThrow(Error)
    })

    it('submits queue items to the client', async () => {
      const submissionInterval = 50
      const client = new MockClient<TestItem>()
      const relay = new Relay(client, { submissionInterval })
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
      const relay = new Relay(client, { submissionInterval })
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
      const submissionInterval = 50
      const batchSize = 10
      const batches = 3
      const client = new MockClient<TestItem>()
      const relay = new Relay(client, { submissionInterval, batchSize })
      relay.start()

      for (let i = 0; i < batchSize * batches; ++i) {
        relay.submit(createItem())
      }

      const counts: number[] = []
      for (let i = 0; i < batches; ++i) {
        await setTimeout(submissionInterval * 1.1)
        counts.push(client.submitted.length)
      }

      const expected: number[] = []
      for (let i = 1; i <= batches; ++i) {
        expected.push(batchSize * i)
      }

      expect(counts).toEqual(expected)
    })

    it('emits an error event', async () => {
      const submissionInterval = 50
      const failures = ['FAIL', 'FAIL', 'FAIL']
      const errorSpy = jest.fn()
      const client = new MockClient<TestItem>(failures)
      const relay = new Relay(client, { submissionInterval })
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
      const relay = new Relay(client, { submissionInterval })
      relay.on('error', errorSpy)
      relay.start()
      relay.submit(createItem())
      await setTimeout(submissionInterval * failures.length * 1.1)
      expect(errorSpy).toHaveBeenCalledTimes(0)
    })
  })
})
