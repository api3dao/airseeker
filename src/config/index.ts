import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { goSync } from '@api3/promise-utils';
import dotenv from 'dotenv';

import { configSchema } from './schema';
import { interpolateSecrets, parseSecrets } from './utils';

export const getConfigPath = () => join(__dirname, '../../config');

export const loadRawConfig = () => JSON.parse(readFileSync(join(getConfigPath(), 'airseeker.json'), 'utf8'));

export const loadRawSecrets = () => dotenv.parse(readFileSync(join(getConfigPath(), 'secrets.env'), 'utf8'));

export const loadConfig = () => {
  const goLoadConfig = goSync(() => {
    const rawConfig = loadRawConfig();
    const rawSecrets = loadRawSecrets();
    const secrets = parseSecrets(rawSecrets);
    return configSchema.parse(interpolateSecrets(rawConfig, secrets));
  });

  if (!goLoadConfig.success) throw new Error(`Unable to load configuration.`, { cause: goLoadConfig.error });
  return goLoadConfig.data;
};
