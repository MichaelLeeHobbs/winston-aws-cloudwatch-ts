import { describe, it, expect } from '@jest/globals'
import Queue from '../../src/Queue'

interface TestItem {
  callback: () => void
}

const createItem = (): TestItem => ({ callback: () => undefined })

describe('Queue', () => {
  describe('size', () => {
    it('is 0 by default', () => {
      const queue = new Queue<TestItem>()
      expect(queue.size).toBe(0)
    })
  })

  describe('push()', () => {
    it('adds an item to an empty queue', () => {
      const queue = new Queue<TestItem>()
      const item = createItem()
      queue.push(item)
      expect(queue.size).toBe(1)
    })

    it('adds an item to a non-empty queue', () => {
      const queue = new Queue<TestItem>()
      for (let i = 0; i < 5; ++i) {
        queue.push(createItem())
      }
      const prevSize = queue.size
      queue.push(createItem())
      expect(queue.size).toBe(prevSize + 1)
    })
  })

  describe('head()', () => {
    it('returns the first items for a longer queue', () => {
      const queue = new Queue<TestItem>()
      const items: TestItem[] = []
      for (let i = 0; i < 3; ++i) {
        const item = createItem()
        items.push(item)
        queue.push(item)
      }
      for (let i = 0; i < 7; ++i) {
        queue.push(createItem())
      }
      expect(queue.head(items.length)).toEqual(items)
    })

    it('returns as many items as it can for a shorter queue', () => {
      const queue = new Queue<TestItem>()
      const items: TestItem[] = []
      for (let i = 0; i < 10; ++i) {
        const item = createItem()
        items.push(item)
        queue.push(item)
      }
      expect(queue.head(items.length * 2)).toEqual(items)
    })

    it('returns all items for a queue of equal length', () => {
      const queue = new Queue<TestItem>()
      const items: TestItem[] = []
      for (let i = 0; i < 10; ++i) {
        const item = createItem()
        items.push(item)
        queue.push(item)
      }
      expect(queue.head(items.length)).toEqual(items)
    })

    it('returns no items for an empty queue', () => {
      const queue = new Queue<TestItem>()
      expect(queue.head(10)).toEqual([])
    })

    it('returns no items when asked to do so', () => {
      const queue = new Queue<TestItem>()
      for (let i = 0; i < 10; ++i) {
        queue.push(createItem())
      }
      expect(queue.head(0)).toEqual([])
    })
  })

  describe('remove()', () => {
    it('removes the first items for a longer queue', () => {
      const queue = new Queue<TestItem>()
      const items: TestItem[] = []
      for (let i = 0; i < 3; ++i) {
        queue.push(createItem())
      }
      for (let i = 0; i < 7; ++i) {
        const item = createItem()
        items.push(item)
        queue.push(item)
      }
      queue.remove(3)
      expect(queue.size).toBe(items.length)
      expect(queue.head(items.length)).toEqual(items)
    })

    it('removes all items for a queue of equal length', () => {
      const queue = new Queue<TestItem>()
      const items: TestItem[] = []
      for (let i = 0; i < 10; ++i) {
        const item = createItem()
        items.push(item)
        queue.push(item)
      }
      queue.remove(items.length)
      expect(queue.size).toBe(0)
    })

    it('removes no items when asked to do so', () => {
      const queue = new Queue<TestItem>()
      const items: TestItem[] = []
      for (let i = 0; i < 10; ++i) {
        const item = createItem()
        items.push(item)
        queue.push(item)
      }
      queue.remove(0)
      expect(queue.size).toBe(items.length)
      expect(queue.head(10)).toEqual(items)
    })
  })

  describe('maxSize', () => {
    it('drops the oldest item when full', () => {
      const queue = new Queue<TestItem>(3)
      const items: TestItem[] = []
      for (let i = 0; i < 3; ++i) {
        const item = createItem()
        items.push(item)
        queue.push(item)
      }
      const overflow = createItem()
      const dropped = queue.push(overflow)
      expect(dropped).toBe(items[0])
      expect(queue.size).toBe(3)
      expect(queue.head(3)).toEqual([items[1], items[2], overflow])
    })

    it('returns undefined when not full', () => {
      const queue = new Queue<TestItem>(5)
      const dropped = queue.push(createItem())
      expect(dropped).toBeUndefined()
    })

    it('has no limit when maxSize is 0', () => {
      const queue = new Queue<TestItem>(0)
      for (let i = 0; i < 100; ++i) {
        queue.push(createItem())
      }
      expect(queue.size).toBe(100)
    })
  })
})
