import createDebug from 'debug'
import CloudWatchEventFormatter, {
  type CloudWatchEventFormatterOptions,
} from './cloudwatch-event-formatter'
import type LogItem from './log-item'

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
}

const DEFAULT_OPTIONS = {
  createLogGroup: false,
  createLogStream: false,
  submissionRetryCount: 1,
} as const satisfies Partial<CloudWatchClientOptions>

interface AwsError extends Error {
  code?: string
}

interface ResolvedOptions {
  createLogGroup: boolean
  createLogStream: boolean
  submissionRetryCount: number
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
    }

    this._formatter = new CloudWatchEventFormatter(options)
    this._sequenceToken = null
    this._client = options?.awsConfig
      ? new CloudWatchLogsClient(options.awsConfig)
      : new CloudWatchLogsClient()
    this._initializing = null
  }

  async submit(batch: LogItem[]): Promise<void> {
    debug('submit', { batch })
    await this._initialize()
    return await this._doSubmit(batch, 0)
  }

  private _initialize(): Promise<void> {
    this._initializing ??= this._maybeCreateLogGroup().then(() => this._maybeCreateLogStream())
    return this._initializing
  }

  private async _maybeCreateLogGroup(): Promise<void> {
    if (!this._options.createLogGroup) {
      return Promise.resolve()
    }
    const params = { logGroupName: this._logGroupName }
    try {
      await this._client.send(new CreateLogGroupCommand(params))
    } catch (err) {
      return await this._allowResourceAlreadyExistsException(err as AwsError)
    }
  }

  private async _maybeCreateLogStream(): Promise<void> {
    if (!this._options.createLogStream) {
      return Promise.resolve()
    }
    const params = {
      logGroupName: this._logGroupName,
      logStreamName: this._logStreamName,
    }
    try {
      await this._client.send(new CreateLogStreamCommand(params))
    } catch (err) {
      return await this._allowResourceAlreadyExistsException(err as AwsError)
    }
  }

  private _allowResourceAlreadyExistsException(err: AwsError): Promise<void> {
    return err.code === 'ResourceAlreadyExistsException' ? Promise.resolve() : Promise.reject(err)
  }

  private async _doSubmit(batch: LogItem[], retryCount: number): Promise<void> {
    try {
      await this._maybeUpdateSequenceToken()
      return await this._putLogEventsAndStoreSequenceToken(batch)
    } catch (err) {
      return await this._handlePutError(err as AwsError, batch, retryCount)
    }
  }

  private _maybeUpdateSequenceToken(): Promise<void> {
    if (this._sequenceToken != null) {
      return Promise.resolve()
    }
    return this._fetchAndStoreSequenceToken().then(() => undefined)
  }

  private _handlePutError(err: AwsError, batch: LogItem[], retryCount: number): Promise<void> {
    if (err.code !== 'InvalidSequenceTokenException') {
      return Promise.reject(err)
    }
    if (retryCount >= this._options.submissionRetryCount) {
      const error: AwsError & { code: string } = new Error(
        'Invalid sequence token, will retry'
      ) as AwsError & { code: string }
      error.code = 'InvalidSequenceTokenException'
      return Promise.reject(error)
    }
    this._sequenceToken = null
    return this._doSubmit(batch, retryCount + 1)
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
    return this._client.send(new PutLogEventsCommand(params))
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

  private async _findLogStream(
    nextToken?: DescribeLogStreamsCommandOutput['nextToken']
  ): Promise<LogStream> {
    debug('findLogStream', { nextToken })
    const params = {
      logGroupName: this._logGroupName,
      logStreamNamePrefix: this._logStreamName,
      nextToken,
    }
    const res = await this._client.send(new DescribeLogStreamsCommand(params))
    const { logStreams = [], nextToken: nt } = res
    const match = logStreams.find(ls => ls.logStreamName === this._logStreamName)
    if (match) return match
    if (nt == null) throw new Error('Log stream not found')
    return this._findLogStream(nt)
  }
}
