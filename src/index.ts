import type { TransportStreamOptions } from 'winston-transport'
import Transport from 'winston-transport'
import CloudWatchClient from './cloudwatch-client'
import LogItem, {type LogCallback} from './log-item'
import Relay from './relay'

export interface CloudWatchTransportOptions extends TransportStreamOptions {
  // Required
  logGroupName: string
  logStreamName: string

  // CloudWatchClient options
  awsConfig?: unknown
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
  private _relay: Relay

  constructor(options: CloudWatchTransportOptions) {
    super(options)

    const client = new CloudWatchClient(
      options.logGroupName,
      options.logStreamName,
      options as unknown as Record<string, unknown>
    )

    this._relay = new Relay(client, options as unknown as Record<string, unknown>)
    this._relay.on('error', (err: Error) => this.emit('error', err))
    this._relay.start()
  }

  // winston-transport expects: log(info, next)
  // Our implementation forwards to Relay and invokes the item's callback later.
  log(info: Record<string, unknown>, callback: LogCallback): void {
    const level = String(info.level ?? '')
    const msg = String(info.message ?? '')

    // Copy all fields except level/message as metadata
    const {level: _level, message: _message, ...rest} = info
    const meta = {...rest} as Record<string, unknown>

    this._relay.submit(new LogItem(Date.now(), level, msg, meta, callback))
  }
}
