# Example: `@ubercode/winston-cloudwatch`

A minimal, runnable Node.js/TypeScript app that wires Winston up to the
CloudWatch transport and demonstrates the common patterns:

- Transport setup (region, log group/stream, optional auto-create)
- Basic logging and **structured metadata**
- **Custom / JSON formatting**
- **Error handling** via the transport's `error` event
- **Graceful shutdown** (flush + close, including `SIGINT`/`SIGTERM`)

See [`basic-usage.ts`](./basic-usage.ts).

> In your own project the import is
> `import CloudWatchTransport from '@ubercode/winston-cloudwatch'`.
> This in-repo example imports from `../src` so it runs without a build step.

## Run it

From the repository root:

```bash
pnpm install
pnpm run example
# or, directly:
npx ts-node examples/basic-usage.ts
```

To run it as a compiled script instead:

```bash
pnpm run build
npx tsc examples/basic-usage.ts --outDir tmp-example --module nodenext --target es2022 --esModuleInterop
node tmp-example/basic-usage.js
```

## Configuration (environment variables)

| Variable        | Default                            | Description                                              |
| --------------- | ---------------------------------- | -------------------------------------------------------- |
| `AWS_REGION`    | `us-east-1`                        | AWS region for the CloudWatch Logs API                   |
| `CW_LOG_GROUP`  | `/winston-cloudwatch/example`      | Target log group name                                    |
| `CW_LOG_STREAM` | `example-<YYYY-MM-DD>`             | Target log stream name                                   |
| `CW_CREATE`     | _unset_                            | `1` to auto-create the log group **and** stream          |
| `CW_JSON`       | _unset_                            | `1` to emit structured JSON log messages                 |

```bash
AWS_REGION=us-west-2 CW_LOG_GROUP=/my-app/dev CW_CREATE=1 pnpm run example
```

## AWS credentials

The example uses the AWS SDK v3 default credential chain. Provide credentials
by any standard method:

1. **Environment variables**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
   (and `AWS_SESSION_TOKEN` if using temporary credentials)
2. **Shared config files**: `~/.aws/credentials` / `~/.aws/config`
3. **IAM role**: automatic on EC2 / ECS / Lambda

Required IAM actions: `logs:PutLogEvents` (plus `logs:CreateLogGroup` and
`logs:CreateLogStream` when `CW_CREATE=1`), and optionally
`logs:PutRetentionPolicy`.

Without credentials the app still runs: log lines print to the console, and the
failed CloudWatch delivery is reported (once) via the transport's `error`
event — it never crashes the process or blocks logging.
