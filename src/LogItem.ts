/** Callback invoked when a log item has been processed or an error occurs. */
export type LogCallback = (err: unknown, ok?: boolean) => void

/** Immutable value object representing a single log entry in the pipeline. */
export interface LogItem {
  /** Timestamp in milliseconds since epoch. */
  readonly date: number
  /** Log level (e.g. `'info'`, `'error'`). */
  readonly level: string
  /** Log message text. */
  readonly message: string
  /** Optional metadata key-value pairs attached to the log entry. */
  readonly meta?: Readonly<Record<string, unknown>>
  /** Callback invoked after the item is submitted or dropped. */
  readonly callback: LogCallback
}
