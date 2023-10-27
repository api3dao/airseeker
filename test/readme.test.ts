import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { loadConfig } from '../src/config';

/*
 * Recursively extracts keys from an object.
 */
const extractKeys = (item: any): string[] =>
  typeof item === typeof {}
    ? [...Object.keys(item), ...Object.values(item).flatMap((element) => extractKeys(element))]
    : [];

describe('checks README', () => {
  it('checks that the README contains all configuration keys in airseeker.example.json', () => {
    const config = loadConfig(path.join(__dirname, '../config'), 'airseeker.example.json');
    expect(config).toBeDefined();

    const readmeData = readFileSync(path.join(__dirname, '../README.md')).toString();
    expect(readmeData).toBeDefined();

    // console.log(config);
    const keys = extractKeys(config).filter((item) => !z.coerce.number().safeParse(item).success);

    const missingKeys = keys.filter((key) => readmeData.includes(`\n#### ${key}`));

    // eslint-disable-next-line jest/no-conditional-in-test
    if (missingKeys.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `The following keys are present in airseeker.example.json, but not in the README:\n`,
        missingKeys.join(', ')
      );
    }

    expect(missingKeys).toHaveLength(0);
  });
});
