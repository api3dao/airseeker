import fs, { readFileSync } from 'fs';
import { join } from 'path';
import { go } from '@api3/promise-utils';
import dotenv from 'dotenv';
import { configSchema } from './schema';
import { interpolateSecrets, parseSecrets } from './utils';

export const loadConfig = async () => {
  const configPath = join(__dirname, '../../config');
  const rawSecrets = dotenv.parse(readFileSync(join(configPath, 'secrets.env'), 'utf8'));

  const goLoadConfig = await go(async () => {
    const rawConfig = JSON.parse(fs.readFileSync(join(configPath, 'airseeker.json'), 'utf8'));
    const secrets = parseSecrets(rawSecrets);
    return configSchema.parseAsync(interpolateSecrets(rawConfig, secrets));
  });

  if (!goLoadConfig.success) throw new Error(`Unable to load configuration.`, { cause: goLoadConfig.error });
  return goLoadConfig.data;
};
