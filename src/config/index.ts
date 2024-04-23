import { join } from 'node:path';
import { cwd } from 'node:process';

import {
  interpolateSecretsIntoConfig,
  loadConfig as loadConfigCommons,
  loadSecrets as loadSecretsCommons,
} from '@api3/commons';
import { goSync } from '@api3/promise-utils';

import { configSchema } from './schema';

// When Airnode feed is built, the "/dist" file contains "src" folder and "package.json" and the config is expected to
// be located next to the "/dist" folder. When run in development, the config is expected to be located next to the
// "src" folder (one less import level). We resolve the config by CWD as a workaround. Since the Airseeker is
// dockerized, this is hidden from the user.
const getConfigPath = () => join(cwd(), './config');

export const loadRawConfig = () => loadConfigCommons(join(getConfigPath(), 'airseeker.json'));

export const loadRawSecrets = () => loadSecretsCommons(join(getConfigPath(), 'secrets.env'));

export const loadConfig = () => {
  const goLoadConfig = goSync(() => {
    const rawConfig = loadRawConfig();
    const rawSecrets = loadRawSecrets();
    return configSchema.parse(interpolateSecretsIntoConfig(rawConfig, rawSecrets));
  });

  if (!goLoadConfig.success) throw new Error(`Unable to load configuration.`, { cause: goLoadConfig.error });
  return goLoadConfig.data;
};
