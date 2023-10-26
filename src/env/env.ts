import { join } from 'node:path';

import dotenv from 'dotenv';

import { type EnvConfig, envConfigSchema } from './schema';

let env: EnvConfig | undefined;

export const loadEnv = () => {
  if (env) return env;

  dotenv.config({ path: join(__dirname, '../.env') });

  const parseResult = envConfigSchema.safeParse(process.env);
  if (!parseResult.success) {
    throw new Error(`Invalid environment variables:\n, ${JSON.stringify(parseResult.error.format())}`);
  }

  env = parseResult.data;
  return env;
};
