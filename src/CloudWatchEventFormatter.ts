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
  /** When `true`, format log messages as JSON objects. Ignored if `formatLog` or `formatLogItem` is provided. */
  readonly jsonMessage?: boolean
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

  constructor({
    formatLog,
    formatLogItem,
    maxEventSize,
    jsonMessage,
  }: CloudWatchEventFormatterOptions = {}) {
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
    this._formatLog = this.resolveFormatLog(formatLog, formatLogItem, jsonMessage)
    this._formatLogItem = this.resolveFormatLogItem(formatLog, formatLogItem)
  }

  private resolveFormatLog(
    formatLog: CloudWatchEventFormatterOptions['formatLog'],
    formatLogItem: CloudWatchEventFormatterOptions['formatLogItem'],
    jsonMessage: boolean | undefined
  ): (item: LogItem) => string {
    if (typeof formatLog === 'function') return formatLog
    if (jsonMessage === true && typeof formatLogItem !== 'function') {
      return this.jsonFormatLog.bind(this)
    }
    return this.defaultFormatLog.bind(this)
  }

  private resolveFormatLogItem(
    formatLog: CloudWatchEventFormatterOptions['formatLog'],
    formatLogItem: CloudWatchEventFormatterOptions['formatLogItem']
  ): (item: LogItem) => { message: string; timestamp: number } {
    if (typeof formatLogItem === 'function' && typeof formatLog !== 'function') {
      return formatLogItem
    }
    return this.defaultFormatLogItem.bind(this)
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
    return this.truncateMessage(`[${level}] ${message}${metaString}`)
  }

  /**
   * JSON message formatter.
   *
   * Produces a flat JSON object with `level`, `message`, `timestamp`,
   * and any metadata keys spread in. Falls back to a plain-text format
   * when metadata contains circular references.
   */
  private jsonFormatLog(item: LogItem): string {
    const entry: Record<string, unknown> = {
      level: item.level,
      message: item.message,
      timestamp: item.date,
      ...(item.meta ?? {}),
    }
    try {
      return this.truncateMessage(JSON.stringify(entry))
    } catch {
      const level = item.level.toUpperCase()
      return `[${level}] ${item.message} [circular reference in metadata]`
    }
  }

  /**
   * Truncates a formatted string to the configured byte limit, appending
   * a `...[truncated]` suffix. Avoids splitting multi-byte UTF-8 characters.
   */
  private truncateMessage(formatted: string): string {
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
