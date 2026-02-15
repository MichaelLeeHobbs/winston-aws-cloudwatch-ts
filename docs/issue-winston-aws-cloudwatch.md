**Title:** Modernized fork: @ubercode/winston-cloudwatch (AWS SDK v3, TypeScript, actively maintained)

---

Hi all,

I've published a modernized fork of this package as [`@ubercode/winston-cloudwatch`](https://www.npmjs.com/package/@ubercode/winston-cloudwatch). The API is very similar, so migration is straightforward.

What's new:

- **AWS SDK v3** (modular, tree-shakeable)
- **Full TypeScript** rewrite with strict mode
- **Bottleneck rate limiting** to prevent throttling
- **Byte-aware batching** that respects the 1 MB PutLogEvents limit
- **Graceful shutdown** with `await transport.flush()`
- **JSON formatting**, **retention policies**, **client injection**
- **100% test coverage**
- Requires Node.js >= 20.9.0

```bash
npm install @ubercode/winston-cloudwatch winston
```

Migration guide: [Migrating from winston-aws-cloudwatch](https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts/blob/master/docs/migration-from-winston-aws-cloudwatch.md)

GitHub: https://github.com/MichaelLeeHobbs/winston-aws-cloudwatch-ts

Thanks to Tim De Pauw for the original package that this builds on.
