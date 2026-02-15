# Migrating from winston-cloudwatch

This guide helps you migrate from [`winston-cloudwatch`](https://github.com/lazywithclass/winston-cloudwatch) (by lazywithclass) to `@ubercode/winston-cloudwatch`.

## Why Migrate?

- **Unmaintained** — `winston-cloudwatch` has not seen active development
- **AWS SDK v2** — Still relies on the legacy AWS SDK v2, which is in maintenance mode
- **Rate limiting** — Uses `describeLogStreams` on every batch to get the sequence token, which is slow and counts against your API quota
- **TypeScript** — No first-class TypeScript support
- **Modern Node.js** — `@ubercode/winston-cloudwatch` is built for Node.js >= 20.9.0 with full ESM + CJS support

## Install

```bash
# Remove the old package
npm uninstall winston-cloudwatch

# Install the new package
npm install @ubercode/winston-cloudwatch
```

## Option Mapping

| `winston-cloudwatch`                       | `@ubercode/winston-cloudwatch`                  | Notes                                          |
|--------------------------------------------|--------------------------------------------------|-------------------------------------------------|
| `awsRegion`                                | `awsConfig: { region: '...' }`                   | Region is part of the standard AWS SDK config   |
| `awsAccessKeyId` / `awsSecretKey`          | `awsConfig: { credentials: { accessKeyId, secretAccessKey } }` | Use standard AWS SDK credentials       |
| `awsOptions`                               | `awsConfig`                                      | Full `CloudWatchLogsClientConfig`               |
| `logGroupName`                             | `logGroupName`                                   | Same                                            |
| `logStreamName`                            | `logStreamName`                                  | Same                                            |
| `uploadRate`                               | `submissionInterval`                             | Milliseconds between batch submissions          |
| `jsonMessage`                              | `jsonMessage`                                    | Same                                            |
| `messageFormatter`                         | `formatLog`                                      | Same concept, slightly different signature       |
| `retentionInDays`                          | `retentionInDays`                                | Same                                            |
| `errorHandler`                             | `transport.on('error', handler)`                 | Use Winston's built-in event system             |
| `cloudWatchLogs`                           | `cloudWatchLogs`                                 | Bring your own client (now AWS SDK v3)          |
| `logGroupName` (function)                  | `logGroupName` (string only)                     | Dynamic names not supported; use static strings |
| `logStreamName` (function)                 | `logStreamName` (string only)                    | Dynamic names not supported; use static strings |

## Before / After

### Before (winston-cloudwatch)

```javascript
const winston = require('winston')
const WinstonCloudWatch = require('winston-cloudwatch')

const logger = winston.createLogger({
  transports: [
    new WinstonCloudWatch({
      logGroupName: 'my-app',
      logStreamName: 'my-stream',
      awsRegion: 'us-east-1',
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
      uploadRate: 2000,
      jsonMessage: true,
      errorHandler: (err) => console.error('CW error', err)
    })
  ]
})
```

### After (@ubercode/winston-cloudwatch)

```typescript
import winston from 'winston'
import CloudWatchTransport from '@ubercode/winston-cloudwatch'

const transport = new CloudWatchTransport({
  logGroupName: 'my-app',
  logStreamName: 'my-stream',
  submissionInterval: 2000,
  jsonMessage: true,
  awsConfig: {
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  }
})

transport.on('error', (err) => console.error('CW error', err))

const logger = winston.createLogger({ transports: [transport] })
```

## Key Improvements After Migrating

- **No more `describeLogStreams`** — Sequence tokens are tracked locally, reducing API calls
- **Bottleneck rate limiting** — Built-in throttling prevents `ThrottlingException` errors
- **Byte-aware batching** — Respects the 1 MB `PutLogEvents` payload limit automatically
- **Graceful shutdown** — `await transport.flush()` drains the queue before exit
- **Full TypeScript** — Complete type definitions with strict mode
- **AWS SDK v3** — Modular, tree-shakeable, actively maintained
- **Automatic log group/stream creation** — Set `createLogGroup: true` and `createLogStream: true`
