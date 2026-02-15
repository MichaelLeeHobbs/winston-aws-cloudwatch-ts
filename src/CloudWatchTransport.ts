import type { TransportStreamOptions } from 'winston-transport'
import Transport from 'winston-transport'
import CloudWatchClient from './CloudWatchClient'
import type { CloudWatchLogsClientConfig } from '@aws-sdk/client-cloudwatch-logs'
import { type LogItem, type LogCallback } from './LogItem'
import Relay, { type RelayClient } from './Relay'

/**
 * Options for configuring {@link CloudWatchTransport}.
 *
 * Combines Winston transport options with CloudWatch client and relay settings.
 */
export interface CloudWatchTransportOptions extends TransportStreamOptions {
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
 * import CloudWatchTransport from 'winston-aws-cloudwatch-ts'
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
  private readonly relay: Relay<LogItem>
  // err is mutable by design since it's often enriched with additional context before being emitted, but we only read from it so we accept a mutable type for convenience
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  private readonly onRelayError = (err: Error): boolean => this.emit('error', err)

  // Our properties are all readonly, but the TransportStreamOptions we extend from Winston is mutable by design, so we accept a mutable type for convenience
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  constructor(options: CloudWatchTransportOptions) {
    super(options)

    const client: RelayClient<LogItem> = new CloudWatchClient(
      options.logGroupName,
      options.logStreamName,
      options
    )

    this.relay = new Relay<LogItem>(client, options)
    this.relay.on('error', this.onRelayError)
    this.relay.start()
  }

  /** Stops the relay, cleans up listeners, and emits `'close'`. */
  close(): void {
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

    this.relay.submit({ date: Date.now(), level, message: msg, meta, callback })
  }
}
