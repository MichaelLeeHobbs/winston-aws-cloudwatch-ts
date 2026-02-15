import { type LogItem } from './LogItem'

/**
 * Options for customizing log event formatting.
 *
 * **Precedence**: If both `formatLog` and `formatLogItem` are provided,
 * only `formatLog` is used — `formatLogItem` is ignored. Use `formatLog`
 * to customize the message string only, or `formatLogItem` to control
 * both the message and timestamp.
 */
export interface CloudWatchEventFormatterOptions {
  /** Custom formatter that returns the message string for a log event. Takes precedence over `formatLogItem`. */
  readonly formatLog?: (item: LogItem) => string
  /** Custom formatter that returns both the message and timestamp for a log event. Ignored if `formatLog` is also provided. */
  readonly formatLogItem?: (item: LogItem) => { message: string; timestamp: number }
  /**
   * Maximum event size in bytes, including the 26-byte per-event overhead
   * AWS adds for internal metadata. The usable message payload is
   * `maxEventSize - 26` bytes; messages exceeding that are truncated.
   *
   * @defaultValue {@link DEFAULT_MAX_EVENT_SIZE | 1_048_576} (1 MB)
   */
  readonly maxEventSize?: number
}

/**
 * Per-event metadata overhead in bytes added by AWS CloudWatch.
 * Each log event carries 26 bytes of internal metadata (including the
 * timestamp) that counts toward the maximum event size.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html
 */
export const EVENT_OVERHEAD_BYTES = 26

/**
 * Default maximum event size in bytes (1 MB), matching the current
 * CloudWatch PutLogEvents per-event limit.
 */
export const DEFAULT_MAX_EVENT_SIZE = 1_048_576

/** Suffix appended to messages that exceed the maximum message length. */
const TRUNCATION_SUFFIX = '...[truncated]'

/**
 * Converts {@link LogItem} instances into CloudWatch `InputLogEvent` objects.
 *
 * Default format: `[LEVEL] message {metadata}`.
 * Override via `formatLog` or `formatLogItem` constructor options.
 *
 * Formatter functions are stored in private readonly fields and exposed
 * via getter-only properties, preventing accidental overwrite.
 */
export default class CloudWatchEventFormatter {
  private readonly _formatLog: (item: LogItem) => string
  private readonly _formatLogItem: (item: LogItem) => { message: string; timestamp: number }
  private readonly maxMessageLength: number

  constructor({ formatLog, formatLogItem, maxEventSize }: CloudWatchEventFormatterOptions = {}) {
    if (
      maxEventSize !== undefined &&
      (!Number.isFinite(maxEventSize) ||
        maxEventSize <= EVENT_OVERHEAD_BYTES + TRUNCATION_SUFFIX.length)
    ) {
      throw new Error(
        `maxEventSize must be a finite number greater than ${EVENT_OVERHEAD_BYTES + TRUNCATION_SUFFIX.length}`
      )
    }
    this.maxMessageLength = (maxEventSize ?? DEFAULT_MAX_EVENT_SIZE) - EVENT_OVERHEAD_BYTES

    if (typeof formatLog === 'function') {
      this._formatLog = formatLog
    } else {
      this._formatLog = this.defaultFormatLog.bind(this)
    }

    if (typeof formatLogItem === 'function' && typeof formatLog !== 'function') {
      this._formatLogItem = formatLogItem
    } else {
      this._formatLogItem = this.defaultFormatLogItem.bind(this)
    }
  }

  /** Returns the log-message formatter function. */
  get formatLog(): (item: LogItem) => string {
    return this._formatLog
  }

  /** Returns the log-item formatter function. */
  get formatLogItem(): (item: LogItem) => { message: string; timestamp: number } {
    return this._formatLogItem
  }

  private defaultFormatLogItem(item: LogItem): { message: string; timestamp: number } {
    return {
      message: this._formatLog(item),
      timestamp: item.date,
    }
  }

  /**
   * Default message formatter.
   *
   * Format: `[LEVEL] message {metadata}`. Messages exceeding
   * `maxEventSize - EVENT_OVERHEAD_BYTES` bytes are truncated with
   * a `...[truncated]` suffix.
   */
  private defaultFormatLog(item: LogItem): string {
    const level = item.level.toUpperCase()
    const message = item.message
    const meta = item.meta
    const metaString =
      meta != null && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta, null, 2)}` : ''
    const formatted = `[${level}] ${message}${metaString}`

    if (Buffer.byteLength(formatted, 'utf8') <= this.maxMessageLength) {
      return formatted
    }

    // Truncate to byte limit. Walk back from the cut point past any UTF-8
    // continuation bytes (10xxxxxx) to avoid splitting multi-byte characters.
    const targetBytes = this.maxMessageLength - TRUNCATION_SUFFIX.length
    const buf = Buffer.from(formatted, 'utf8')
    let end = targetBytes
    while (end > 0) {
      const byte = buf[end]
      if (byte === undefined || (byte & 0xc0) !== 0x80) break
      end--
    }

    return buf.toString('utf8', 0, end) + TRUNCATION_SUFFIX
  }
}
