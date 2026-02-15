/** Type guard that narrows `unknown` to `Error`. */
export function isError(value: unknown): value is Error {
  return value instanceof Error
}
