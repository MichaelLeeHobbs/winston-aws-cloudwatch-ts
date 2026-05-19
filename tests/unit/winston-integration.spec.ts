import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { CloudWatchLogsClient, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { mockClient } from 'aws-sdk-client-mock'
import winston from 'winston'

import CloudWatchTransport from '../../src/CloudWatchTransport'

// End-to-end behavioral tests through a real `winston.createLogger` (not just
// raw `transport.write()` / `transport.log()`). Closes the "behavioral gap
// despite 100% line coverage" finding from the deep review: nothing else in
// the suite exercises the winston-transport → winston-Logger plumbing.

const cwMock = mockClient(CloudWatchLogsClient)

/** Bypass the default 10s close-flush for tests with a slow/failing mock. */
function stopRelay(transport: CloudWatchTransport): void {
  ;(transport as unknown as { relay: { stop: () => void } }).relay.stop()
}

const waitUntil = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('CloudWatchTransport end-to-end through a real winston.Logger', () => {
  let transport: CloudWatchTransport | undefined

  beforeEach(() => {
    cwMock.reset()
    cwMock.onAnyCommand().resolves({})
  })

  afterEach(() => {
    if (transport) {
      stopRelay(transport)
      transport = undefined
    }
  })

  it('routes a real Logger call through to PutLogEventsCommand with message + metadata intact', async () => {
    transport = new CloudWatchTransport({
      logGroupName: 'g',
      logStreamName: 's',
      submissionInterval: 10,
    })
    transport.on('error', () => {})
    const logger = winston.createLogger({ level: 'info', transports: [transport] })

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
    transport.on('error', () => {})
    const logger = winston.createLogger({ level: 'info', transports: [transport] })

    const start = Date.now()
    for (let i = 0; i < 100; i++) {
      logger.info('fast', { i })
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(100)
  })

  it('forwards a transport delivery error to logger.on("error") (gotcha: winston re-emits)', async () => {
    cwMock.reset()
    cwMock
      .on(PutLogEventsCommand)
      .rejects(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }))
    transport = new CloudWatchTransport({
      logGroupName: 'g',
      logStreamName: 's',
      submissionInterval: 5,
      maxRetries: 1,
      retryBackoffCap: 0,
    })
    const transportErrorSpy = jest.fn()
    transport.on('error', transportErrorSpy)
    const logger = winston.createLogger({ level: 'info', transports: [transport] })
    // MUST attach before the relay surfaces the error — winston re-emits the
    // transport's `error` on the Logger itself, and Node's EventEmitter throws
    // on emit('error') with no listener. This is the crash we hit while
    // building examples/basic-usage.ts.
    const loggerErrorSpy = jest.fn()
    logger.on('error', loggerErrorSpy)

    logger.info('this will fail')
    await waitUntil(() => transportErrorSpy.mock.calls.length > 0)
    expect(transportErrorSpy).toHaveBeenCalled()
    expect(loggerErrorSpy).toHaveBeenCalled()
  })
})
