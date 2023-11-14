const { join } = require('node:path');

/**
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 * @type {import('jest').Config}
 */
module.exports = {
  collectCoverage: false, // It doesn't make sense to collect coverage for e2e tests because they target high level features and interaction with other services.
  maxWorkers: 1, // We don't want to run tests in parallel because they might interfere with each other. This option is the same as --runInBand. See: https://stackoverflow.com/a/46489246.

  mockReset: true,
  preset: 'ts-jest',
  restoreMocks: true,
  setupFiles: [join(__dirname, './jest.setup.js')],
  testEnvironment: 'jest-environment-node',
  testMatch: ['**/?(*.)+(feature).[t]s?(x)'],
  testPathIgnorePatterns: ['<rootDir>/.build', '<rootDir>/dist/', '<rootDir>/build/'],
  testTimeout: 40_000,
  verbose: true,
};
