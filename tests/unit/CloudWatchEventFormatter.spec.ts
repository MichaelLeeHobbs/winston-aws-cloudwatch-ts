import { describe, it, expect, beforeEach } from '@jest/globals'
import CloudWatchEventFormatter, {
  DEFAULT_MAX_EVENT_SIZE,
  EVENT_OVERHEAD_BYTES,
} from '../../src/CloudWatchEventFormatter'

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
      const item = {
        date,
        level: 'info',
        message: 'Hello, world',
        meta: { foo: 'bar' },
        callback: noop,
      }
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
      const item = {
        date,
        level: 'info',
        message: 'Hello, world',
        meta: { foo: 'bar' },
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(msg).toBe(`[INFO] Hello, world {
  "foo": "bar"
}`)
    })

    it('omits metadata when undefined', () => {
      const item = {
        date: +new Date(),
        level: 'info',
        message: 'Hello, world',
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(msg).toBe('[INFO] Hello, world')
    })

    it('omits metadata when empty', () => {
      const item = {
        date: +new Date(),
        level: 'info',
        message: 'Hello, world',
        meta: {},
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(msg).toBe('[INFO] Hello, world')
    })
  })

  describe('options.formatLog', () => {
    it('overrides formatLog', () => {
      const formatLog = (): string => 'custom'
      const formatter = new CloudWatchEventFormatter({ formatLog })
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
      expect(formatter.formatLog).toBe(formatLog)
      expect(formatter.formatLogItem).not.toBe(formatLogItem)
    })
  })

  describe('maxEventSize validation', () => {
    it('throws when maxEventSize is zero', () => {
      expect(() => new CloudWatchEventFormatter({ maxEventSize: 0 })).toThrow(
        /maxEventSize must be a finite number greater than 40/
      )
    })

    it('throws when maxEventSize is negative', () => {
      expect(() => new CloudWatchEventFormatter({ maxEventSize: -1 })).toThrow(
        /maxEventSize must be a finite number greater than 40/
      )
    })

    it('throws when maxEventSize is too small to fit overhead + truncation suffix', () => {
      expect(() => new CloudWatchEventFormatter({ maxEventSize: 40 })).toThrow(
        /maxEventSize must be a finite number greater than 40/
      )
    })

    it('throws when maxEventSize is NaN', () => {
      expect(() => new CloudWatchEventFormatter({ maxEventSize: NaN })).toThrow(
        /maxEventSize must be a finite number greater than 40/
      )
    })

    it('throws when maxEventSize is Infinity', () => {
      expect(() => new CloudWatchEventFormatter({ maxEventSize: Infinity })).toThrow(
        /maxEventSize must be a finite number greater than 40/
      )
    })

    it('accepts maxEventSize just above the minimum', () => {
      expect(() => new CloudWatchEventFormatter({ maxEventSize: 41 })).not.toThrow()
    })
  })

  describe('truncation', () => {
    const maxMessage = DEFAULT_MAX_EVENT_SIZE - EVENT_OVERHEAD_BYTES

    it('truncates messages exceeding the default limit', () => {
      const formatter = new CloudWatchEventFormatter()
      const longBody = 'x'.repeat(maxMessage + 100)
      const item = {
        date: 0,
        level: 'info',
        message: longBody,
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(msg).toHaveLength(maxMessage)
      expect(msg).toMatch(/\.\.\.\[truncated]$/)
    })

    it('does not truncate messages at exactly the limit', () => {
      const formatter = new CloudWatchEventFormatter()
      // "[INFO] " is 7 chars, so body = maxMessage - 7
      const body = 'x'.repeat(maxMessage - 7)
      const item = {
        date: 0,
        level: 'info',
        message: body,
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(msg).toHaveLength(maxMessage)
      expect(msg).not.toMatch(/\.\.\.\[truncated]$/)
    })

    it('respects a custom smaller maxEventSize', () => {
      const formatter = new CloudWatchEventFormatter({ maxEventSize: 1000 })
      const customMax = 1000 - EVENT_OVERHEAD_BYTES // 974
      const longBody = 'x'.repeat(2000)
      const item = {
        date: 0,
        level: 'info',
        message: longBody,
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(msg).toHaveLength(customMax)
      expect(msg).toMatch(/\.\.\.\[truncated]$/)
    })

    it('truncates multi-byte characters by byte length without splitting', () => {
      const formatter = new CloudWatchEventFormatter({ maxEventSize: 100 })
      const maxMessage = 100 - EVENT_OVERHEAD_BYTES // 74 bytes
      // Each emoji (🎉) is 4 UTF-8 bytes but only 2 UTF-16 code units.
      // "[INFO] " is 7 bytes. 50 emojis = 200 bytes. Total = 207 bytes > 74.
      const item = {
        date: 0,
        level: 'info',
        message: '🎉'.repeat(50),
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(Buffer.byteLength(msg, 'utf8')).toBeLessThanOrEqual(maxMessage)
      expect(msg).toMatch(/\.\.\.\[truncated]$/)
      // No broken surrogate pairs (replacement character U+FFFD)
      expect(msg).not.toContain('\uFFFD')
    })

    it('respects a custom larger maxEventSize', () => {
      const formatter = new CloudWatchEventFormatter({ maxEventSize: 2_000_000 })
      // A 256K message should not be truncated with a 2MB limit
      const body = 'x'.repeat(256_000)
      const item = {
        date: 0,
        level: 'info',
        message: body,
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(msg).not.toMatch(/\.\.\.\[truncated]$/)
      expect(msg).toContain(body)
    })
  })

  describe('jsonMessage', () => {
    it('formats a log item as JSON when jsonMessage is true', () => {
      const formatter = new CloudWatchEventFormatter({ jsonMessage: true })
      const item = {
        date: 123456789,
        level: 'info',
        message: 'Hello, world',
        meta: { foo: 'bar' },
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      const parsed = JSON.parse(msg) as Record<string, unknown>
      expect(parsed).toEqual({
        level: 'info',
        message: 'Hello, world',
        timestamp: 123456789,
        foo: 'bar',
      })
    })

    it('produces valid JSON when meta is undefined', () => {
      const formatter = new CloudWatchEventFormatter({ jsonMessage: true })
      const item = {
        date: 100,
        level: 'warn',
        message: 'no meta',
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      const parsed = JSON.parse(msg) as Record<string, unknown>
      expect(parsed).toEqual({
        level: 'warn',
        message: 'no meta',
        timestamp: 100,
      })
    })

    it('produces valid JSON when meta is empty', () => {
      const formatter = new CloudWatchEventFormatter({ jsonMessage: true })
      const item = {
        date: 200,
        level: 'debug',
        message: 'empty meta',
        meta: {},
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      const parsed = JSON.parse(msg) as Record<string, unknown>
      expect(parsed).toEqual({
        level: 'debug',
        message: 'empty meta',
        timestamp: 200,
      })
    })

    it('falls back to plain text on circular reference', () => {
      const formatter = new CloudWatchEventFormatter({ jsonMessage: true })
      const circular: Record<string, unknown> = {}
      circular.self = circular
      const item = {
        date: 0,
        level: 'error',
        message: 'boom',
        meta: circular,
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(msg).toBe('[ERROR] boom [circular reference in metadata]')
    })

    it('is ignored when formatLog is provided', () => {
      const formatLog = (): string => 'custom'
      const formatter = new CloudWatchEventFormatter({ jsonMessage: true, formatLog })
      expect(formatter.formatLog).toBe(formatLog)
    })

    it('is ignored when formatLogItem is provided', () => {
      const formatLogItem = (): { timestamp: number; message: string } => ({
        timestamp: 0,
        message: 'custom',
      })
      const formatter = new CloudWatchEventFormatter({ jsonMessage: true, formatLogItem })
      expect(formatter.formatLogItem).toBe(formatLogItem)
    })

    it('truncates oversized JSON messages', () => {
      const formatter = new CloudWatchEventFormatter({ jsonMessage: true, maxEventSize: 200 })
      const maxMessage = 200 - EVENT_OVERHEAD_BYTES
      const item = {
        date: 0,
        level: 'info',
        message: 'x'.repeat(500),
        callback: noop,
      }
      const msg = formatter.formatLog(item)
      expect(Buffer.byteLength(msg, 'utf8')).toBeLessThanOrEqual(maxMessage)
      expect(msg).toMatch(/\.\.\.\[truncated]$/)
    })
  })

  describe('immutability', () => {
    it('formatLog getter returns the stored function', () => {
      const formatter = new CloudWatchEventFormatter()
      const fn = formatter.formatLog
      expect(typeof fn).toBe('function')
      expect(formatter.formatLog).toBe(fn)
    })

    it('formatLogItem getter returns the stored function', () => {
      const formatter = new CloudWatchEventFormatter()
      const fn = formatter.formatLogItem
      expect(typeof fn).toBe('function')
      expect(formatter.formatLogItem).toBe(fn)
    })

    it('assignment to formatLog throws', () => {
      const formatter = new CloudWatchEventFormatter()
      expect(() => {
        ;(formatter as unknown as Record<string, unknown>).formatLog = (): string => 'hacked'
      }).toThrow()
    })

    it('assignment to formatLogItem throws', () => {
      const formatter = new CloudWatchEventFormatter()
      expect(() => {
        ;(formatter as unknown as Record<string, unknown>).formatLogItem = (): {
          message: string
          timestamp: number
        } => ({
          message: 'hacked',
          timestamp: 0,
        })
      }).toThrow()
    })
  })
})
