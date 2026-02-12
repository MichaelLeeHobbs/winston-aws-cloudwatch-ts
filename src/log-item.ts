export type LogCallback = (err: unknown, ok?: boolean) => void

export default class LogItem {
  private readonly _date: number
  private readonly _level: string
  private readonly _message: string
  private readonly _meta: Record<string, unknown> | undefined
  private readonly _callback: LogCallback

  constructor(
    date: number,
    level: string,
    message: string,
    meta: Record<string, unknown> | undefined,
    callback: LogCallback
  ) {
    this._date = date
    this._level = level
    this._message = message
    this._meta = meta
    this._callback = callback
  }

  get date(): number {
    return this._date
  }

  get level(): string {
    return this._level
  }

  get message(): string {
    return this._message
  }

  get meta(): Record<string, unknown> | undefined {
    return this._meta
  }

  get callback(): LogCallback {
    return this._callback
  }
}
