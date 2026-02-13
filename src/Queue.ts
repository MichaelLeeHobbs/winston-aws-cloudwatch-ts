import createDebug from 'debug'

const debug = createDebug('winston-aws-cloudwatch:Queue')

export default class Queue<T> {
  private readonly _contents: T[] = []
  private readonly _maxSize: number

  constructor(maxSize = 0) {
    this._maxSize = maxSize
  }

  get size(): number {
    return this._contents.length
  }

  push(item: T): T | undefined {
    debug('push', { item })
    this._contents.push(item)
    if (this._maxSize > 0 && this._contents.length > this._maxSize) {
      return this._contents.shift()
    }
    return undefined
  }

  head(num: number): T[] {
    debug('head', { num })
    return this._contents.slice(0, num)
  }

  remove(num: number): void {
    debug('remove', { num })
    this._contents.splice(0, num)
  }
}
