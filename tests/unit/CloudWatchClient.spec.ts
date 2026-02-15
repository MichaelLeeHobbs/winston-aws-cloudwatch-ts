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
  class PutRetentionPolicyCommand {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input)
    }
  }
  return {
    CloudWatchLogsClient,
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    PutLogEventsCommand,
    PutRetentionPolicyCommand,
  }
})

import CloudWatchClient, {
  type CloudWatchClientOptions,
  MAX_BATCH_BYTES,
} from '../../src/CloudWatchClient'
import { EVENT_OVERHEAD_BYTES } from '../../src/CloudWatchEventFormatter'
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
  retentionErrorCode?: string | null
}

const createClient = (options?: CreateClientOptions) => {
  const opts: Required<CreateClientOptions> = {
    clientOptions: null,
    groupErrorCode: null,
    streamErrorCode: null,
    putRejectionCode: null,
    retentionErrorCode: null,
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
      } else if (command.constructor.name === 'PutRetentionPolicyCommand') {
        return opts.retentionErrorCode
          ? Promise.reject(createErrorWithCode(opts.retentionErrorCode))
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

  describe('chronological sorting', () => {
    it('sorts log events by timestamp before sending', async () => {
      const { client, sendStub } = createClient()
      const batch: LogItem[] = [
        { date: 3000, level: 'info', message: 'third', callback: () => undefined },
        { date: 1000, level: 'info', message: 'first', callback: () => undefined },
        { date: 2000, level: 'info', message: 'second', callback: () => undefined },
      ]
      await client.submit(batch)
      const putCall = sendStub.getCall(0)
      const command = putCall.args[0] as Record<string, unknown>
      const logEvents = command.logEvents as { timestamp: number; message: string }[]
      expect(logEvents.map(e => e.timestamp)).toEqual([1000, 2000, 3000])
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

  describe('options.retentionInDays', () => {
    it('sends PutRetentionPolicyCommand when retentionInDays is set', async () => {
      const { client, sendStub } = createClient({
        clientOptions: { retentionInDays: 30 },
      })
      const batch = createBatch(1)
      await client.submit(batch)
      const commands = sendStub.getCalls().map(c => (c.args[0] as CommandWithName).constructor.name)
      expect(commands).toContain('PutRetentionPolicyCommand')
    })

    it('passes correct parameters to PutRetentionPolicyCommand', async () => {
      const { client, sendStub } = createClient({
        clientOptions: { retentionInDays: 90 },
      })
      await client.submit(createBatch(1))
      const retentionCall = sendStub
        .getCalls()
        .find(c => (c.args[0] as CommandWithName).constructor.name === 'PutRetentionPolicyCommand')
      const command = retentionCall!.args[0] as Record<string, unknown>
      expect(command.logGroupName).toBe(logGroupName)
      expect(command.retentionInDays).toBe(90)
    })

    it('skips PutRetentionPolicyCommand when retentionInDays is omitted', async () => {
      const { client, sendStub } = createClient()
      await client.submit(createBatch(1))
      const commands = sendStub.getCalls().map(c => (c.args[0] as CommandWithName).constructor.name)
      expect(commands).not.toContain('PutRetentionPolicyCommand')
    })

    it('works without createLogGroup', async () => {
      const { client, sendStub } = createClient({
        clientOptions: { retentionInDays: 7 },
      })
      await client.submit(createBatch(1))
      const commands = sendStub.getCalls().map(c => (c.args[0] as CommandWithName).constructor.name)
      expect(commands).toContain('PutRetentionPolicyCommand')
      expect(commands).not.toContain('CreateLogGroupCommand')
    })

    it('propagates errors from PutRetentionPolicyCommand', async () => {
      const { client } = createClient({
        clientOptions: { retentionInDays: 14 },
        retentionErrorCode: 'OperationAbortedException',
      })
      await expect(client.submit(createBatch(1))).rejects.toThrow('Whoopsie daisies')
    })

    it('rejects invalid retentionInDays values', () => {
      expect(
        () =>
          new CloudWatchClient(logGroupName, logStreamName, {
            retentionInDays: 42 as never,
          })
      ).toThrow('retentionInDays must be one of:')
    })
  })

  describe('options.cloudWatchLogs (client injection)', () => {
    it('uses the injected client for API calls', async () => {
      const injectedClient = { send: sinon.stub().resolves({}), destroy: sinon.stub() }
      const client = new CloudWatchClient(logGroupName, logStreamName, {
        cloudWatchLogs: injectedClient as never,
      })
      await client.submit(createBatch(1))
      expect(injectedClient.send.callCount).toBe(1)
    })

    it('does not destroy the injected client', () => {
      const injectedClient = { send: sinon.stub().resolves({}), destroy: sinon.stub() }
      const client = new CloudWatchClient(logGroupName, logStreamName, {
        cloudWatchLogs: injectedClient as never,
      })
      client.destroy()
      expect(injectedClient.destroy.callCount).toBe(0)
    })

    it('destroys internally created client', () => {
      const client = new CloudWatchClient(logGroupName, logStreamName)
      const destroyStub = sinon.stub(
        (client as unknown as Record<string, unknown>).client as Record<string, unknown>,
        'destroy'
      )
      client.destroy()
      expect(destroyStub.callCount).toBe(1)
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

  describe('byte-based batch splitting', () => {
    it('sends a single batch when under the byte limit', async () => {
      const { client, sendStub } = createClient()
      await client.submit(createBatch(5))
      const putCalls = sendStub
        .getCalls()
        .filter(c => (c.args[0] as CommandWithName).constructor.name === 'PutLogEventsCommand')
      expect(putCalls).toHaveLength(1)
    })

    it('splits into multiple calls when batch exceeds byte limit', async () => {
      const { client, sendStub } = createClient()
      // Each message: ~100KB of payload + 26 bytes overhead ≈ 100KB per event
      // 15 events ≈ 1.5 MB > 1 MB limit → should split
      const messageSize = 100_000
      const batch: LogItem[] = Array.from({ length: 15 }, (_, i) => ({
        date: i,
        level: 'info',
        message: 'x'.repeat(messageSize),
        callback: () => undefined,
      }))
      await client.submit(batch)
      const putCalls = sendStub
        .getCalls()
        .filter(c => (c.args[0] as CommandWithName).constructor.name === 'PutLogEventsCommand')
      expect(putCalls.length).toBeGreaterThan(1)
      // Total events across all calls should equal original batch size
      const totalEvents = putCalls.reduce((sum, call) => {
        const cmd = call.args[0] as Record<string, unknown>
        return sum + (cmd.logEvents as unknown[]).length
      }, 0)
      expect(totalEvents).toBe(15)
    })

    it('handles a single oversized event without error', async () => {
      const { client, sendStub } = createClient()
      // Single event larger than MAX_BATCH_BYTES — still sent (batch starts empty)
      const batch: LogItem[] = [
        {
          date: 1,
          level: 'info',
          message: 'x'.repeat(MAX_BATCH_BYTES),
          callback: () => undefined,
        },
      ]
      await client.submit(batch)
      const putCalls = sendStub
        .getCalls()
        .filter(c => (c.args[0] as CommandWithName).constructor.name === 'PutLogEventsCommand')
      expect(putCalls).toHaveLength(1)
    })

    it('respects both count and byte limits', async () => {
      const { client, sendStub } = createClient()
      // Each event ~50KB + overhead; 25 events ≈ 1.25 MB, should need 2 PutLogEvents calls
      const batch: LogItem[] = Array.from({ length: 25 }, (_, i) => ({
        date: i,
        level: 'info',
        message: 'y'.repeat(50_000),
        callback: () => undefined,
      }))
      await client.submit(batch)
      const putCalls = sendStub
        .getCalls()
        .filter(c => (c.args[0] as CommandWithName).constructor.name === 'PutLogEventsCommand')
      expect(putCalls.length).toBeGreaterThanOrEqual(2)
      // Verify each sub-batch is within byte limit
      for (const call of putCalls) {
        const cmd = call.args[0] as Record<string, unknown>
        const events = cmd.logEvents as { message: string }[]
        const totalBytes = events.reduce(
          (sum, e) => sum + Buffer.byteLength(e.message, 'utf8') + EVENT_OVERHEAD_BYTES,
          0
        )
        // First event always added even if it exceeds, but the rest should stay under
        if (events.length > 1) {
          expect(totalBytes).toBeLessThanOrEqual(MAX_BATCH_BYTES)
        }
      }
    })
  })
})
