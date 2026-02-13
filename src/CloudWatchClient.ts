import createDebug from 'debug'
import CloudWatchEventFormatter, {
  type CloudWatchEventFormatterOptions,
} from './CloudWatchEventFormatter'
import type LogItem from './LogItem'

import {
  CloudWatchLogsClient,
  type CloudWatchLogsClientConfig,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  DescribeLogStreamsCommand,
  type DescribeLogStreamsCommandOutput,
  type LogStream,
  PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs'

const debug = createDebug('winston-aws-cloudwatch:CloudWatchClient')

export interface CloudWatchClientOptions extends CloudWatchEventFormatterOptions {
  awsConfig?: CloudWatchLogsClientConfig
  createLogGroup?: boolean
  createLogStream?: boolean
  submissionRetryCount?: number
  timeout?: number
}

const DEFAULT_OPTIONS = {
  createLogGroup: false,
  createLogStream: false,
  submissionRetryCount: 1,
  timeout: 10_000,
} as const satisfies Partial<CloudWatchClientOptions>

interface AwsError extends Error {
  code?: string
}

function isAwsError(err: unknown): err is AwsError {
  return err instanceof Error
}

interface ResolvedOptions {
  createLogGroup: boolean
  createLogStream: boolean
  submissionRetryCount: number
  timeout: number
}

export default class CloudWatchClient {
  private readonly _logGroupName: string
  private readonly _logStreamName: string
  private readonly _options: ResolvedOptions
  private readonly _formatter: CloudWatchEventFormatter
  private _sequenceToken: string | null | undefined
  private readonly _client: CloudWatchLogsClient
  private _initializing: Promise<void> | null

  constructor(
    logGroupName: string,
    logStreamName: string,
    options?: Partial<CloudWatchClientOptions>
  ) {
    debug('constructor', { logGroupName, logStreamName, options })
    this._logGroupName = logGroupName
    this._logStreamName = logStreamName

    this._options = {
      createLogGroup: options?.createLogGroup ?? DEFAULT_OPTIONS.createLogGroup,
      createLogStream: options?.createLogStream ?? DEFAULT_OPTIONS.createLogStream,
      submissionRetryCount: options?.submissionRetryCount ?? DEFAULT_OPTIONS.submissionRetryCount,
      timeout: options?.timeout ?? DEFAULT_OPTIONS.timeout,
    }

    this._formatter = new CloudWatchEventFormatter(options)
    this._sequenceToken = null
    this._client = options?.awsConfig
      ? new CloudWatchLogsClient(options.awsConfig)
      : new CloudWatchLogsClient()
    this._initializing = null
  }

  destroy(): void {
    this._client.destroy()
  }

  private get _abortSignal(): AbortSignal {
    return AbortSignal.timeout(this._options.timeout)
  }

  async submit(batch: LogItem[]): Promise<void> {
    debug('submit', { batch })
    await this._initialize()
    return await this._doSubmit(batch)
  }

  private _initialize(): Promise<void> {
    this._initializing ??= this._maybeCreateLogGroup()
      .then(() => this._maybeCreateLogStream())
      .catch((err: unknown) => {
        // Reset so the next call retries instead of replaying the cached rejection
        this._initializing = null
        throw err
      })
    return this._initializing
  }

  private async _maybeCreateLogGroup(): Promise<void> {
    if (!this._options.createLogGroup) {
      return
    }
    const params = { logGroupName: this._logGroupName }
    try {
      await this._client.send(new CreateLogGroupCommand(params), { abortSignal: this._abortSignal })
    } catch (err) {
      if (!isAwsError(err) || err.code !== 'ResourceAlreadyExistsException') {
        throw err
      }
    }
  }

  private async _maybeCreateLogStream(): Promise<void> {
    if (!this._options.createLogStream) {
      return
    }
    const params = {
      logGroupName: this._logGroupName,
      logStreamName: this._logStreamName,
    }
    try {
      await this._client.send(new CreateLogStreamCommand(params), {
        abortSignal: this._abortSignal,
      })
    } catch (err) {
      if (!isAwsError(err) || err.code !== 'ResourceAlreadyExistsException') {
        throw err
      }
    }
  }

  private async _doSubmit(batch: LogItem[]): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this._maybeUpdateSequenceToken()
        await this._putLogEventsAndStoreSequenceToken(batch)
        return
      } catch (err) {
        if (!isAwsError(err) || err.code !== 'InvalidSequenceTokenException') {
          throw err
        }
        if (attempt >= this._options.submissionRetryCount) {
          const error = new Error(
            'InvalidSequenceTokenException: retry limit exceeded'
          ) as AwsError & { code: string }
          error.code = 'InvalidSequenceTokenException'
          throw error
        }
        this._sequenceToken = null
      }
    }
  }

  private async _maybeUpdateSequenceToken(): Promise<void> {
    // null = unknown (needs fetch); undefined = known empty (new stream)
    if (this._sequenceToken !== null) {
      return Promise.resolve()
    }
    await this._fetchAndStoreSequenceToken()
    return undefined
  }

  private async _putLogEventsAndStoreSequenceToken(batch: LogItem[]): Promise<void> {
    const { nextSequenceToken } = await this._putLogEvents(batch)
    this._storeSequenceToken(nextSequenceToken)
  }

  private _putLogEvents(batch: LogItem[]) {
    const sequenceToken = this._sequenceToken === null ? undefined : this._sequenceToken
    debug('putLogEvents', { batch, sequenceToken })
    const params = {
      logGroupName: this._logGroupName,
      logStreamName: this._logStreamName,
      logEvents: batch.map(item => this._formatter.formatLogItem(item)),
      sequenceToken,
    }
    return this._client.send(new PutLogEventsCommand(params), { abortSignal: this._abortSignal })
  }

  private async _fetchAndStoreSequenceToken(): Promise<string | undefined> {
    debug('fetchSequenceToken')
    const { uploadSequenceToken } = await this._findLogStream()
    return this._storeSequenceToken(uploadSequenceToken)
  }

  private _storeSequenceToken(sequenceToken: string | undefined): string | undefined {
    debug('storeSequenceToken', { sequenceToken })
    this._sequenceToken = sequenceToken
    return sequenceToken
  }

  private async _findLogStream(): Promise<LogStream> {
    let nextToken: DescribeLogStreamsCommandOutput['nextToken']
    do {
      debug('findLogStream', { nextToken })
      const res = await this._client.send(
        new DescribeLogStreamsCommand({
          logGroupName: this._logGroupName,
          logStreamNamePrefix: this._logStreamName,
          nextToken,
        }),
        { abortSignal: this._abortSignal }
      )
      const { logStreams = [] } = res
      const match = logStreams.find(ls => ls.logStreamName === this._logStreamName)
      if (match) return match
      nextToken = res.nextToken
    } while (nextToken != null)
    throw new Error('Log stream not found')
  }
}
