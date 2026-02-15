import { describe, it, expect, jest, afterEach } from '@jest/globals'
import sinon from 'sinon'

// Mock the heavy AWS SDK module to prevent OOM in Jest workers.
// All send() calls are stubbed by sinon in each test, so the real SDK is never invoked.
jest.mock('@aws-sdk/client-cloudwatch-logs', () => {
  class CloudWatchLogsClient {
    send() {
      /* stubbed by sinon in tests */
    }
    destroy() {}
  }
  class CreateLogGroupCommand {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input)
    }
  }
  class CreateLogStreamCommand {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input)
    }
  }
  class PutLogEventsCommand {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input)
    }
  }
  return {
    CloudWatchLogsClient,
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    PutLogEventsCommand,
  }
})

import CloudWatchClient, { type CloudWatchClientOptions } from '../../src/CloudWatchClient'
import { type LogItem } from '../../src/LogItem'

const logGroupName = 'testGroup'
const logStreamName = 'testStream'

const createErrorWithCode = (code: string): Error => {
  const error = new Error('Whoopsie daisies')
  error.name = code
  return error
}

interface CommandWithName {
  constructor: { name: string }
}

interface CreateClientOptions {
  clientOptions?: Partial<CloudWatchClientOptions> | null
  groupErrorCode?: string | null
  streamErrorCode?: string | null
  putRejectionCode?: string | null
}

const createClient = (options?: CreateClientOptions) => {
  const opts: Required<CreateClientOptions> = {
    clientOptions: null,
    groupErrorCode: null,
    streamErrorCode: null,
    putRejectionCode: null,
    ...options,
  }

  const client = new CloudWatchClient(logGroupName, logStreamName, opts.clientOptions ?? undefined)

  let putPromise: Promise<Record<string, unknown>>
  if (opts.putRejectionCode != null) {
    const err = createErrorWithCode(opts.putRejectionCode)
    putPromise = Promise.reject(err)
  } else {
    putPromise = Promise.resolve({})
  }

  const sendStub = sinon
    .stub((client as unknown as Record<string, unknown>).client as Record<string, unknown>, 'send')
    .callsFake((command: CommandWithName) => {
      if (command.constructor.name === 'PutLogEventsCommand') {
        return putPromise
      } else if (command.constructor.name === 'CreateLogGroupCommand') {
        return opts.groupErrorCode
          ? Promise.reject(createErrorWithCode(opts.groupErrorCode))
          : Promise.resolve()
      } else if (command.constructor.name === 'CreateLogStreamCommand') {
        return opts.streamErrorCode
          ? Promise.reject(createErrorWithCode(opts.streamErrorCode))
          : Promise.resolve()
      }
      throw new Error(`Unexpected command: ${String(command.constructor.name)}`)
    })

  return { client, sendStub }
}

const createBatch = (size: number): LogItem[] =>
  Array.from({ length: size }, () => ({
    date: +new Date(),
    level: 'info',
    message: 'Test',
    meta: { foo: 'bar' },
    callback: () => undefined,
  }))

describe('CloudWatchClient', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('constructor validation', () => {
    it('throws if logGroupName is empty', () => {
      expect(() => new CloudWatchClient('', logStreamName)).toThrow(
        'logGroupName must be between 1 and 512 characters'
      )
    })

    it('throws if logStreamName is empty', () => {
      expect(() => new CloudWatchClient(logGroupName, '')).toThrow(
        'logStreamName must be between 1 and 512 characters'
      )
    })

    it('throws if logGroupName exceeds 512 characters', () => {
      expect(() => new CloudWatchClient('a'.repeat(513), logStreamName)).toThrow(
        'logGroupName must be between 1 and 512 characters'
      )
    })

    it('throws if logStreamName exceeds 512 characters', () => {
      expect(() => new CloudWatchClient(logGroupName, 'a'.repeat(513))).toThrow(
        'logStreamName must be between 1 and 512 characters'
      )
    })

    it('reports both errors when logGroupName and logStreamName are invalid', () => {
      expect(() => new CloudWatchClient('', '')).toThrow(
        'Invalid CloudWatchClient configuration:\n' +
          '- logGroupName must be between 1 and 512 characters\n' +
          '- logStreamName must be between 1 and 512 characters'
      )
    })

    it('throws if timeout is zero', () => {
      expect(() => new CloudWatchClient(logGroupName, logStreamName, { timeout: 0 })).toThrow(
        'timeout must be a finite number greater than 0'
      )
    })

    it('throws if timeout is negative', () => {
      expect(() => new CloudWatchClient(logGroupName, logStreamName, { timeout: -1 })).toThrow(
        'timeout must be a finite number greater than 0'
      )
    })

    it('throws if timeout is NaN', () => {
      expect(() => new CloudWatchClient(logGroupName, logStreamName, { timeout: NaN })).toThrow(
        'timeout must be a finite number greater than 0'
      )
    })

    it('throws if timeout is Infinity', () => {
      expect(
        () => new CloudWatchClient(logGroupName, logStreamName, { timeout: Infinity })
      ).toThrow('timeout must be a finite number greater than 0')
    })
  })

  describe('submit()', () => {
    it('calls putLogEvents', async () => {
      const { client, sendStub } = createClient()
      const batch = createBatch(1)
      await client.submit(batch)
      // Just PutLogEvents (no more DescribeLogStreams)
      expect(sendStub.callCount).toBe(1)
    })

    it('rejects on PutLogEvents errors', async () => {
      const { client } = createClient({
        putRejectionCode: 'ThrottlingException',
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow('Whoopsie daisies')
    })

    it('retries initialization after transient failure', async () => {
      let callCount = 0
      const client = new CloudWatchClient(logGroupName, logStreamName, {
        createLogGroup: true,
      })
      const sendStub = sinon
        .stub(
          (client as unknown as Record<string, unknown>).client as Record<string, unknown>,
          'send'
        )
        .callsFake((command: CommandWithName) => {
          if (command.constructor.name === 'CreateLogGroupCommand') {
            callCount++
            if (callCount === 1) {
              return Promise.reject(new Error('Transient failure'))
            }
            return Promise.resolve()
          } else if (command.constructor.name === 'PutLogEventsCommand') {
            return Promise.resolve({})
          }
          throw new Error(`Unexpected: ${String(command.constructor.name)}`)
        })

      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow('Transient failure')
      // Second attempt should succeed since initializing was reset
      await expect(client.submit(batch)).resolves.not.toThrow()
      // CreateLogGroup(fail) + CreateLogGroup(ok) + PutLogEvents
      expect(sendStub.callCount).toBeGreaterThanOrEqual(3)
    })
  })

  describe('options.formatLog', () => {
    it('uses the custom formatter', async () => {
      const formatLog = sinon.spy((item: LogItem) => {
        return `CUSTOM__${JSON.stringify(item)}`
      })
      const { client } = createClient({
        clientOptions: { formatLog },
      })
      const batch = createBatch(1)
      await client.submit(batch)
      expect(formatLog.calledOnce).toBe(true)
    })
  })

  describe('options.formatLogItem', () => {
    it('uses the custom formatter', async () => {
      const formatLogItem = sinon.spy((item: LogItem) => {
        return {
          timestamp: item.date,
          message: `CUSTOM__${JSON.stringify(item)}`,
        }
      })
      const { client } = createClient({
        clientOptions: { formatLogItem },
      })
      const batch = createBatch(1)
      await client.submit(batch)
      expect(formatLogItem.calledOnce).toBe(true)
    })

    it('does not use the custom formatter if formatLog is specified', async () => {
      const formatLog = sinon.spy((item: LogItem) => {
        return `CUSTOM__${JSON.stringify(item)}`
      })
      const formatLogItem = sinon.spy((item: LogItem) => {
        return {
          timestamp: item.date,
          message: `CUSTOM__${JSON.stringify(item)}`,
        }
      })
      const { client } = createClient({
        clientOptions: { formatLog, formatLogItem },
      })
      const batch = createBatch(1)
      await client.submit(batch)
      expect(formatLogItem.calledOnce).toBe(false)
    })
  })

  describe('options.createLogGroup', () => {
    it('creates the log group', async () => {
      const { client, sendStub } = createClient({
        clientOptions: { createLogGroup: true },
      })
      const batch = createBatch(1)
      await client.submit(batch)
      // CreateLogGroup + PutLogEvents
      expect(sendStub.callCount).toBe(2)
    })

    it('does not throw if the log group already exists', async () => {
      const { client } = createClient({
        clientOptions: { createLogGroup: true },
        groupErrorCode: 'ResourceAlreadyExistsException',
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).resolves.not.toThrow()
    })

    it('throws if another error occurs', async () => {
      const { client } = createClient({
        clientOptions: { createLogGroup: true },
        groupErrorCode: 'UnicornDoesNotExistException',
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow()
    })
  })

  describe('options.createLogStream', () => {
    it('creates the log stream', async () => {
      const { client, sendStub } = createClient({
        clientOptions: { createLogStream: true },
      })
      const batch = createBatch(1)
      await client.submit(batch)
      // CreateLogStream + PutLogEvents
      expect(sendStub.callCount).toBe(2)
    })

    it('does not throw if the log stream already exists', async () => {
      const { client } = createClient({
        clientOptions: { createLogStream: true },
        streamErrorCode: 'ResourceAlreadyExistsException',
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).resolves.not.toThrow()
    })

    it('throws if another error occurs', async () => {
      const { client } = createClient({
        clientOptions: { createLogStream: true },
        streamErrorCode: 'UnicornDoesNotExistException',
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow()
    })
  })
})
