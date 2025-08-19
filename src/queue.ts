import createDebug from 'debug'

const debug = createDebug('winston-aws-cloudwatch:Queue')

export default class Queue<T> {
  private readonly _contents: T[] = []

  get size (): number {
    return this._contents.length
  }

  push (item: T): void {
    debug('push', { item })
    this._contents.push(item)
  }

  head (num: number): T[] {
    debug('head', { num })
    return this._contents.slice(0, num)
  }

  remove (num: number): void {
    debug('remove', { num })
    this._contents.splice(0, num)
  }
}
