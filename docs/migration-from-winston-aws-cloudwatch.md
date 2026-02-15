# Migrating from winston-aws-cloudwatch

This guide helps you migrate from [`winston-aws-cloudwatch`](https://github.com/timdp/winston-aws-cloudwatch) (by timdp/pascencio) to `@ubercode/winston-cloudwatch`.

## Overview

`@ubercode/winston-cloudwatch` is a direct fork of `winston-aws-cloudwatch`, so the API is very similar. The main changes are the upgrade to AWS SDK v3, TypeScript rewrite, and improved batching/retry logic.

## Install

```bash
# Remove the old package
npm uninstall winston-aws-cloudwatch

# Install the new package
npm install @ubercode/winston-cloudwatch
```

## Option Mapping

Most options are a 1:1 match:

| `winston-aws-cloudwatch`     | `@ubercode/winston-cloudwatch` | Notes                                             |
|------------------------------|--------------------------------|---------------------------------------------------|
| `logGroupName`               | `logGroupName`                 | Same                                              |
| `logStreamName`              | `logStreamName`                | Same                                              |
| `awsConfig`                  | `awsConfig`                    | Same (now uses AWS SDK v3 `CloudWatchLogsClientConfig`) |
| `createLogGroup`             | `createLogGroup`               | Same                                              |
| `createLogStream`            | `createLogStream`              | Same                                              |
| `submissionInterval`         | `submissionInterval`           | Same                                              |
| `batchSize`                  | `batchSize`                    | Same                                              |
| `formatLog`                  | `formatLog`                    | Same                                              |
| `submissionRetryCount`       | _(removed)_                    | Bottleneck + Relay handle retries automatically   |

## Before / After

### Before (winston-aws-cloudwatch)

```javascript
const winston = require('winston')
const CloudWatchTransport = require('winston-aws-cloudwatch')

const logger = winston.createLogger({
  transports: [
    new CloudWatchTransport({
      logGroupName: '/my-app/logs',
      logStreamName: 'production',
      createLogGroup: true,
      createLogStream: true,
      submissionInterval: 2000,
      batchSize: 20,
      submissionRetryCount: 3,
      awsConfig: {
        region: 'us-east-1'
      },
      formatLog: (item) =>
        `${item.level}: ${item.message}`
    })
  ]
})
```

### After (@ubercode/winston-cloudwatch)

```typescript
import winston from 'winston'
import CloudWatchTransport from '@ubercode/winston-cloudwatch'

const logger = winston.createLogger({
  transports: [
    new CloudWatchTransport({
      logGroupName: '/my-app/logs',
      logStreamName: 'production',
      createLogGroup: true,
      createLogStream: true,
      submissionInterval: 2000,
      batchSize: 20,
      awsConfig: {
        region: 'us-east-1'
      },
      formatLog: (item) =>
        `${item.level}: ${item.message}`
    })
  ]
})
```

The only change needed is removing `submissionRetryCount` (retries are now automatic) and updating the import path.

## New Features Available After Migrating

- **TypeScript** — Full type definitions with strict mode
- **AWS SDK v3** — Modular, tree-shakeable, actively maintained
- **Bottleneck rate limiting** — Built-in throttling prevents `ThrottlingException` errors
- **Byte-aware batching** — Automatically respects the 1 MB `PutLogEvents` payload limit
- **Graceful shutdown** — `await transport.flush()` drains the queue before exit
- **JSON message formatting** — Set `jsonMessage: true` for structured JSON output
- **Retention policies** — Set `retentionInDays` to configure log group retention
- **Client injection** — Pass a pre-built `CloudWatchLogsClient` via the `cloudWatchLogs` option
- **Max queue size** — Set `maxQueueSize` to bound memory usage (oldest items dropped when full)
- **Custom transport name** — Set `name` for Winston transport identification
