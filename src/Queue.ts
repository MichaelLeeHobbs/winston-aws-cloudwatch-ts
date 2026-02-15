import createDebug from 'debug'

const debug = createDebug('winston-aws-cloudwatch:Queue')

/** Simple bounded FIFO queue. When full, the oldest item is dropped on push. */
export default class Queue<T> {
  private readonly contents: T[] = []
  private readonly maxSize: number

  /** @param maxSize Maximum number of items. Values ≤ 0 disable the limit. */
  constructor(maxSize = 0) {
    this.maxSize = maxSize
  }

  /** Current number of items in the queue. */
  get size(): number {
    return this.contents.length
  }

  /** Adds an item. Returns the dropped item if the queue was full, otherwise `undefined`. */
  push(item: T): T | undefined {
    debug('push', { size: this.contents.length + 1 })
    this.contents.push(item)
    if (this.maxSize > 0 && this.contents.length > this.maxSize) {
      return this.contents.shift()
    }
    return undefined
  }

  /** Returns the first `num` items without removing them. */
  head(num: number): T[] {
    debug('head', { num })
    return this.contents.slice(0, num)
  }

  /** Removes the first `num` items from the queue. */
  remove(num: number): void {
    debug('remove', { num })
    this.contents.splice(0, num)
  }
}
