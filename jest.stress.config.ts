import type { Config } from 'jest'

// Long-running memory/throughput harness, run only via `pnpm run test:stress`
// (needs node --expose-gc). Kept out of the default suite / CI for speed.
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/stress'],
  testMatch: ['**/*.stress.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          isolatedModules: true,
          // TypeScript 6 deprecation; see jest.config.ts for context.
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  verbose: true,
}

export default config
