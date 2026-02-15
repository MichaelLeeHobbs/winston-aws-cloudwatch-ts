**Title:** Alternative: @ubercode/winston-cloudwatch (AWS SDK v3, TypeScript, actively maintained)

---

Hi all,

For anyone looking for an actively maintained CloudWatch transport for Winston, I've published [`@ubercode/winston-cloudwatch`](https://www.npmjs.com/package/@ubercode/winston-cloudwatch).

Key differences from this package:

- **AWS SDK v3** (v2 is in maintenance mode)
- **Full TypeScript** with strict mode and complete type definitions
- **Built-in rate limiting** via Bottleneck (no more `describeLogStreams` per batch)
- **Byte-aware batching** that respects the 1 MB PutLogEvents limit
- **Graceful shutdown** with `await transport.flush()`
- **100% test coverage**
- Requires Node.js >= 20.9.0

```bash
npm install @ubercode/winston-cloudwatch winston
```

Migration guide: [Migrating from winston-cloudwatch](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/blob/master/docs/migration-from-winston-cloudwatch.md)

GitHub: https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts
