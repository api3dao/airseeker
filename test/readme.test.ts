import * as nodeFsModule from 'node:fs';
import { join } from 'node:path';

import { isObject } from 'lodash';
import { z } from 'zod';

import { loadConfig } from '../src/config';

const actualFs = jest.requireActual<typeof import('node:fs')>('node:fs');

/*
 * Recursively extracts keys from an object.
 */
const extractKeys = (item: any): string[] =>
  isObject(item) ? [...Object.keys(item), ...Object.values(item).flatMap((element) => extractKeys(element))] : [];

jest.mock('node:fs');

describe('checks README', () => {
  it('checks that the README contains all configuration keys in airseeker.example.json', () => {
    const exampleConfigData = actualFs.readFileSync(join(__dirname, '../config/airseeker.example.json'));
    const exampleSecretsData = actualFs.readFileSync(join(__dirname, '../config/secrets.example.env'));
    const readmeData = actualFs.readFileSync(join(__dirname, '../config/configuration.md')).toString();

    expect(exampleConfigData).toBeDefined();
    expect(exampleSecretsData).toBeDefined();
    expect(readmeData).toBeDefined();

    const readFileSyncSpy = jest.spyOn(nodeFsModule, 'readFileSync');

    readFileSyncSpy.mockImplementationOnce(() => exampleConfigData);
    readFileSyncSpy.mockImplementationOnce(() => exampleSecretsData);

    const readmeHashtagTitles = readmeData
      .split('\n')
      .map((line) => /^#+ `(?<title>.+)`/.exec(line)?.groups?.title)
      .filter((title) => !!title);
    const readmeBacktickTitles = readmeData
      .split('\n')
      .map((line) => /^`(?<title>[^`]+)`/.exec(line)?.groups?.title)
      .filter((title) => !!title);
    const readmeTitles = [...readmeHashtagTitles, ...readmeBacktickTitles];

    const config = loadConfig();
    expect(config).toBeDefined();

    const missingKeys = extractKeys(config)
      .filter((item) => !z.coerce.number().safeParse(item).success)
      .filter((item) => item !== 'hardhat')
      .filter((key) => !readmeTitles.some((title) => title?.includes(key)));

    expect(missingKeys).toHaveLength(0);
  });
});
