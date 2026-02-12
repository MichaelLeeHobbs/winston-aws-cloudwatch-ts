# winston-aws-cloudwatch-ts

[![npm version](https://img.shields.io/npm/v/winston-aws-cloudwatch-ts.svg)](https://www.npmjs.com/package/winston-aws-cloudwatch-ts)
[![npm downloads](https://img.shields.io/npm/dm/winston-aws-cloudwatch-ts.svg)](https://www.npmjs.com/package/winston-aws-cloudwatch-ts)
[![Build Status](https://img.shields.io/circleci/project/github/MichaelLeeHobbs/winston-aws-cloudwatch-ts/master.svg?label=build)](https://circleci.com/gh/MichaelLeeHobbs/winston-aws-cloudwatch-ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A modern TypeScript [Winston](https://www.npmjs.com/package/winston) transport for [Amazon CloudWatch](https://aws.amazon.com/cloudwatch/) using AWS SDK v3.

## Features

- ✅ **TypeScript** - Full TypeScript support with complete type definitions
- ✅ **AWS SDK v3** - Uses the modern modular AWS SDK v3
- ✅ **Rate Limiting** - Built-in throttling to respect CloudWatch API limits
- ✅ **Automatic Retries** - Handles sequence token errors automatically
- ✅ **Customizable Formatting** - Flexible log formatting options
- ✅ **Well Tested** - 94%+ test coverage with Jest

## Installation

```bash
npm install winston-aws-cloudwatch-ts winston
# or
yarn add winston-aws-cloudwatch-ts winston
# or
pnpm add winston-aws-cloudwatch-ts winston
```

## Usage

### JavaScript (CommonJS)

```javascript
const winston = require('winston')
const CloudWatchTransport = require('winston-aws-cloudwatch-ts')

const logger = winston.createLogger({
  transports: [
    new CloudWatchTransport({
      logGroupName: 'my-app-logs',        // REQUIRED
      logStreamName: 'my-app-stream',     // REQUIRED
      createLogGroup: true,
      createLogStream: true,
      submissionInterval: 2000,
      submissionRetryCount: 1,
      batchSize: 20,
      awsConfig: {
        region: 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      }
    })
  ]
})

logger.info('Hello CloudWatch!', { userId: 123, action: 'login' })
```

### TypeScript (ESM)

```typescript
import winston from 'winston'
import CloudWatchTransport from 'winston-aws-cloudwatch-ts'

const logger = winston.createLogger({
  transports: [
    new CloudWatchTransport({
      logGroupName: 'my-app-logs',
      logStreamName: 'my-app-stream',
      createLogGroup: true,
      createLogStream: true,
      awsConfig: {
        region: 'us-east-1'
      }
    })
  ]
})

logger.info('Hello CloudWatch!', { userId: 123, action: 'login' })
```

## Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `logGroupName` | `string` | ✅ Yes | - | CloudWatch log group name |
| `logStreamName` | `string` | ✅ Yes | - | CloudWatch log stream name |
| `awsConfig` | `CloudWatchLogsClientConfig` | No | `{}` | AWS SDK v3 client configuration |
| `createLogGroup` | `boolean` | No | `false` | Automatically create log group if it doesn't exist |
| `createLogStream` | `boolean` | No | `false` | Automatically create log stream if it doesn't exist |
| `submissionInterval` | `number` | No | `2000` | Milliseconds between log submissions |
| `batchSize` | `number` | No | `20` | Maximum number of logs to send in one batch |
| `submissionRetryCount` | `number` | No | `1` | Number of retries for failed submissions |
| `formatLog` | `function` | No | - | Custom function to format log messages |
| `formatLogItem` | `function` | No | - | Custom function to format log items |

### Custom Formatting

```typescript
new CloudWatchTransport({
  logGroupName: 'my-app',
  logStreamName: 'my-stream',
  formatLog: (item) => {
    return `[${item.level}] ${item.message} ${JSON.stringify(item.meta)}`
  }
})
```

## Error Handling

The transport emits an `error` event when logging to CloudWatch fails. It's recommended to subscribe to this event to avoid crashes:

```typescript
const transport = new CloudWatchTransport({
  logGroupName: 'my-app',
  logStreamName: 'my-stream'
})

transport.on('error', (error) => {
  console.error('CloudWatch logging error:', error)
})

const logger = winston.createLogger({ transports: [transport] })
```

## AWS Credentials

This library uses AWS SDK v3, which supports multiple authentication methods:

1. **Environment Variables**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
2. **AWS Config Files**: `~/.aws/credentials` and `~/.aws/config`
3. **IAM Roles**: Automatic in EC2, ECS, Lambda
4. **Explicit Config**: Pass credentials in `awsConfig`

```typescript
// Option 1: Use environment variables (recommended)
new CloudWatchTransport({
  logGroupName: 'my-app',
  logStreamName: 'my-stream',
  awsConfig: { region: 'us-east-1' }
})

// Option 2: Explicit credentials (not recommended for production)
new CloudWatchTransport({
  logGroupName: 'my-app',
  logStreamName: 'my-stream',
  awsConfig: {
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'YOUR_ACCESS_KEY',
      secretAccessKey: 'YOUR_SECRET_KEY'
    }
  }
})
```

## Why This Fork?

This is a modernized TypeScript fork of [winston-aws-cloudwatch](https://github.com/timdp/winston-aws-cloudwatch) with the following improvements:

- ✅ Full TypeScript rewrite with proper types
- ✅ Updated to AWS SDK v3 (modular, tree-shakeable)
- ✅ Modern testing with Jest (replacing Mocha)
- ✅ Updated dependencies and security fixes
- ✅ Better error handling and type safety

## Requirements

- Node.js >= 20.9.0
- Winston ^3.0.0

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests with coverage
pnpm test:cover

# Build
pnpm build

# Lint
pnpm lint

# Format
pnpm format
```

## License

MIT

## Original Author

Original package by [Tim De Pauw](https://tmdpw.eu/)

## Contributors

TypeScript modernization and AWS SDK v3 migration by [Michael Lee Hobbs](https://github.com/MichaelLeeHobbs)
