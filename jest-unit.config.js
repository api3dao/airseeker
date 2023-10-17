import { config } from './jest.config';

module.exports = {
  ...config,
  displayName: 'unit',
  testMatch: ['**/?(*.)+(spec|test).[t]s?(x)'],
};
