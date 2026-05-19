import createDebug from 'debug'
import { isError } from './typeGuards'
import Bottleneck from 'bottleneck'
import Queue from './Queue'
import { EventEmitter } from 'events'
import { type LogCallback } from './LogItem'

const debug = createDebug('winston-aws-cloudwatch:Relay')

/** Default timeout in milliseconds for {@link Relay.flush}. */
export const DEFAULT_FLUSH_TIMEOUT = 10_000

/** Configuration for {@link Relay} batching and throttling behavior. */
export interface RelayOptions {
  /** Minimum interval in milliseconds between batch submissions. Default: 2000. */
  readonly submissionInterval: number
  /** Maximum number of items per batch. Default: 20. */
  readonly batchSize: number
  /** Maximum queue size. When full, the oldest item is dropped. Default: 10000. */
  readonly maxQueueSize: number
  /**
   * Consecutive failed delivery attempts of the head batch before it is
   * dropped (its callbacks resolved as not-delivered, never as an Error).
   * Frees head-of-line blocking so newer logs can flow during a persistent
   * outage. Default: 10.
   */
  readonly maxRetries: number
  /**
   * Upper bound in milliseconds on the extra delay added between retry
   * attempts. The delay grows exponentially from {@link RelayOptions.submissionInterval}
   * and is capped at this value. Set to 0 to disable backoff. Default: 30000.
   */
  readonly retryBackoffCap: number
}

export const DEFAULT_OPTIONS: RelayOptions = {
  submissionInterval: 2000,
  batchSize: 20,
  maxQueueSize: 10_000,
  maxRetries: 10,
  retryBackoffCap: 30_000,
} as const satisfies RelayOptions

/** Minimal shape Relay expects from queued items. */
export interface RelayItem {
  /** Callback invoked when the item is submitted or an error occurs. */
  readonly callback: LogCallback
}

/** Client interface that Relay delegates batch submission to. */
export interface RelayClient<T extends RelayItem> {
  /** Submits a batch of items to the underlying service. */
  submit(batch: readonly T[]): Promise<void>
  /** Optional cleanup when the relay is stopped. */
  destroy?(): void
}

/**
 * Generic batching and throttling layer.
 *
 * Buffers items in a {@link Queue}, drains them in batches via a {@link RelayClient},
 * and rate-limits submissions using Bottleneck. Emits `'error'` events on
 * unrecoverable submission failures.
 */
export default class Relay<T extends RelayItem> extends EventEmitter {
  private readonly client: RelayClient<T>
  private readonly options: RelayOptions
  private limiter: Bottleneck | null
  private queue: Queue<T> | null
  private submissionPending = false
  private flushWaiters = new Set<() => void>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  // Consecutive failed delivery attempts of the current head batch. Reset on
  // success, on a recoverable drop, or when the batch is dropped after
  // exceeding maxRetries.
  private headBatchFailures = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(client: RelayClient<T>, options?: Partial<RelayOptions>) {
    super()
    debug('constructor', { options })
    this.client = client
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) }
    this.limiter = null
    this.queue = null
  }

  /** Initializes the rate limiter and queue. No-op if already started. */
  start(): void {
    debug('start')
    if (this.queue) return
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: this.options.submissionInterval,
    })
    this.queue = new Queue<T>(this.options.maxQueueSize)
  }

  /** Stops the relay, completes pending item callbacks, and destroys the client. */
  stop(): void {
    this.resolveFlush()
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.headBatchFailures = 0
    const pendingItems = this.queue ? this.queue.head(this.queue.size) : []
    this.queue = null
    this.submissionPending = false
    void this.limiter?.stop({ dropWaitingJobs: true })
    this.limiter = null
    this.client.destroy?.()

    if (pendingItems.length > 0) {
      debug(`stop: completing ${pendingItems.length} unsent item(s) without delivery`)
    }
    // Complete each unsent item's callback WITHOUT an Error. Passing an Error
    // to a Winston write callback makes the transport stream emit 'error',
    // which the Logger re-emits — crashing the host process if it has no
    // 'error' handler. Losing buffered logs on shutdown is best-effort, not a
    // fatal condition, so we report not-delivered (ok=false) instead.
    for (const item of pendingItems) {
      try {
        item.callback(null, false)
      } catch (err) {
        /* istanbul ignore next -- a throwing callback must not break shutdown */
        debug('stop: item callback threw', { error: err })
      }
    }
  }

  /** Enqueues an item for batch submission. Auto-starts the relay if not started. */
  submit(item: T): void {
    if (!this.queue) this.start()
    const dropped = this.queue!.push(item)
    if (dropped) {
      // Queue is full — the oldest item was evicted. Complete its callback
      // WITHOUT an Error (see stop() for why an Error here is fatal to the
      // host process) and report it as not-delivered (ok=false).
      debug('submit: queue overflow, oldest item dropped')
      try {
        dropped.callback(null, false)
      } catch (err) {
        /* istanbul ignore next -- a throwing callback must not break submit */
        debug('submit: dropped item callback threw', { error: err })
      }
    }
    this.scheduleSubmission()
  }

  /**
   * Returns a promise that resolves when the queue has been fully drained,
   * or when the timeout expires — whichever comes first.
   */
  flush(timeout = DEFAULT_FLUSH_TIMEOUT): Promise<void> {
    if (!this.queue || this.queue.size === 0) {
      return Promise.resolve()
    }
    this.scheduleSubmission()
    return new Promise<void>(resolve => {
      this.flushWaiters.add(resolve)
      // Only create one shared timer for the flush cycle
      if (!this.flushTimer) {
        this.flushTimer = globalThis.setTimeout(() => {
          this.resolveFlush()
        }, timeout)
        this.flushTimer.unref()
      }
    })
  }

  private resolveFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.flushWaiters.size > 0) {
      const waiters = [...this.flushWaiters]
      this.flushWaiters.clear()
      for (const resolve of waiters) {
        resolve()
      }
    }
  }

  // Schedules a single Bottleneck job to drain the queue. The guard flag
  // prevents redundant jobs: only one drain job is active at a time.
  // After processing a batch, submitInternal() calls this again to continue
  // draining — an event-loop-mediated iteration bounded by the queue's maxSize.
  private scheduleSubmission(): void {
    if (this.submissionPending || !this.limiter || !this.queue) return
    this.submissionPending = true
    debug('scheduleSubmission')
    void this.limiter
      .schedule(() => this.submitInternal())
      .catch(err => {
        this.submissionPending = false
        // Defensive: Bottleneck rejects scheduled jobs when stop({ dropWaitingJobs })
        // is called. By that point this.queue is already null, so the error is swallowed.
        /* istanbul ignore next */
        if (this.queue) this.emit('error', err)
      })
  }

  // Runs inside a Bottleneck job. Sends one batch to the client, handles the
  // result, then re-schedules to drain any remaining items.
  private async submitInternal(): Promise<void> {
    this.submissionPending = false
    // Defensive guard: queue may be null (stop() called while job was scheduled)
    // or empty (drained by a prior batch before this job fires).
    /* istanbul ignore next */
    if (!this.queue || this.queue.size === 0) {
      debug('submit: queue empty')
      return
    }

    const batch = this.queue.head(this.options.batchSize)
    debug(`submit: submitting ${batch.length} item(s)`)

    try {
      await this.client.submit(batch)
      this.onSubmitted(batch)
    } catch (err) {
      this.onError(err, batch)
    }

    // Continue draining if items remain, otherwise resolve any pending flush.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- queue may become null if stop() is called during the await
    if (this.queue && this.queue.size > 0) {
      this.scheduleNextSubmission()
    } else {
      this.resolveFlush()
    }
  }

  // Schedules the next drain. After a failed head batch, an exponentially
  // growing delay (capped by retryBackoffCap) is inserted before the next
  // attempt — on top of Bottleneck's minTime — to throttle retry and 'error'
  // volume during a persistent outage. The first failure retries promptly
  // (Bottleneck minTime only); each subsequent failure backs off further.
  private scheduleNextSubmission(): void {
    const extra =
      this.headBatchFailures > 0
        ? Math.min(
            this.options.submissionInterval * (2 ** (this.headBatchFailures - 1) - 1),
            this.options.retryBackoffCap
          )
        : 0
    if (extra <= 0) {
      this.scheduleSubmission()
      return
    }
    /* istanbul ignore next -- defensive: only one drain job is in flight, so retryTimer is always null here */
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = globalThis.setTimeout(() => {
      this.retryTimer = null
      this.scheduleSubmission()
    }, extra)
    this.retryTimer.unref()
  }

  private onSubmitted(batch: readonly T[]): void {
    debug('onSubmitted', { batchSize: batch.length })
    if (!this.queue) return
    this.queue.remove(batch.length)
    this.headBatchFailures = 0
    // Notify Winston that each item was successfully delivered.
    for (const item of batch) {
      item.callback(null, true)
    }
  }

  // Handles a failed client.submit(). Some AWS errors are recoverable:
  // the batch is either silently dropped or left in the queue for retry.
  // Anything else is surfaced as an 'error' event on the Relay.
  private onError(err: unknown, batch: readonly T[]): void {
    debug('onError', { error: err })
    if (!this.queue) return
    /* istanbul ignore next -- defensive: non-Error throws are not expected */
    const name = isError(err) ? err.name : ''
    if (name === 'DataAlreadyAcceptedException') {
      // AWS already accepted these events (duplicate request) — safe to discard.
      this.queue.remove(batch.length)
      this.headBatchFailures = 0
    } else if (name === 'InvalidSequenceTokenException') {
      // Sequence token is stale — leave the batch in the queue so the next
      // scheduled submission retries it automatically. This is a normally
      // recoverable handshake, so it deliberately does NOT count toward
      // maxRetries (no headBatchFailures change).
    } else {
      // Unrecoverable error — surface to the transport's error listeners.
      this.headBatchFailures += 1
      this.emit('error', err)
      if (this.headBatchFailures >= this.options.maxRetries) {
        // The head batch has failed maxRetries times in a row. Drop it so
        // newer queued logs are no longer head-of-line blocked behind an
        // undeliverable batch. Complete each callback WITHOUT an Error (see
        // stop()/submit() for why an Error here can crash the host) and
        // report not-delivered (ok=false).
        debug(
          `onError: dropping head batch of ${batch.length} after ${this.headBatchFailures} attempt(s)`
        )
        this.queue.remove(batch.length)
        this.headBatchFailures = 0
        for (const item of batch) {
          try {
            item.callback(null, false)
          } catch (cbErr) {
            /* istanbul ignore next -- a throwing callback must not break the relay */
            debug('onError: dropped item callback threw', { error: cbErr })
          }
        }
      }
    }
  }
}
