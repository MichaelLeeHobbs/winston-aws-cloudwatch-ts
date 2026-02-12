import type { TransportStreamOptions } from 'winston-transport'
import Transport from 'winston-transport'
import CloudWatchClient, { type CloudWatchClientOptions } from './cloudwatch-client'
import type { CloudWatchLogsClientConfig } from '@aws-sdk/client-cloudwatch-logs'
import LogItem, { type LogCallback } from './log-item'
import Relay, { type RelayClient, type RelayOptions } from './relay'

export interface CloudWatchTransportOptions extends TransportStreamOptions {
  // Required
  logGroupName: string
  logStreamName: string

  // CloudWatchClient options
  awsConfig?: CloudWatchLogsClientConfig
  formatLog?: (item: LogItem) => string
  formatLogItem?: (item: LogItem) => { message: string; timestamp: number }
  createLogGroup?: boolean
  createLogStream?: boolean
  submissionRetryCount?: number

  // Relay options
  submissionInterval?: number
  batchSize?: number
}

export default class CloudWatchTransport extends Transport {
  private _relay: Relay<LogItem>

  constructor(options: CloudWatchTransportOptions) {
    super(options)

    const clientOptions: Partial<CloudWatchClientOptions> = {
      awsConfig: options.awsConfig,
      formatLog: options.formatLog,
      formatLogItem: options.formatLogItem,
      createLogGroup: options.createLogGroup,
      createLogStream: options.createLogStream,
      submissionRetryCount: options.submissionRetryCount,
    }

    const client: RelayClient<LogItem> = new CloudWatchClient(
      options.logGroupName,
      options.logStreamName,
      clientOptions
    )

    const relayOptions: Partial<RelayOptions> = {
      submissionInterval: options.submissionInterval,
      batchSize: options.batchSize,
    }

    this._relay = new Relay<LogItem>(client, relayOptions)
    this._relay.on('error', (err: Error) => this.emit('error', err))
    this._relay.start()
  }

  // winston-transport expects: log(info, next)
  log(info: Record<string, unknown>, callback: LogCallback): void {
    const level = typeof info.level === 'string' ? info.level : ''
    const msg = typeof info.message === 'string' ? info.message : ''

    // Copy all fields except level/message as metadata
    const { level: _level, message: _message, ...rest } = info
    const meta = { ...rest } as Record<string, unknown>

    this._relay.submit(new LogItem(Date.now(), level, msg, meta, callback))
  }
}
