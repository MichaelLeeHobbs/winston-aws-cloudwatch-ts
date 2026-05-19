import type { TransportStreamOptions } from 'winston-transport'
import Transport from 'winston-transport'
import CloudWatchClient, { type RetentionInDays } from './CloudWatchClient'
import {
  type CloudWatchLogsClientConfig,
  type CloudWatchLogsClient,
} from '@aws-sdk/client-cloudwatch-logs'
import { type LogItem, type LogCallback } from './LogItem'
import Relay, { type RelayClient } from './Relay'

// Stand-in callback for relay items. CloudWatch delivery is intentionally
// decoupled from the Winston Writable stream (see `log()`), so the relay no
// longer drives the stream's write callback — delivery success/failure is
// surfaced via the relay's `'error'` event instead.
const noop: LogCallback = (): void => undefined

/**
 * Options for configuring {@link CloudWatchTransport}.
 *
 * Combines Winston transport options with CloudWatch client and relay settings.
 */
export interface CloudWatchTransportOptions extends TransportStreamOptions {
  /** Transport name used by Winston to identify this transport. Default: `'cloudwatch'`. */
  readonly name?: string
  /** CloudWatch log group name (1-512 characters). */
  readonly logGroupName: string
  /** CloudWatch log stream name (1-512 characters). */
  readonly logStreamName: string

  /** AWS SDK client configuration (credentials, region, endpoint, etc.). */
  readonly awsConfig?: CloudWatchLogsClientConfig
  /** Custom formatter for the message string. Takes precedence over `formatLogItem`. */
  readonly formatLog?: (item: LogItem) => string
  /** Custom formatter for both message and timestamp. Ignored if `formatLog` is provided. */
  readonly formatLogItem?: (item: LogItem) => { message: string; timestamp: number }
  /** Auto-create the log group on first submission. Default: `false`. */
  readonly createLogGroup?: boolean
  /** Auto-create the log stream on first submission. Default: `false`. */
  readonly createLogStream?: boolean
  /** Timeout in milliseconds for each AWS SDK call. Default: `10000`. */
  readonly timeout?: number
  /** Maximum event size in bytes, including 26 bytes of per-event overhead. Messages exceeding the limit are truncated. Default: `1_048_576` (1 MB). */
  readonly maxEventSize?: number
  /** When `true`, format log messages as JSON objects. Ignored if `formatLog` or `formatLogItem` is provided. */
  readonly jsonMessage?: boolean
  /** Set the retention policy on the log group (in days). Works on pre-existing groups too. */
  readonly retentionInDays?: RetentionInDays
  /** Pre-built AWS SDK client. When provided, `awsConfig` is ignored and the client is not destroyed on close. */
  readonly cloudWatchLogs?: CloudWatchLogsClient

  /** Minimum interval in milliseconds between batch submissions. Default: `2000`. */
  readonly submissionInterval?: number
  /** Maximum number of items per batch. Default: `20`. */
  readonly batchSize?: number
  /** Maximum queue size before oldest items are dropped. Default: `10000`. */
  readonly maxQueueSize?: number
}

/**
 * Winston transport that ships logs to AWS CloudWatch Logs.
 *
 * Buffers log entries and submits them in batches via {@link Relay} and
 * {@link CloudWatchClient}. This is the main entry point for the library.
 *
 * @example
 * ```ts
 * import winston from 'winston'
 * import CloudWatchTransport from '@ubercode/winston-cloudwatch'
 *
 * const logger = winston.createLogger({
 *   transports: [
 *     new CloudWatchTransport({
 *       logGroupName: '/my-app/logs',
 *       logStreamName: 'production',
 *     }),
 *   ],
 * })
 * ```
 */
export default class CloudWatchTransport extends Transport {
  readonly name: string
  private readonly relay: Relay<LogItem>
  // err is mutable by design since it's often enriched with additional context before being emitted, but we only read from it so we accept a mutable type for convenience
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  private readonly onRelayError = (err: Error): boolean => this.emit('error', err)

  // Our properties are all readonly, but the TransportStreamOptions we extend from Winston is mutable by design, so we accept a mutable type for convenience
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  constructor(options: CloudWatchTransportOptions) {
    super(options)
    this.name = options.name ?? 'cloudwatch'

    const client: RelayClient<LogItem> = new CloudWatchClient(
      options.logGroupName,
      options.logStreamName,
      options
    )

    this.relay = new Relay<LogItem>(client, options)
    this.relay.on('error', this.onRelayError)
    this.relay.start()
  }

  /** Returns a promise that resolves when the queue has been fully drained or the timeout expires. */
  async flush(timeout?: number): Promise<void> {
    await this.relay.flush(timeout)
  }

  /**
   * Flushes pending log items (best-effort, bounded by the relay's flush
   * timeout), stops the relay, cleans up listeners, and emits `'close'`.
   *
   * Winston calls this on shutdown without awaiting it. For maximum log
   * delivery during a graceful shutdown, `await transport.flush()` (or await
   * this method) before the process exits.
   */
  // Winston's TransportStream types close() as `() => void` and never awaits
  // its return; returning a Promise is safe because every rejection is handled
  // internally (flush is guarded, stop() cannot throw), so this can never
  // produce an unhandled rejection.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async close(): Promise<void> {
    try {
      await this.relay.flush()
    } catch {
      // flush() resolves on timeout and is not expected to reject; guard
      // defensively so close() never produces an unhandled rejection.
    }
    this.relay.removeListener('error', this.onRelayError)
    this.relay.stop()
    this.emit('close')
  }

  /** Receives a log entry from Winston and enqueues it for batch submission. */
  log(info: Readonly<Record<string, unknown>>, callback: LogCallback): void {
    const level = typeof info.level === 'string' ? info.level : ''
    const msg = typeof info.message === 'string' ? info.message : ''

    // Copy all fields except level/message as metadata
    const { level: _level, message: _message, ...rest } = info
    const meta: Record<string, unknown> = { ...rest }

    // Decouple CloudWatch delivery from the Winston Writable stream.
    //
    // winston-transport hands us the Writable stream's own write callback. The
    // transport is an objectMode Writable that serializes writes: until that
    // callback fires, every subsequent log accumulates in the stream's internal
    // buffered linked list. If the callback were deferred until CloudWatch
    // confirmed delivery, any persistent submit() failure (throttling, timeout,
    // missing IAM, ...) would retry the same head batch forever, never resolve
    // the callback, stall the stream, and buffer every later log unbounded
    // until the process OOMs (issue #9).
    //
    // Instead, accept the entry into the relay's bounded queue and resolve the
    // stream callback immediately. Bounded buffering / backpressure is the
    // relay queue's responsibility (maxQueueSize, oldest dropped on overflow) —
    // which only works if the upstream stream keeps draining. Delivery
    // failures are reported via the relay's `'error'` event, not this callback.
    this.relay.submit({ date: Date.now(), level, message: msg, meta, callback: noop })
    callback(null)
  }
}
