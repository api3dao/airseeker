import { createLogger } from '@api3/commons';

import { loadEnv } from '../env/env';

// We need to load the environment variables before we can use the logger. Because we want the logger to always be
// available, we load the environment variables as a side effect during the module import.
const env = loadEnv();

export const heartbeatLogger = createLogger({
  colorize: env.LOG_COLORIZE,
  format: env.LOG_FORMAT,
  enabled: env.LOGGER_ENABLED,
  minLevel: 'info', // The heartbeat is sent with INFO severity.
});
