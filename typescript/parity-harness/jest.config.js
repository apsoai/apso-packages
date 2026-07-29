/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.spec.ts'],
  setupFiles: ['reflect-metadata'],
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { experimentalDecorators: true, emitDecoratorMetadata: true, strict: false, types: ['node', 'jest', 'reflect-metadata'] } }]
  }
};
