import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mockStart = jest.fn()
const mockStop = jest.fn()
const mockSubmit = jest.fn()
const mockFlush = jest.fn<(timeout?: number) => Promise<void>>().mockResolvedValue(undefined)
const mockOn = jest.fn()

jest.mock('../../src/Relay', () => {
  const EventEmitter = require('events').EventEmitter
  class MockRelay extends EventEmitter {
    start = mockStart
    stop = mockStop
    submit = mockSubmit
    flush = mockFlush
  }
  // Also capture the on() calls
  const origOn = MockRelay.prototype.on
  MockRelay.prototype.on = function (...args: Parameters<typeof origOn>) {
    mockOn(...args)
    return origOn.apply(this, args)
  }
  return {
    __esModule: true,
    default: MockRelay,
    DEFAULT_OPTIONS: { submissionInterval: 2000, batchSize: 20, maxQueueSize: 10_000 },
  }
})

jest.mock('../../src/CloudWatchClient', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      submit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      destroy: jest.fn(),
    })),
  }
})

import CloudWatchTransport from '../../src/CloudWatchTransport'

describe('CloudWatchTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a transport and calls start on relay', () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    expect(transport).toBeDefined()
    expect(mockStart).toHaveBeenCalledTimes(1)
  })

  it('has default name "cloudwatch"', () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    expect((transport as unknown as Record<string, unknown>).name).toBe('cloudwatch')
  })

  it('allows custom name override', () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
      name: 'my-custom-transport',
    })
    expect((transport as unknown as Record<string, unknown>).name).toBe('my-custom-transport')
  })

  it('registers an error listener on relay', () => {
    new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('log() creates a LogItem and submits to relay', () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    const callback = jest.fn()
    transport.log({ level: 'info', message: 'hello', extra: 'data' }, callback)
    expect(mockSubmit).toHaveBeenCalledTimes(1)

    const submittedItem = mockSubmit.mock.calls[0]![0] as Record<string, unknown>
    expect(submittedItem.level).toBe('info')
    expect(submittedItem.message).toBe('hello')
    expect(submittedItem.meta).toEqual({ extra: 'data' })
    expect(submittedItem.callback).toBe(callback)
  })

  it('log() handles non-string level and message gracefully', () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    const callback = jest.fn()
    transport.log({ level: 42, message: undefined } as unknown as Record<string, unknown>, callback)
    const submittedItem = mockSubmit.mock.calls[0]![0] as Record<string, unknown>
    expect(submittedItem.level).toBe('')
    expect(submittedItem.message).toBe('')
  })

  it('close() calls relay.stop()', () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    transport.close()
    expect(mockStop).toHaveBeenCalledTimes(1)
  })

  it('flush() delegates to relay.flush()', async () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    await transport.flush()
    expect(mockFlush).toHaveBeenCalledTimes(1)
    expect(mockFlush).toHaveBeenCalledWith(undefined)
  })

  it('flush() passes timeout to relay.flush()', async () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    await transport.flush(5000)
    expect(mockFlush).toHaveBeenCalledWith(5000)
  })

  it('forwards error events from relay', () => {
    const transport = new CloudWatchTransport({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
    })
    const errorSpy = jest.fn()
    transport.on('error', errorSpy)

    // Trigger error on the relay (which is an EventEmitter)
    const relay = (transport as any).relay
    const testError = new Error('test error')
    relay.emit('error', testError)

    expect(errorSpy).toHaveBeenCalledWith(testError)
  })
})
