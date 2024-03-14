const { join } = require('node:path');

/**
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 * @type {import('jest').Config}
 */
module.exports = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['node_modules'],
  coverageProvider: 'v8',

  preset: 'ts-jest',
  resetMocks: true,
  restoreMocks: true,
  setupFiles: [join(__dirname, './jest.setup.js')],
  testEnvironment: 'jest-environment-node',
  testMatch: ['**/?(*.)+(spec|test).[t]s?(x)'],
  testPathIgnorePatterns: ['<rootDir>/.build', '<rootDir>/dist/', '<rootDir>/build/'],
  verbose: true,

  // See: https://github.com/jestjs/jest/issues/11617#issuecomment-1028651059. We can't use "workerThreads" mentioned
  // later, because it complains that some of the node internal modules used in commons processing are unavailable.
  maxWorkers: 1,
};
