import type LogItem from './LogItem'

export interface CloudWatchEventFormatterOptions {
  formatLog?: (item: LogItem) => string
  formatLogItem?: (item: LogItem) => { message: string; timestamp: number }
}

export default class CloudWatchEventFormatter {
  // Allow runtime swap-in of custom formatters via constructor
  constructor({ formatLog, formatLogItem }: CloudWatchEventFormatterOptions = {}) {
    if (typeof formatLog === 'function') {
      this.formatLog = formatLog
    } else if (typeof formatLogItem === 'function') {
      this.formatLogItem = formatLogItem
    }
  }

  formatLogItem(item: LogItem): { message: string; timestamp: number } {
    return {
      message: this.formatLog(item),
      timestamp: item.date,
    }
  }

  formatLog(item: LogItem): string {
    const level = item.level.toUpperCase()
    const message = item.message
    const meta = item.meta
    const metaString =
      meta !== undefined && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta, null, 2)}` : ''
    return `[${level}] ${message}${metaString}`
  }
}
