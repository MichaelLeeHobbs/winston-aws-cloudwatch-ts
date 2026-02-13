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
  class DescribeLogStreamsCommand {
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
    DescribeLogStreamsCommand,
    PutLogEventsCommand,
  }
})

import CloudWatchClient, { type CloudWatchClientOptions } from '../../src/CloudWatchClient'
import LogItem from '../../src/LogItem'

const logGroupName = 'testGroup'
const logStreamName = 'testStream'

const createErrorWithCode = (code: string): Error & { code: string } => {
  const error = new Error('Whoopsie daisies') as Error & { code: string }
  error.code = code
  return error
}

const StreamsStrategy = {
  DEFAULT: 'default',
  NOT_FOUND: 'notFound',
  PAGED: 'paged',
  PAGED_NOT_FOUND: 'pagedNotFound',
} as const

type StreamsStrategy = (typeof StreamsStrategy)[keyof typeof StreamsStrategy]

interface CommandWithNextToken {
  nextToken?: string
  constructor: { name: string }
}

const createStreamsResponse = (option: StreamsStrategy, command: CommandWithNextToken) => {
  switch (option) {
    case StreamsStrategy.DEFAULT:
      return Promise.resolve({
        logStreams: [{ logStreamName }],
        nextToken: null,
      })
    case StreamsStrategy.PAGED:
      if (command.nextToken) {
        return Promise.resolve({
          logStreams: [{ logStreamName }],
          nextToken: null,
        })
      }
      return Promise.resolve({
        logStreams: [{ logStreamName: 'other-stream' }],
        nextToken: 'token2',
      })
    case StreamsStrategy.PAGED_NOT_FOUND:
      return Promise.reject(new Error('Log stream not found'))
    case StreamsStrategy.NOT_FOUND:
      return Promise.reject(new Error('Log stream not found'))
  }
}

interface CreateClientOptions {
  clientOptions?: Partial<CloudWatchClientOptions> | null
  streamsStrategy?: StreamsStrategy
  groupErrorCode?: string | null
  streamErrorCode?: string | null
  putRejectionCode?: string | null
}

interface PutLogEventsResponse {
  nextSequenceToken: string
}

const createClient = (options?: CreateClientOptions) => {
  const opts: Required<CreateClientOptions> = {
    clientOptions: null,
    streamsStrategy: StreamsStrategy.DEFAULT,
    groupErrorCode: null,
    streamErrorCode: null,
    putRejectionCode: null,
    ...options,
  }

  const client = new CloudWatchClient(logGroupName, logStreamName, opts.clientOptions ?? undefined)

  let putPromise: Promise<PutLogEventsResponse>
  if (opts.putRejectionCode != null) {
    const err = createErrorWithCode(opts.putRejectionCode)
    putPromise = Promise.reject(err)
  } else {
    putPromise = Promise.resolve({ nextSequenceToken: 'token42' })
  }

  const sendStub = sinon
    .stub((client as unknown as Record<string, unknown>)._client as Record<string, unknown>, 'send')
    .callsFake((command: CommandWithNextToken) => {
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
      } else if (command.constructor.name === 'DescribeLogStreamsCommand') {
        return createStreamsResponse(opts.streamsStrategy, command)
      }
      throw new Error(`Unexpected command: ${String(command.constructor.name)}`)
    })

  return { client, sendStub }
}

const createBatch = (size: number): LogItem[] => {
  const batch: LogItem[] = []
  for (let i = 0; i < size; ++i) {
    batch.push(new LogItem(+new Date(), 'info', 'Test', { foo: 'bar' }, () => undefined))
  }
  return batch
}

describe('CloudWatchClient', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('submit()', () => {
    it('calls putLogEvents', async () => {
      const { client, sendStub } = createClient()
      const batch = createBatch(1)
      await client.submit(batch)
      expect(sendStub.callCount).toBe(2)
    })

    it('handles log stream paging', async () => {
      const { client, sendStub } = createClient({
        streamsStrategy: StreamsStrategy.PAGED,
      })
      const batch = createBatch(1)
      await client.submit(batch)
      // DescribeLogStreams page1 + DescribeLogStreams page2 + PutLogEvents
      expect(sendStub.callCount).toBe(3)
    })

    it('rejects non-InvalidSequenceTokenException errors immediately', async () => {
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
          (client as unknown as Record<string, unknown>)._client as Record<string, unknown>,
          'send'
        )
        .callsFake((command: CommandWithNextToken) => {
          if (command.constructor.name === 'CreateLogGroupCommand') {
            callCount++
            if (callCount === 1) {
              return Promise.reject(new Error('Transient failure'))
            }
            return Promise.resolve()
          } else if (command.constructor.name === 'DescribeLogStreamsCommand') {
            return Promise.resolve({
              logStreams: [{ logStreamName }],
              nextToken: null,
            })
          } else if (command.constructor.name === 'PutLogEventsCommand') {
            return Promise.resolve({ nextSequenceToken: 'tok' })
          }
          throw new Error(`Unexpected: ${String(command.constructor.name)}`)
        })

      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow('Transient failure')
      // Second attempt should succeed since _initializing was reset
      await expect(client.submit(batch)).resolves.not.toThrow()
      expect(sendStub.callCount).toBeGreaterThanOrEqual(4)
    })

    it('rejects after retrying upon InvalidSequenceTokenException', async () => {
      const { client } = createClient({
        putRejectionCode: 'InvalidSequenceTokenException',
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow(
        'InvalidSequenceTokenException: retry limit exceeded'
      )
    })

    it('rejects if the log stream is not found in a single page', async () => {
      const { client } = createClient({
        streamsStrategy: StreamsStrategy.NOT_FOUND,
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow()
    })

    it('rejects if the log stream is not found in multiple pages', async () => {
      const { client } = createClient({
        streamsStrategy: StreamsStrategy.PAGED_NOT_FOUND,
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow()
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
      expect(sendStub.callCount).toBe(3)
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
      expect(sendStub.callCount).toBe(3)
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
