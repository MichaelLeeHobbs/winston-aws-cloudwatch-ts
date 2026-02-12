import { describe, it, expect, beforeEach } from '@jest/globals'
import CloudWatchEventFormatter from '../../src/cloudwatch-event-formatter'
import LogItem from '../../src/log-item'

const noop = (): void => undefined

describe('CloudWatchEventFormatter', () => {
  describe('constructor', () => {
    it('does not require options', () => {
      expect(() => {
        return new CloudWatchEventFormatter()
      }).not.toThrow()
    })
  })

  describe('formatLogItem()', () => {
    let formatter: CloudWatchEventFormatter

    beforeEach(() => {
      formatter = new CloudWatchEventFormatter()
    })

    it('formats a log item with metadata', () => {
      const date = 123456789
      const item = new LogItem(date, 'info', 'Hello, world', { foo: 'bar' }, noop)
      const event = formatter.formatLogItem(item)
      expect(event.timestamp).toBe(date)
      expect(event.message).toBe(`[INFO] Hello, world {
  "foo": "bar"
}`)
    })
  })

  describe('formatLog()', () => {
    let formatter: CloudWatchEventFormatter

    beforeEach(() => {
      formatter = new CloudWatchEventFormatter()
    })

    it('formats a log message with metadata', () => {
      const date = 123456789
      const item = new LogItem(date, 'info', 'Hello, world', { foo: 'bar' }, noop)
      const msg = formatter.formatLog(item)
      expect(msg).toBe(`[INFO] Hello, world {
  "foo": "bar"
}`)
    })

    it('omits metadata when undefined', () => {
      const item = new LogItem(+new Date(), 'info', 'Hello, world', undefined, noop)
      const msg = formatter.formatLog(item)
      expect(msg).toBe('[INFO] Hello, world')
    })

    it('omits metadata when empty', () => {
      const item = new LogItem(+new Date(), 'info', 'Hello, world', {}, noop)
      const msg = formatter.formatLog(item)
      expect(msg).toBe('[INFO] Hello, world')
    })
  })

  describe('options.formatLog', () => {
    it('overrides formatLog', () => {
      const formatLog = (): string => 'custom'
      const formatter = new CloudWatchEventFormatter({ formatLog })
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(formatter.formatLog).toBe(formatLog)
    })
  })

  describe('options.formatLogItem', () => {
    it('overrides formatLogItem', () => {
      const formatLogItem = (): { timestamp: number; message: string } => ({
        timestamp: 0,
        message: 'custom',
      })
      const formatter = new CloudWatchEventFormatter({ formatLogItem })
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(formatter.formatLogItem).toBe(formatLogItem)
    })

    it('does not override formatLogItem if formatLog is also supplied', () => {
      const formatLog = (): string => 'custom'
      const formatLogItem = (): { timestamp: number; message: string } => ({
        timestamp: 0,
        message: 'custom',
      })
      const formatter = new CloudWatchEventFormatter({
        formatLog,
        formatLogItem,
      })
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(formatter.formatLog).toBe(formatLog)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(formatter.formatLogItem).not.toBe(formatLogItem)
    })
  })
})
