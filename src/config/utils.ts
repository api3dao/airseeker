import { z } from 'zod';
import { template } from 'lodash';
import { goSync } from '@api3/promise-utils';

const secretsSchema = z.record(z.string());

export const parseSecrets = (secrets: unknown) => {
  return secretsSchema.parse(secrets);
};

// Regular expression that does not match anything, ensuring no escaping or interpolation happens
// https://github.com/lodash/lodash/blob/4.17.15/lodash.js#L199
// eslint-disable-next-line prefer-named-capture-group
const NO_MATCH_REGEXP = /($^)/;
// Regular expression matching ES template literal delimiter (${}) with escaping
// https://github.com/lodash/lodash/blob/4.17.15/lodash.js#L175
// eslint-disable-next-line prefer-named-capture-group
const ES_MATCH_REGEXP = /\${([^\\}]*(?:\\.[^\\}]*)*)}/g;

export const interpolateSecrets = (config: unknown, secrets: Record<string, string | undefined>) => {
  const goInterpolated = goSync(() =>
    template(JSON.stringify(config), {
      escape: NO_MATCH_REGEXP,
      evaluate: NO_MATCH_REGEXP,
      interpolate: ES_MATCH_REGEXP,
    })(secrets)
  );

  if (!goInterpolated.success) {
    throw new Error(`Error interpolating secrets. Make sure the secrets format is correct.`, {
      cause: goInterpolated.error,
    });
  }

  const goJson = goSync(() => JSON.parse(goInterpolated.data));
  if (!goJson.success) {
    throw new Error('Configuration file is not a valid JSON after secrets interpolation.');
  }

  return goJson.data;
};
