import createDebug from 'debug'
import CloudWatchEventFormatter, {
  type CloudWatchEventFormatterOptions,
} from './CloudWatchEventFormatter'
import { type LogItem } from './LogItem'

import { isError } from './typeGuards'
import {
  CloudWatchLogsClient,
  type CloudWatchLogsClientConfig,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs'

const debug = createDebug('winston-aws-cloudwatch:CloudWatchClient')

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
    this.client = options?.awsConfig
      ? /* istanbul ignore next */ new CloudWatchLogsClient(options.awsConfig)
      : new CloudWatchLogsClient()
    this.initializing = null
  }

  /** Destroys the underlying AWS SDK client, releasing its resources. */
  /* istanbul ignore next */
  destroy(): void {
    this.client.destroy()
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
    const params = {
      logGroupName: this.logGroupName,
      logStreamName: this.logStreamName,
      logEvents: batch.map(item => this.formatter.formatLogItem(item)),
    }
    await this.client.send(new PutLogEventsCommand(params), { abortSignal: this.abortSignal })
  }
}
