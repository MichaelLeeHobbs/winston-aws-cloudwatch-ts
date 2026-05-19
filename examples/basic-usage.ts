/**
 * @ubercode/winston-cloudwatch — runnable example.
 *
 * Demonstrates the common patterns: transport setup, basic logging,
 * structured metadata, custom formatting, error handling, and graceful
 * shutdown.
 *
 * Run it:
 *   pnpm run example
 *   # or
 *   npx ts-node examples/basic-usage.ts
 *
 * Configure via environment variables (see examples/README.md):
 *   AWS_REGION, CW_LOG_GROUP, CW_LOG_STREAM,
 *   CW_CREATE=1 (auto-create the group/stream), CW_JSON=1 (JSON messages)
 *
 * In a real project the import is:
 *   import CloudWatchTransport from '@ubercode/winston-cloudwatch'
 * Here we import from source so the example runs without a build step.
 */
import winston from 'winston'
import CloudWatchTransport from '../src'

const region = process.env.AWS_REGION ?? 'us-east-1'
const logGroupName = process.env.CW_LOG_GROUP ?? '/winston-cloudwatch/example'
const logStreamName = process.env.CW_LOG_STREAM ?? `example-${new Date().toISOString().slice(0, 10)}`
const autoCreate = process.env.CW_CREATE === '1'
const jsonMessage = process.env.CW_JSON === '1'

// 1. Create the transport.
const cloudWatchTransport = new CloudWatchTransport({
  logGroupName,
  logStreamName,
  awsConfig: { region },

  // Auto-create the group/stream on first write (needs logs:CreateLogGroup /
  // logs:CreateLogStream IAM permissions). Off by default.
  createLogGroup: autoCreate,
  createLogStream: autoCreate,

  // Structured JSON messages instead of the default "[LEVEL] message {meta}".
  jsonMessage,

  // Custom formatting takes precedence over jsonMessage. Uncomment to use:
  // formatLog: (item) =>
  //   `${new Date(item.date).toISOString()} ${item.level.toUpperCase()} ` +
  //   `${item.message}${item.meta ? ' ' + JSON.stringify(item.meta) : ''}`,

  // Delivery is decoupled from the logging call (bounded, never blocks the
  // app). These knobs tune the in-memory buffer / retry policy:
  submissionInterval: 2000,
  batchSize: 20,
  maxQueueSize: 10_000,
  maxRetries: 10,
  retryBackoffCap: 30_000,
})

// 2. Handle delivery errors. Recommended: a persistent CloudWatch failure
//    (throttling, bad IAM, outage) surfaces here. It never crashes the app and
//    never blocks logging — memory stays bounded by maxQueueSize.
cloudWatchTransport.on('error', err => {
  // Use console here so logging-pipeline errors don't recurse through Winston.
  console.error('[cloudwatch-transport error]', err instanceof Error ? err.message : err)
})

// 3. Build a logger. A Console transport is included so you can see output
//    locally even without AWS credentials.
const logger = winston.createLogger({
  level: 'info',
  transports: [
    cloudWatchTransport,
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
})

// Winston re-emits a transport's `error` on the Logger itself. Without a
// listener here, Node would throw on the unhandled 'error' event. (The
// transport-level handler above is still the recommended place to react to
// CloudWatch delivery failures specifically.)
logger.on('error', err => {
  console.error('[logger error]', err instanceof Error ? err.message : err)
})

async function main(): Promise<void> {
  console.log(`Logging to CloudWatch ${logGroupName} / ${logStreamName} (region ${region})`)

  // 4a. Basic logging.
  logger.info('Application started')

  // 4b. Structured metadata — any extra fields become the log entry's metadata.
  logger.info('User logged in', { userId: 1234, ip: '203.0.113.7', method: 'password' })
  logger.warn('Slow request', { route: '/api/report', durationMs: 4200 })

  // 4c. Logging an error with a stack trace.
  try {
    throw new Error('Downstream service timed out')
  } catch (err) {
    logger.error('Request failed', { route: '/api/report', err })
  }

  // 4d. A short burst, to show batching/throttling in action.
  for (let i = 0; i < 5; i++) {
    logger.info('Heartbeat', { seq: i })
  }

  // 5. Graceful shutdown — flush buffered logs (best-effort, bounded) then
  //    close the transport before the process exits.
  await shutdown('done')
}

let shuttingDown = false
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Shutting down (${reason}) — flushing pending logs...`)
  // Wait up to 5s for the queue to drain to CloudWatch, then close.
  await cloudWatchTransport.flush(5000)
  await cloudWatchTransport.close()
  console.log('Flushed and closed.')
}

// Flush on Ctrl-C / container stop so in-flight logs aren't lost.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal).then(() => process.exit(0))
  })
}

main().catch((err: unknown) => {
  console.error('Example failed:', err)
  void shutdown('error').then(() => process.exit(1))
})
