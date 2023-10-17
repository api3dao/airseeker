import { config } from './jest.config';

module.exports = {
  ...config,
  displayName: 'e2e',
  testMatch: ['**/?(*.)+(feature).[t]s?(x)'],
};
