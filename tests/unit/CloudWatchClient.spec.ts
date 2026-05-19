import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  PutRetentionPolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { mockClient } from 'aws-sdk-client-mock'

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

// aws-sdk-client-mock intercepts every CloudWatchLogsClient#send (real SDK,
// no network) — the AWS-recommended approach for mocking modular SDK v3.
const cwMock = mockClient(CloudWatchLogsClient)

interface CreateClientOptions {
  clientOptions?: Partial<CloudWatchClientOptions> | null
  groupErrorCode?: string | null
  streamErrorCode?: string | null
  putRejectionCode?: string | null
  retentionErrorCode?: string | null
}

const createClient = (options?: CreateClientOptions): { client: CloudWatchClient } => {
  const opts: Required<CreateClientOptions> = {
    clientOptions: null,
    groupErrorCode: null,
    streamErrorCode: null,
    putRejectionCode: null,
    retentionErrorCode: null,
    ...options,
  }

  if (opts.putRejectionCode != null) {
    cwMock.on(PutLogEventsCommand).rejects(createErrorWithCode(opts.putRejectionCode))
  } else {
    cwMock.on(PutLogEventsCommand).resolves({})
  }
  cwMock
    .on(CreateLogGroupCommand)
    [
      opts.groupErrorCode != null ? 'rejects' : 'resolves'
    ](opts.groupErrorCode != null ? createErrorWithCode(opts.groupErrorCode) : {})
  cwMock
    .on(CreateLogStreamCommand)
    [
      opts.streamErrorCode != null ? 'rejects' : 'resolves'
    ](opts.streamErrorCode != null ? createErrorWithCode(opts.streamErrorCode) : {})
  cwMock
    .on(PutRetentionPolicyCommand)
    [
      opts.retentionErrorCode != null ? 'rejects' : 'resolves'
    ](opts.retentionErrorCode != null ? createErrorWithCode(opts.retentionErrorCode) : {})

  const client = new CloudWatchClient(logGroupName, logStreamName, opts.clientOptions ?? undefined)
  return { client }
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
  beforeEach(() => {
    cwMock.reset()
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
      const { client } = createClient()
      await client.submit(createBatch(1))
      expect(cwMock.commandCalls(PutLogEventsCommand)).toHaveLength(1)
      expect(cwMock.calls()).toHaveLength(1)
    })

    it('rejects on PutLogEvents errors', async () => {
      const { client } = createClient({ putRejectionCode: 'ThrottlingException' })
      await expect(client.submit(createBatch(1))).rejects.toThrow('Whoopsie daisies')
    })

    it('retries initialization after transient failure', async () => {
      cwMock.on(CreateLogGroupCommand).rejectsOnce(new Error('Transient failure')).resolves({})
      cwMock.on(PutLogEventsCommand).resolves({})

      const client = new CloudWatchClient(logGroupName, logStreamName, {
        createLogGroup: true,
      })
      const batch = createBatch(1)
      await expect(client.submit(batch)).rejects.toThrow('Transient failure')
      // Second attempt should succeed since `initializing` was reset.
      await expect(client.submit(batch)).resolves.not.toThrow()
      // CreateLogGroup(fail) + CreateLogGroup(ok) + PutLogEvents
      expect(cwMock.calls().length).toBeGreaterThanOrEqual(3)
      expect(cwMock.commandCalls(CreateLogGroupCommand).length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('chronological sorting', () => {
    it('sorts log events by timestamp before sending', async () => {
      const { client } = createClient()
      const batch: LogItem[] = [
        { date: 3000, level: 'info', message: 'third', callback: () => undefined },
        { date: 1000, level: 'info', message: 'first', callback: () => undefined },
        { date: 2000, level: 'info', message: 'second', callback: () => undefined },
      ]
      await client.submit(batch)
      const command = cwMock.commandCalls(PutLogEventsCommand)[0]!.args[0]
      const logEvents = command.input.logEvents ?? []
      expect(logEvents.map(e => e.timestamp)).toEqual([1000, 2000, 3000])
    })
  })

  describe('options.formatLog', () => {
    it('uses the custom formatter', async () => {
      const formatLog = jest.fn((item: LogItem) => `CUSTOM__${JSON.stringify(item)}`)
      const { client } = createClient({ clientOptions: { formatLog } })
      await client.submit(createBatch(1))
      expect(formatLog).toHaveBeenCalledTimes(1)
    })
  })

  describe('options.formatLogItem', () => {
    it('uses the custom formatter', async () => {
      const formatLogItem = jest.fn((item: LogItem) => ({
        timestamp: item.date,
        message: `CUSTOM__${JSON.stringify(item)}`,
      }))
      const { client } = createClient({ clientOptions: { formatLogItem } })
      await client.submit(createBatch(1))
      expect(formatLogItem).toHaveBeenCalledTimes(1)
    })

    it('does not use the custom formatter if formatLog is specified', async () => {
      const formatLog = jest.fn((item: LogItem) => `CUSTOM__${JSON.stringify(item)}`)
      const formatLogItem = jest.fn((item: LogItem) => ({
        timestamp: item.date,
        message: `CUSTOM__${JSON.stringify(item)}`,
      }))
      const { client } = createClient({ clientOptions: { formatLog, formatLogItem } })
      await client.submit(createBatch(1))
      expect(formatLogItem).not.toHaveBeenCalled()
    })
  })

  describe('options.createLogGroup', () => {
    it('creates the log group', async () => {
      const { client } = createClient({ clientOptions: { createLogGroup: true } })
      await client.submit(createBatch(1))
      // CreateLogGroup + PutLogEvents
      expect(cwMock.calls()).toHaveLength(2)
      expect(cwMock.commandCalls(CreateLogGroupCommand)).toHaveLength(1)
    })

    it('does not throw if the log group already exists', async () => {
      const { client } = createClient({
        clientOptions: { createLogGroup: true },
        groupErrorCode: 'ResourceAlreadyExistsException',
      })
      await expect(client.submit(createBatch(1))).resolves.not.toThrow()
    })

    it('throws if another error occurs', async () => {
      const { client } = createClient({
        clientOptions: { createLogGroup: true },
        groupErrorCode: 'UnicornDoesNotExistException',
      })
      await expect(client.submit(createBatch(1))).rejects.toThrow()
    })
  })

  describe('options.retentionInDays', () => {
    it('sends PutRetentionPolicyCommand when retentionInDays is set', async () => {
      const { client } = createClient({ clientOptions: { retentionInDays: 30 } })
      await client.submit(createBatch(1))
      expect(cwMock.commandCalls(PutRetentionPolicyCommand)).toHaveLength(1)
    })

    it('passes correct parameters to PutRetentionPolicyCommand', async () => {
      const { client } = createClient({ clientOptions: { retentionInDays: 90 } })
      await client.submit(createBatch(1))
      const command = cwMock.commandCalls(PutRetentionPolicyCommand)[0]!.args[0]
      expect(command.input.logGroupName).toBe(logGroupName)
      expect(command.input.retentionInDays).toBe(90)
    })

    it('skips PutRetentionPolicyCommand when retentionInDays is omitted', async () => {
      const { client } = createClient()
      await client.submit(createBatch(1))
      expect(cwMock.commandCalls(PutRetentionPolicyCommand)).toHaveLength(0)
    })

    it('works without createLogGroup', async () => {
      const { client } = createClient({ clientOptions: { retentionInDays: 7 } })
      await client.submit(createBatch(1))
      expect(cwMock.commandCalls(PutRetentionPolicyCommand)).toHaveLength(1)
      expect(cwMock.commandCalls(CreateLogGroupCommand)).toHaveLength(0)
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
      const injectedClient = {
        send: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
        destroy: jest.fn(),
      }
      const client = new CloudWatchClient(logGroupName, logStreamName, {
        cloudWatchLogs: injectedClient as never,
      })
      await client.submit(createBatch(1))
      expect(injectedClient.send).toHaveBeenCalledTimes(1)
      // The shared mock must not have been touched — a custom client was used.
      expect(cwMock.calls()).toHaveLength(0)
    })

    it('does not destroy the injected client', () => {
      const injectedClient = {
        send: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
        destroy: jest.fn(),
      }
      const client = new CloudWatchClient(logGroupName, logStreamName, {
        cloudWatchLogs: injectedClient as never,
      })
      client.destroy()
      expect(injectedClient.destroy).not.toHaveBeenCalled()
    })

    it('destroys internally created client', () => {
      const client = new CloudWatchClient(logGroupName, logStreamName)
      const internal = (client as unknown as { client: { destroy: () => void } }).client
      const destroySpy = jest.spyOn(internal, 'destroy').mockImplementation(() => undefined)
      client.destroy()
      expect(destroySpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('options.createLogStream', () => {
    it('creates the log stream', async () => {
      const { client } = createClient({ clientOptions: { createLogStream: true } })
      await client.submit(createBatch(1))
      // CreateLogStream + PutLogEvents
      expect(cwMock.calls()).toHaveLength(2)
      expect(cwMock.commandCalls(CreateLogStreamCommand)).toHaveLength(1)
    })

    it('does not throw if the log stream already exists', async () => {
      const { client } = createClient({
        clientOptions: { createLogStream: true },
        streamErrorCode: 'ResourceAlreadyExistsException',
      })
      await expect(client.submit(createBatch(1))).resolves.not.toThrow()
    })

    it('throws if another error occurs', async () => {
      const { client } = createClient({
        clientOptions: { createLogStream: true },
        streamErrorCode: 'UnicornDoesNotExistException',
      })
      await expect(client.submit(createBatch(1))).rejects.toThrow()
    })
  })

  describe('byte-based batch splitting', () => {
    it('sends a single batch when under the byte limit', async () => {
      const { client } = createClient()
      await client.submit(createBatch(5))
      expect(cwMock.commandCalls(PutLogEventsCommand)).toHaveLength(1)
    })

    it('splits into multiple calls when batch exceeds byte limit', async () => {
      const { client } = createClient()
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
      const putCalls = cwMock.commandCalls(PutLogEventsCommand)
      expect(putCalls.length).toBeGreaterThan(1)
      const totalEvents = putCalls.reduce(
        (sum, call) => sum + (call.args[0].input.logEvents?.length ?? 0),
        0
      )
      expect(totalEvents).toBe(15)
    })

    it('handles a single oversized event without error', async () => {
      const { client } = createClient()
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
      expect(cwMock.commandCalls(PutLogEventsCommand)).toHaveLength(1)
    })

    it('respects both count and byte limits', async () => {
      const { client } = createClient()
      // Each event ~50KB + overhead; 25 events ≈ 1.25 MB, should need 2 PutLogEvents calls
      const batch: LogItem[] = Array.from({ length: 25 }, (_, i) => ({
        date: i,
        level: 'info',
        message: 'y'.repeat(50_000),
        callback: () => undefined,
      }))
      await client.submit(batch)
      const putCalls = cwMock.commandCalls(PutLogEventsCommand)
      expect(putCalls.length).toBeGreaterThanOrEqual(2)
      for (const call of putCalls) {
        const events = call.args[0].input.logEvents ?? []
        const totalBytes = events.reduce(
          (sum, e) => sum + Buffer.byteLength(e.message ?? '', 'utf8') + EVENT_OVERHEAD_BYTES,
          0
        )
        // First event always added even if it exceeds, but the rest should stay under
        if (events.length > 1) {
          expect(totalBytes).toBeLessThanOrEqual(MAX_BATCH_BYTES)
        }
      }
    })
  })

  describe('options.timeout (abort signal)', () => {
    it('aborts the request when the configured timeout elapses', async () => {
      // Inject a client whose send() never resolves on its own — only the
      // abortSignal from CloudWatchClient can settle it. This exercises the
      // AbortSignal.timeout(options.timeout) wiring end-to-end.
      const observedSignals: AbortSignal[] = []
      const hangingClient = {
        send: (_cmd: unknown, opts: { abortSignal: AbortSignal }): Promise<never> =>
          new Promise((_, reject) => {
            observedSignals.push(opts.abortSignal)
            opts.abortSignal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            )
          }),
        destroy: () => undefined,
      }
      const client = new CloudWatchClient(logGroupName, logStreamName, {
        cloudWatchLogs: hangingClient as never,
        timeout: 50,
      })
      const start = Date.now()
      await expect(client.submit(createBatch(1))).rejects.toThrow('aborted')
      const elapsed = Date.now() - start
      // The signal must have fired roughly at the configured timeout.
      expect(elapsed).toBeGreaterThanOrEqual(40)
      expect(elapsed).toBeLessThan(1000)
      expect(observedSignals).toHaveLength(1)
      expect(observedSignals[0]!.aborted).toBe(true)
    })
  })

  describe('concurrent submit() during initialization', () => {
    it('shares a single CreateLogGroup across concurrent submits (??= memoization)', async () => {
      // Delay CreateLogGroup so both submits see the same in-flight init promise.
      cwMock.on(CreateLogGroupCommand).callsFake(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return {}
      })
      cwMock.on(PutLogEventsCommand).resolves({})

      const client = new CloudWatchClient(logGroupName, logStreamName, {
        createLogGroup: true,
      })
      await Promise.all([client.submit(createBatch(1)), client.submit(createBatch(1))])

      // Only one CreateLogGroup — both submits awaited the same `initializing`
      // promise rather than racing. Both submits succeeded → two PutLogEvents.
      expect(cwMock.commandCalls(CreateLogGroupCommand)).toHaveLength(1)
      expect(cwMock.commandCalls(PutLogEventsCommand)).toHaveLength(2)
    })

    it('re-runs initialization after a failed first attempt, then succeeds on the second submit (cached on success)', async () => {
      // Reject the first init, succeed thereafter. Two sequential submits:
      // attempt 1 throws + clears the cache; attempt 2 re-runs init and succeeds.
      // A third submit (concurrent with the second) shares the cached success.
      cwMock.on(CreateLogGroupCommand).rejectsOnce(new Error('Transient init failure')).resolves({})
      cwMock.on(PutLogEventsCommand).resolves({})

      const client = new CloudWatchClient(logGroupName, logStreamName, {
        createLogGroup: true,
      })
      await expect(client.submit(createBatch(1))).rejects.toThrow('Transient init failure')
      // After the failure, two concurrent submits must share the second init.
      await Promise.all([client.submit(createBatch(1)), client.submit(createBatch(1))])
      // CreateLogGroup: 1 failed + 1 succeeded = exactly 2 (NOT 3 — concurrent submits share)
      expect(cwMock.commandCalls(CreateLogGroupCommand)).toHaveLength(2)
      expect(cwMock.commandCalls(PutLogEventsCommand)).toHaveLength(2)
    })
  })
})
