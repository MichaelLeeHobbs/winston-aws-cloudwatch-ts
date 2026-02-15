import { type RelayClient, type RelayItem } from '../../src/Relay'

export class MockClient<T extends RelayItem> implements RelayClient<T> {
  private _submitted: T[] = []
  private _failures: string[]

  constructor(failures: string[] = []) {
    this._failures = [...failures]
  }

  async submit(batch: readonly T[]): Promise<void> {
    if (this._failures.length === 0) {
      this._submitted = this._submitted.concat(batch)
      return Promise.resolve()
    } else {
      const code = this._failures.shift()!
      const error = new Error(code)
      error.name = code
      return Promise.reject(error)
    }
  }

  get submitted(): T[] {
    return this._submitted
  }
}

export default MockClient
