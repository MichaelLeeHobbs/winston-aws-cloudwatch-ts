import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutLogEventsCommand,
  type PutLogEventsCommandInput,
} from '@aws-sdk/client-cloudwatch-logs'
import { mockClient } from 'aws-sdk-client-mock'
import winston from 'winston'

import CloudWatchTransport from '../../src/CloudWatchTransport'

// Delivery failures must leave the real Winston pipe attached and draining.
// Direct transport.write() tests cannot detect logger detachment.

const cwMock = mockClient(CloudWatchLogsClient)

/** Bypass the default 10s close-flush for tests with a slow/failing mock. */
function stopRelay(transport: CloudWatchTransport): void {
  ;(transport as unknown as { relay: { stop: () => void } }).relay.stop()
}

describe('CloudWatchTransport end-to-end through a real winston.Logger', () => {
  let transport: CloudWatchTransport | undefined
  let logger: winston.Logger | undefined

  beforeEach(() => {
    cwMock.reset()
    cwMock.onAnyCommand().resolves({})
  })

  afterEach(async () => {
    if (transport) {
      stopRelay(transport)
      await transport.close()
      transport = undefined
    }
    logger?.close()
    logger = undefined
  })

  it('routes a real Logger call through to PutLogEventsCommand with message + metadata intact', async () => {
    transport = new CloudWatchTransport({
      logGroupName: 'g',
      logStreamName: 's',
      submissionInterval: 10,
    })
    logger = winston.createLogger({ level: 'info', transports: [transport] })

    logger.info('hello world', { userId: 1234, action: 'login' })
    await transport.flush(2000)

    const calls = cwMock.commandCalls(PutLogEventsCommand)
    expect(calls).toHaveLength(1)
    const events = calls[0]!.args[0].input.logEvents ?? []
    expect(events).toHaveLength(1)
    const message = events[0]!.message ?? ''
    // Default formatter is `[LEVEL] message {metadata}` — assert key substrings
    // so the test isn't brittle to formatter tweaks.
    expect(message).toContain('hello world')
    expect(message.toLowerCase()).toContain('info')
    expect(message).toContain('1234')
    expect(message).toContain('login')
  })

  it('logger.info() returns synchronously even when delivery is slow (decoupled-delivery contract)', () => {
    // Mock that NEVER resolves. If the write callback were coupled to delivery
    // (the pre-#9 behavior), the first log would stall the Writable and the
    // next 99 would block — this loop would not complete in <100ms.
    cwMock.reset()
    cwMock.on(PutLogEventsCommand).callsFake(() => new Promise(() => undefined))
    transport = new CloudWatchTransport({
      logGroupName: 'g',
      logStreamName: 's',
      submissionInterval: 5,
    })
    logger = winston.createLogger({ level: 'info', transports: [transport] })

    const start = Date.now()
    for (let i = 0; i < 100; i++) {
      logger.info('fast', { i })
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(100)
  })

  it.each(['CreateLogGroup', 'PutLogEvents'] as const)(
    'keeps logging after a %s failure and reports it as a warning',
    async failureStage => {
      const failure = Object.assign(new Error('request timed out'), { name: 'TimeoutError' })
      const delivered: string[] = []
      const accept = (input: PutLogEventsCommandInput): Record<string, never> => {
        for (const event of input.logEvents ?? []) delivered.push(event.message!)
        return {}
      }
      cwMock.on(PutLogEventsCommand).callsFake(accept)
      if (failureStage === 'CreateLogGroup') {
        cwMock.on(CreateLogGroupCommand).rejectsOnce(failure).resolves({})
      } else {
        cwMock.on(PutLogEventsCommand).rejectsOnce(failure).callsFake(accept)
      }
      transport = new CloudWatchTransport({
        logGroupName: 'g',
        logStreamName: 's',
        createLogGroup: true,
        submissionInterval: 1,
        retryBackoffCap: 0,
        formatLog: item => item.message,
      })
      const closeSpy = jest.fn()
      const unpipeSpy = jest.fn()
      const transportWarning = jest.fn()
      const loggerWarning = jest.fn()
      const loggerError = jest.fn()
      transport.on('close', closeSpy)
      transport.on('unpipe', unpipeSpy)
      transport.on('warn', transportWarning)
      logger = winston.createLogger({ transports: [transport] })
      logger.on('warn', loggerWarning)
      // Keep the old implementation's error observable while checking detachment.
      logger.on('error', loggerError)

      logger.info('startup')
      await transport.flush(2000)
      // Let an erroneous async close settle before checking continued delivery.
      await new Promise(resolve => setImmediate(resolve))
      expect(delivered).toEqual(['startup'])
      expect(logger.transports).toHaveLength(1)
      expect(logger.transports[0]).toBe(transport)

      const later = Array.from({ length: 50 }, (_, i) => `after recovery ${i}`)
      for (const message of later) logger.info(message)
      await transport.flush(2000)
      expect(delivered).toEqual(['startup', ...later])
      expect(logger.readableLength).toBe(0)
      expect(logger.writableLength).toBe(0)
      expect(logger.transports).toHaveLength(1)
      expect(logger.transports[0]).toBe(transport)
      expect(transportWarning.mock.calls).toEqual([[failure]])
      expect(loggerWarning.mock.calls).toEqual([[failure, transport]])
      expect(loggerError).not.toHaveBeenCalled()
      expect(closeSpy).not.toHaveBeenCalled()
      expect(unpipeSpy).not.toHaveBeenCalled()
    }
  )

  it('drops failed batches and keeps draining without error or warning listeners', async () => {
    cwMock.on(PutLogEventsCommand).rejects(new Error('CloudWatch unavailable'))
    transport = new CloudWatchTransport({
      logGroupName: 'g',
      logStreamName: 's',
      submissionInterval: 1,
      batchSize: 1,
      maxRetries: 2,
      retryBackoffCap: 0,
      formatLog: item => item.message,
    })
    logger = winston.createLogger({ transports: [transport] })

    for (const message of ['first', 'second']) {
      logger.info(message)
      await transport.flush(2000)
      await new Promise(resolve => setImmediate(resolve))
      expect(logger.transports).toHaveLength(1)
      expect(logger.transports[0]).toBe(transport)
      expect(logger.readableLength).toBe(0)
      expect(logger.writableLength).toBe(0)
    }
    const attempts = cwMock.commandCalls(PutLogEventsCommand)
    expect(attempts.map(call => call.args[0].input.logEvents?.[0]?.message)).toEqual([
      'first',
      'first',
      'second',
      'second',
    ])

    const closed = jest.fn()
    transport.on('close', closed)
    await transport.close()
    expect(closed).toHaveBeenCalled()
    expect(logger.transports).toHaveLength(0)
  })
})
