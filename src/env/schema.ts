import { type LogFormat, logFormatOptions, logLevelOptions, type LogLevel } from '@api3/commons';
import { z } from 'zod';

export const envBooleanSchema = z.union([z.literal('true'), z.literal('false')]).transform((val) => val === 'true');

// We apply default values to make it convenient to omit certain environment variables. The default values should be
// primarily focused on users and production usage.
export const envConfigSchema = z.object({
  LOG_COLORIZE: envBooleanSchema.default(false),
  LOG_FORMAT: z
    .string()
    .transform((value, ctx) => {
      if (!logFormatOptions.includes(value as any)) {
        ctx.issues.push({
          code: 'custom',
          message: 'Invalid LOG_FORMAT',
          input: value,
        });
        return z.NEVER;
      }

      return value as LogFormat;
    })
    .default('json'),
  LOG_LEVEL: z
    .string()
    .transform((value, ctx) => {
      if (!logLevelOptions.includes(value as any)) {
        ctx.issues.push({
          code: 'custom',
          message: 'Invalid LOG_LEVEL',
          input: value,
        });
        return z.NEVER;
      }

      return value as LogLevel;
    })
    .default('info'),
  LOGGER_ENABLED: envBooleanSchema.default(true),
  LOG_HEARTBEAT: envBooleanSchema.default(true),
}); // We parse from ENV variables of the process which has many variables that we don't care about

export type EnvConfig = z.infer<typeof envConfigSchema>;
