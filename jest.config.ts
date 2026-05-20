import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  // tests/stress/ holds long-running memory harnesses (*.stress.ts) run via the
  // dedicated `pnpm run test:stress` script — never part of the default suite.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/stress/'],
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/setupAwsSdkMock.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
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
          // TypeScript 6 deprecated `moduleResolution: 'node'` (removed in 7).
          // Keep using it under ts-jest until we migrate test transform to
          // 'node16'/'nodenext'; suppress the deprecation in the meantime.
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  verbose: true,
  workerIdleMemoryLimit: '512MB',
}

export default config
