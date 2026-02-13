import createDebug from 'debug'
import Bottleneck from 'bottleneck'
import Queue from './Queue'
import { EventEmitter } from 'events'

const debug = createDebug('winston-aws-cloudwatch:Relay')

export interface RelayOptions {
  submissionInterval: number
  batchSize: number
  maxQueueSize: number
}

export const DEFAULT_OPTIONS: RelayOptions = {
  submissionInterval: 2000,
  batchSize: 20,
  maxQueueSize: 10_000,
}

export type LogCallback = (err: unknown, ok?: boolean) => void

// Minimal shape Relay expects from queued items.
export interface RelayItem {
  callback: LogCallback
}

// Minimal shape of the client Relay talks to.
export interface RelayClient<T extends RelayItem> {
  submit(batch: T[]): Promise<void>
  destroy?(): void
}

export default class Relay<T extends RelayItem> extends EventEmitter {
  private readonly client: RelayClient<T>
  private readonly options: RelayOptions
  private limiter: Bottleneck | null
  private queue: Queue<T> | null
  private _submissionPending = false

  constructor(client: RelayClient<T>, options?: Partial<RelayOptions>) {
    super()
    debug('constructor', { client, options })
    this.client = client
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) }
    this.limiter = null
    this.queue = null
  }

  start(): void {
    debug('start')
    if (this.queue) throw new Error('Already started')
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: this.options.submissionInterval,
    })
    this.queue = new Queue<T>(this.options.maxQueueSize)
  }

  stop(): void {
    this.queue = null
    this._submissionPending = false
    void this.limiter?.stop({ dropWaitingJobs: true })
    this.limiter = null
    this.client.destroy?.()
  }

  submit(item: T): void {
    if (!this.queue) this.start()
    const dropped = this.queue!.push(item)
    if (dropped) {
      dropped.callback(new Error('Queue overflow: log item dropped'))
    }
    this.scheduleSubmission()
  }

  // Schedules a single Bottleneck job to drain the queue. The guard flag
  // prevents redundant jobs: only one drain job is active at a time.
  // After processing a batch, submitInternal() calls this again to continue
  // draining — an event-loop-mediated iteration bounded by the queue's maxSize.
  private scheduleSubmission(): void {
    if (this._submissionPending || !this.limiter || !this.queue) return
    this._submissionPending = true
    debug('scheduleSubmission')
    void this.limiter.schedule(() => this.submitInternal()).catch(err => {
      this._submissionPending = false
      if (this.queue) this.emit('error', err)
    })
  }

  private submitInternal(): Promise<void> {
    this._submissionPending = false
    if (!this.queue || this.queue.size === 0) {
      debug('submit: queue empty')
      return Promise.resolve()
    }

    const batch = this.queue.head(this.options.batchSize)
    debug(`submit: submitting ${batch.length} item(s)`)

    return this.client
      .submit(batch)
      .then(
        () => this.onSubmitted(batch),
        (err: Error) => this.onError(err, batch)
      )
      .then(() => this.scheduleSubmission())
  }

  private onSubmitted(batch: T[]): void {
    debug('onSubmitted', { batch })
    if (!this.queue) return
    this.queue.remove(batch.length)
    for (const item of batch) {
      item.callback(null, true)
    }
  }

  private onError(err: Error, batch: T[]): void {
    debug('onError', { error: err })
    if (!this.queue) return
    if (err.name === 'DataAlreadyAcceptedException') {
      // Assume the request got replayed and remove the batch
      this.queue.remove(batch.length)
    } else if (err.name === 'InvalidSequenceTokenException') {
      // Keep retrying: do nothing; the next scheduled submission will retry
    } else {
      this.emit('error', err)
    }
  }
}
