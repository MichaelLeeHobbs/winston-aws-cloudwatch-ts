import { describe, it, expect } from '@jest/globals'
import LogItem from '../../src/log-item'

const noop = (): void => undefined

describe('LogItem', () => {
  describe('date', () => {
    it("returns the item's date", () => {
      const date = +new Date()
      const level = 'info'
      const message = 'Hello, world'
      const meta = {}
      const item = new LogItem(date, level, message, meta, noop)
      expect(item.date).toBe(date)
    })
  })

  describe('level', () => {
    it("returns the item's level", () => {
      const date = +new Date()
      const level = 'info'
      const message = 'Hello, world'
      const meta = {}
      const item = new LogItem(date, level, message, meta, noop)
      expect(item.level).toBe(level)
    })
  })

  describe('message', () => {
    it("returns the item's message", () => {
      const date = +new Date()
      const level = 'info'
      const message = 'Hello, world'
      const meta = {}
      const item = new LogItem(date, level, message, meta, noop)
      expect(item.message).toBe(message)
    })
  })

  describe('meta', () => {
    it("returns the item's meta object", () => {
      const date = +new Date()
      const level = 'info'
      const message = 'Hello, world'
      const meta = {}
      const item = new LogItem(date, level, message, meta, noop)
      expect(item.meta).toEqual(meta)
    })
  })

  describe('callback', () => {
    it("returns the item's callback function", () => {
      const date = +new Date()
      const level = 'info'
      const message = 'Hello, world'
      const meta = {}
      const item = new LogItem(date, level, message, meta, noop)
      expect(item.callback).toBe(noop)
    })
  })
})
