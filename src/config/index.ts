import fs, { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { goSync } from '@api3/promise-utils';
import dotenv from 'dotenv';

import { configSchema } from './schema';
import { interpolateSecrets, parseSecrets } from './utils';

export const loadConfig = (configPath = join(__dirname, '../../config'), airseekerConfigPath = 'airseeker.json') => {
  const rawSecrets = dotenv.parse(readFileSync(join(configPath, 'secrets.env'), 'utf8'));

  const goLoadConfig = goSync(() => {
    const rawConfig = JSON.parse(fs.readFileSync(join(configPath, airseekerConfigPath), 'utf8'));
    const secrets = parseSecrets(rawSecrets);
    return configSchema.safeParse(interpolateSecrets(rawConfig, secrets));
  });

  if (!goLoadConfig.success) throw new Error(`Unable to load configuration.`, { cause: goLoadConfig.error });
  return goLoadConfig.data;
};
