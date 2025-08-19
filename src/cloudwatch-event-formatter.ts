import LogItem from './log-item'

export interface CloudWatchEventFormatterOptions {
  formatLog?: (item: LogItem) => string
  formatLogItem?: (item: LogItem) => { message: string; timestamp: number }
}

// Local minimal isEmpty for our metadata needs
function isEmpty (value: unknown): boolean {
  if (value == null) return true // null or undefined
  if (Array.isArray(value)) return value.length === 0
  if (value instanceof Map || value instanceof Set) return value.size === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

export default class CloudWatchEventFormatter {
  // Allow runtime swap-in of custom formatters via constructor
  constructor ({ formatLog, formatLogItem }: CloudWatchEventFormatterOptions = {}) {
    if (typeof formatLog === 'function') {
      this.formatLog = formatLog
    } else if (typeof formatLogItem === 'function') {
      this.formatLogItem = formatLogItem
    }
  }

  formatLogItem (item: LogItem): { message: string; timestamp: number } {
    return {
      message: this.formatLog(item),
      timestamp: item.date
    }
  }

  formatLog (item: LogItem): string {
    const meta = isEmpty(item.meta) ? '' : ' ' + JSON.stringify(item.meta, null, 2)
    return `[${item.level.toUpperCase()}] ${item.message}${meta}`
  }
}
