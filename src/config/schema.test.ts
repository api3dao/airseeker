import { readFileSync } from 'fs';
import { join } from 'path';
import { ZodError } from 'zod';
import dotenv from 'dotenv';
import { chainsSchema, configSchema } from './schema';
import { interpolateSecrets } from './utils';

it('validates example config', async () => {
  const exampleConfig = JSON.parse(readFileSync(join(__dirname, '../../config/airseeker.example.json'), 'utf8'));

  // The mnemonic is not interpolated (and thus invalid).
  await expect(configSchema.parseAsync(exampleConfig)).rejects.toEqual(
    new ZodError([
      {
        validation: 'url',
        code: 'invalid_string',
        message: 'Invalid url',
        path: ['chains', '31337', 'providers', 'hardhat', 'url'],
      },
      {
        code: 'custom',
        message: 'Invalid mnemonic',
        path: ['sponsorWalletMnemonic'],
      },
    ])
  );

  const exampleSecrets = dotenv.parse(readFileSync(join(__dirname, '../../config/secrets.example.env'), 'utf8'));
  await expect(configSchema.parseAsync(interpolateSecrets(exampleConfig, exampleSecrets))).resolves.toEqual(
    expect.any(Object)
  );
});

describe('chains schema', () => {
  it('uses the specified contract address', () => {
    const chains = {
      '31337': {
        contracts: {
          Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        },
        providers: {
          hardhat: {
            url: 'http://localhost:8545',
          },
        },
        __Temporary__DapiDataRegistry: {
          airnodeToSignedApiUrl: {},
          dataFeedIdToBeacons: {},
          activeDapiNames: [],
        },
      },
    };

    const parsed = chainsSchema.parse(chains);

    expect(parsed['31337']!.contracts).toEqual({
      Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    });
  });

  it('uses loads the contract address from airnode-protocol-v1', () => {
    const chains = {
      '1': {
        providers: {
          mainnet: {
            url: 'http://mainnet-url.com',
          },
        },
        __Temporary__DapiDataRegistry: {
          airnodeToSignedApiUrl: {},
          dataFeedIdToBeacons: {},
          activeDapiNames: [],
        },
      },
    };

    const parsed = chainsSchema.parse(chains);

    expect(parsed['1']!.contracts).toEqual({
      Api3ServerV1: '0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76',
    });
  });

  it('throws if the contract address cannot be loaded', () => {
    const chains = {
      '31337': {
        providers: {
          hardhat: {
            url: 'http://localhost:8545',
          },
        },
        __Temporary__DapiDataRegistry: {
          airnodeToSignedApiUrl: {},
          dataFeedIdToBeacons: {},
          activeDapiNames: [],
        },
      },
    };

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid contract addresses',
          path: ['chains', '31337', 'contracts'],
        },
      ])
    );
  });

  it('throws if the contract address is invalid', () => {
    const chains = {
      '31337': {
        contracts: {
          Api3ServerV1: '0xInvalid',
        },
        providers: {
          hardhat: {
            url: 'http://localhost:8545',
          },
        },
        __Temporary__DapiDataRegistry: {
          airnodeToSignedApiUrl: {},
          dataFeedIdToBeacons: {},
          activeDapiNames: [],
        },
      },
    };

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          validation: 'regex',
          code: 'invalid_string',
          message: 'Must be a valid EVM address',
          path: ['31337', 'contracts', 'Api3ServerV1'],
        },
      ])
    );
  });
});
