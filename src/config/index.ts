import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';

import { goSync } from '@api3/promise-utils';
import dotenv from 'dotenv';

import { configSchema } from './schema';
import { interpolateSecrets, parseSecrets } from './utils';

// When Airnode feed is built, the "/dist" file contains "src" folder and "package.json" and the config is expected to
// be located next to the "/dist" folder. When run in development, the config is expected to be located next to the
// "src" folder (one less import level). We resolve the config by CWD as a workaround. Since the Airnode feed is
// dockerized, this is hidden from the user.
const getConfigPath = () => join(cwd(), './config');

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
