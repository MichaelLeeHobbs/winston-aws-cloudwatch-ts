import createDebug from 'debug'
import CloudWatchEventFormatter, {
  type CloudWatchEventFormatterOptions,
  EVENT_OVERHEAD_BYTES,
} from './CloudWatchEventFormatter'
import { type LogItem } from './LogItem'

import { isError } from './typeGuards'
import {
  CloudWatchLogsClient,
  type CloudWatchLogsClientConfig,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  PutRetentionPolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs'

const debug = createDebug('winston-aws-cloudwatch:CloudWatchClient')

/** Valid values for the CloudWatch Logs retention policy, in days. */
export const VALID_RETENTION_DAYS = [
  1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653,
] as const

/** Allowed retention period values for a CloudWatch log group. */
export type RetentionInDays = (typeof VALID_RETENTION_DAYS)[number]

/**
 * Maximum total payload size in bytes for a single PutLogEvents call.
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html
 */
export const MAX_BATCH_BYTES = 1_048_576

/** A formatted log event ready for submission. */
interface FormattedEvent {
  readonly message: string
  readonly timestamp: number
}

/** Options for configuring {@link CloudWatchClient}. */
export interface CloudWatchClientOptions extends CloudWatchEventFormatterOptions {
  /** AWS SDK client configuration (credentials, region, endpoint, etc.). */
  readonly awsConfig?: CloudWatchLogsClientConfig
  /** Auto-create the log group on first submission if it doesn't exist. Default: `false`. */
  readonly createLogGroup?: boolean
  /** Auto-create the log stream on first submission if it doesn't exist. Default: `false`. */
  readonly createLogStream?: boolean
  /** Timeout in milliseconds for each AWS SDK call. Default: `10000`. */
  readonly timeout?: number
  /** Set the retention policy on the log group (in days). Works on pre-existing groups too. */
  readonly retentionInDays?: RetentionInDays
  /** Pre-built AWS SDK client. When provided, `awsConfig` is ignored and the client is not destroyed on close. */
  readonly cloudWatchLogs?: CloudWatchLogsClient
}

const DEFAULT_OPTIONS = {
  createLogGroup: false,
  createLogStream: false,
  timeout: 10_000,
} as const satisfies Partial<CloudWatchClientOptions>

interface ResolvedOptions {
  readonly createLogGroup: boolean
  readonly createLogStream: boolean
  readonly timeout: number
  readonly retentionInDays: RetentionInDays | undefined
}

function validateConfig(
  logGroupName: string,
  logStreamName: string,
  options: ResolvedOptions
): void {
  const errors: string[] = []
  if (!logGroupName || logGroupName.length > 512) {
    errors.push('logGroupName must be between 1 and 512 characters')
  }
  if (!logStreamName || logStreamName.length > 512) {
    errors.push('logStreamName must be between 1 and 512 characters')
  }
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    errors.push('timeout must be a finite number greater than 0')
  }
  if (
    options.retentionInDays !== undefined &&
    !VALID_RETENTION_DAYS.includes(options.retentionInDays)
  ) {
    errors.push(`retentionInDays must be one of: ${VALID_RETENTION_DAYS.join(', ')}`)
  }
  if (errors.length > 0) {
    throw new Error(`Invalid CloudWatchClient configuration:\n- ${errors.join('\n- ')}`)
  }
}

// AWS SDK client configuration is mutable by design, but we only read from it so we accept a mutable type for convenience
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
function resolveOptions(options?: Partial<CloudWatchClientOptions>): ResolvedOptions {
  return {
    createLogGroup: options?.createLogGroup ?? DEFAULT_OPTIONS.createLogGroup,
    createLogStream: options?.createLogStream ?? DEFAULT_OPTIONS.createLogStream,
    timeout: options?.timeout ?? DEFAULT_OPTIONS.timeout,
    retentionInDays: options?.retentionInDays,
  }
}

/**
 * Manages communication with the AWS CloudWatch Logs API.
 *
 * Handles optional auto-creation of log groups/streams and submitting
 * log events via `PutLogEvents`. Implements {@link RelayClient} for use
 * with {@link Relay}.
 */
export default class CloudWatchClient {
  private readonly logGroupName: string
  private readonly logStreamName: string
  private readonly options: ResolvedOptions
  private readonly formatter: CloudWatchEventFormatter
  private readonly client: CloudWatchLogsClient
  private readonly ownsClient: boolean
  private initializing: Promise<void> | null

  constructor(
    logGroupName: string,
    logStreamName: string,
    // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
    options?: Partial<CloudWatchClientOptions>
  ) {
    debug('constructor', { logGroupName, logStreamName })
    this.options = resolveOptions(options)
    validateConfig(logGroupName, logStreamName, this.options)
    this.logGroupName = logGroupName
    this.logStreamName = logStreamName
    this.formatter = new CloudWatchEventFormatter(options)
    if (options?.cloudWatchLogs) {
      this.client = options.cloudWatchLogs
      this.ownsClient = false
    } else {
      this.client = options?.awsConfig
        ? /* istanbul ignore next */ new CloudWatchLogsClient(options.awsConfig)
        : new CloudWatchLogsClient()
      this.ownsClient = true
    }
    this.initializing = null
  }

  /** Destroys the underlying AWS SDK client if it was created internally. */
  destroy(): void {
    if (this.ownsClient) {
      this.client.destroy()
    }
  }

  private get abortSignal(): AbortSignal {
    return AbortSignal.timeout(this.options.timeout)
  }

  /** Submits a batch of log items to CloudWatch Logs via `PutLogEvents`. */
  async submit(batch: readonly LogItem[]): Promise<void> {
    debug('submit', { batchSize: batch.length })
    await this.initialize()
    await this.putLogEvents(batch)
  }

  // Lazy, idempotent initialization. The ??= operator ensures that concurrent
  // submit() calls share a single in-flight promise rather than racing to create
  // duplicate log groups/streams. On success the resolved promise is cached so
  // subsequent submits skip initialization entirely. On failure the cached
  // promise is cleared so the next submit() retries from scratch instead of
  // permanently replaying the rejected promise.
  private initialize(): Promise<void> {
    this.initializing ??= this.maybeCreateLogGroup()
      .then(() => this.maybeSetRetentionPolicy())
      .then(() => this.maybeCreateLogStream())
      .catch((err: unknown) => {
        this.initializing = null
        throw err
      })
    return this.initializing
  }

  private async maybeCreateLogGroup(): Promise<void> {
    if (!this.options.createLogGroup) {
      return
    }
    const params = { logGroupName: this.logGroupName }
    try {
      await this.client.send(new CreateLogGroupCommand(params), { abortSignal: this.abortSignal })
    } catch (err) {
      if (!isError(err) || err.name !== 'ResourceAlreadyExistsException') {
        throw err
      }
    }
  }

  private async maybeSetRetentionPolicy(): Promise<void> {
    if (this.options.retentionInDays === undefined) {
      return
    }
    const params = {
      logGroupName: this.logGroupName,
      retentionInDays: this.options.retentionInDays,
    }
    await this.client.send(new PutRetentionPolicyCommand(params), {
      abortSignal: this.abortSignal,
    })
  }

  private async maybeCreateLogStream(): Promise<void> {
    if (!this.options.createLogStream) {
      return
    }
    const params = {
      logGroupName: this.logGroupName,
      logStreamName: this.logStreamName,
    }
    try {
      await this.client.send(new CreateLogStreamCommand(params), {
        abortSignal: this.abortSignal,
      })
    } catch (err) {
      if (!isError(err) || err.name !== 'ResourceAlreadyExistsException') {
        throw err
      }
    }
  }

  private async putLogEvents(batch: readonly LogItem[]): Promise<void> {
    debug('putLogEvents', { batchSize: batch.length })
    const events = batch
      .map(item => this.formatter.formatLogItem(item))
      .sort((a: Readonly<FormattedEvent>, b: Readonly<FormattedEvent>) => a.timestamp - b.timestamp)

    for (const subBatch of this.splitByByteLimit(events)) {
      await this.sendBatch(subBatch)
    }
  }

  private *splitByByteLimit(events: readonly FormattedEvent[]): Generator<FormattedEvent[]> {
    let current: FormattedEvent[] = []
    let currentBytes = 0

    for (const event of events) {
      const eventBytes = Buffer.byteLength(event.message, 'utf8') + EVENT_OVERHEAD_BYTES
      if (current.length > 0 && currentBytes + eventBytes > MAX_BATCH_BYTES) {
        yield current
        current = []
        currentBytes = 0
      }
      current.push(event)
      currentBytes += eventBytes
    }

    /* istanbul ignore next */
    if (current.length > 0) {
      yield current
    }
  }

  // PutLogEventsCommand expects a mutable InputLogEvent[], so we accept a mutable array here
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  private async sendBatch(logEvents: FormattedEvent[]): Promise<void> {
    const params = {
      logGroupName: this.logGroupName,
      logStreamName: this.logStreamName,
      logEvents,
    }
    await this.client.send(new PutLogEventsCommand(params), { abortSignal: this.abortSignal })
  }
}
