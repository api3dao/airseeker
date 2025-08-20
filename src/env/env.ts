import { join } from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

import { type EnvConfig, envConfigSchema } from './schema';

let env: EnvConfig | undefined;

export const loadEnv = () => {
  if (env) return env;

  dotenv.config({ path: join(__dirname, '../../.env'), quiet: true });

  const parseResult = envConfigSchema.safeParse(process.env);
  if (!parseResult.success) {
    throw new Error(`Invalid environment variables: ${z.prettifyError(parseResult.error)}`);
  }

  env = parseResult.data;
  return env;
};
