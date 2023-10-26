import { createLogger } from '@api3/commons';

import { loadEnv } from './env/env';

const env = loadEnv();

export const logger = createLogger({
  colorize: env.LOG_COLORIZE,
  enabled: env.LOGGER_ENABLED,
  minLevel: env.LOG_LEVEL,
  format: env.LOG_FORMAT,
});
