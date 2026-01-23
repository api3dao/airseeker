import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { interpolateSecretsIntoConfig } from '@api3/commons';
import dotenv from 'dotenv';
import { ZodError } from 'zod';

import {
  chainsSchema,
  configSchema,
  deviationThresholdCoefficientSchema,
  individualBeaconUpdateSettingsSchema,
  walletDerivationSchemeSchema,
} from './schema';

const gasSettings = {
  recommendedGasPriceMultiplier: 1.5,
  sanitizationSamplingWindow: 900,
  sanitizationPercentile: 80,
  scalingWindow: 120,
  maxScalingMultiplier: 2,
  sanitizationMultiplier: 3,
};

test('validates example config', () => {
  const exampleConfig = JSON.parse(readFileSync(join(__dirname, '../../config/airseeker.example.json'), 'utf8'));

  // The mnemonic is not interpolated (and thus invalid).
  expect(() => configSchema.parse(exampleConfig)).toThrow(
    new ZodError([
      {
        code: 'invalid_format',
        format: 'url',
        path: ['chains', '31337', 'providers', 'hardhat', 'url'],
        message: 'Invalid URL',
      },
      {
        code: 'custom',
        path: ['walletDerivationScheme', 'sponsorWalletMnemonic'],
        message: 'Invalid mnemonic',
      },
    ])
  );

  const exampleSecrets = dotenv.parse(readFileSync(join(__dirname, '../../config/secrets.example.env'), 'utf8'));

  expect(configSchema.parse(interpolateSecretsIntoConfig(exampleConfig, exampleSecrets))).toStrictEqual(
    expect.any(Object)
  );
});

describe('chains schema', () => {
  it('uses the specified contract address', () => {
    const chains = {
      '31337': {
        contracts: {
          Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
        providers: {
          hardhat: {
            url: 'http://localhost:8545',
          },
        },
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
      },
    };

    const parsed = chainsSchema.parse(chains);

    expect(parsed['31337']!.contracts).toStrictEqual({
      Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    });
  });

  it('uses the contract address from the package @api3/contracts', () => {
    const chains = {
      '1': {
        providers: {
          mainnet: {
            url: 'http://mainnet-url.com',
          },
        },
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
        contracts: {
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
      },
    };

    const parsed = chainsSchema.parse(chains);

    expect(parsed['1']!.contracts).toStrictEqual({
      Api3ServerV1: '0x709944a48cAf83535e43471680fDA4905FB3920a',
      AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
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
        contracts: {
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
      },
    };

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid contract addresses',
          path: ['31337', 'contracts'],
        },
      ])
    );
  });

  it('throws if the contract address is invalid', () => {
    const chains = {
      '31337': {
        contracts: {
          Api3ServerV1: '0xInvalid',
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
        providers: {
          hardhat: {
            url: 'http://localhost:8545',
          },
        },
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
      },
    };

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid EVM address',
          path: ['31337', 'contracts', 'Api3ServerV1'],
        },
      ])
    );
  });

  it('requires at least 1 chain', () => {
    const chains = {};

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Missing chains. At least one chain is required.',
          path: [],
        },
      ])
    );
  });

  it('requires at least 1 provider', () => {
    const chains = {
      '31337': {
        contracts: {
          Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
        providers: {},
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
      },
    };

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Missing provider. At least one provider is required.',
          path: ['31337', 'providers'],
        },
      ])
    );
  });

  it('throws on deviationThresholdCoefficient with too many decimals', () => {
    expect(() => deviationThresholdCoefficientSchema.parse(1.234)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid deviationThresholdCoefficient. A maximum of 2 decimals are supported.',
          path: [],
        },
      ])
    );
  });

  it('parses valid individualBeaconUpdateSettings', () => {
    const settings = {
      deviationThresholdCoefficient: 5.5,
      heartbeatIntervalModifier: 0,
    };
    expect(individualBeaconUpdateSettingsSchema.parse(settings)).toStrictEqual(settings);
  });

  it('defaults individualBeaconUpdateSettings.deviationThresholdCoefficient to 1', () => {
    const settings = {
      heartbeatIntervalModifier: 0,
    };
    expect(individualBeaconUpdateSettingsSchema.parse(settings)).toStrictEqual({
      deviationThresholdCoefficient: 1,
      heartbeatIntervalModifier: 0,
    });
  });

  it('defaults individualBeaconUpdateSettings.heartbeatIntervalModifier to 0', () => {
    const settings = {
      deviationThresholdCoefficient: 1,
    };
    expect(individualBeaconUpdateSettingsSchema.parse(settings)).toStrictEqual({
      deviationThresholdCoefficient: 1,
      heartbeatIntervalModifier: 0,
    });
  });

  it('allows null value as default', () => {
    expect(individualBeaconUpdateSettingsSchema.parse(null)).toBeNull();
  });
});

describe('walletDerivationScheme schema', () => {
  it('parses the walletDerivationScheme as "fixed"', () => {
    const walletDerivationScheme = {
      type: 'fixed',
      sponsorAddress: '0x0000000000000000000000000000000000000001',
      sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
    };
    const parsed = walletDerivationSchemeSchema.parse(walletDerivationScheme);

    expect(parsed).toStrictEqual(walletDerivationScheme);
  });

  it('parses the walletDerivationScheme as "self-funded"', () => {
    const walletDerivationScheme = {
      type: 'self-funded',
      sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
    };
    const parsed = walletDerivationSchemeSchema.parse(walletDerivationScheme);

    expect(parsed).toStrictEqual(walletDerivationScheme);
  });

  it('parses the walletDerivationScheme as "managed"', () => {
    const walletDerivationScheme = {
      type: 'managed',
      sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
    };
    const parsed = walletDerivationSchemeSchema.parse(walletDerivationScheme);

    expect(parsed).toStrictEqual(walletDerivationScheme);
  });

  it('parses the walletDerivationScheme as "keycard"', () => {
    const walletDerivationScheme = {
      type: 'keycard',
      pin: '123456',
    };
    const parsed = walletDerivationSchemeSchema.parse(walletDerivationScheme);

    expect(parsed).toStrictEqual(walletDerivationScheme);
  });

  it('parses the walletDerivationScheme as "keycard" without pin', () => {
    const walletDerivationScheme = {
      type: 'keycard',
    };
    const parsed = walletDerivationSchemeSchema.parse(walletDerivationScheme);

    expect(parsed).toStrictEqual(walletDerivationScheme);
  });

  it('throws when sponsorWalletMnemonic is missing for self-funded type', () => {
    const walletDerivationScheme = {
      type: 'self-funded',
    };

    expect(() => walletDerivationSchemeSchema.parse(walletDerivationScheme)).toThrow(
      new ZodError([
        {
          expected: 'string',
          code: 'invalid_type',
          path: ['sponsorWalletMnemonic'],
          message: 'Invalid input: expected string, received undefined',
        },
      ])
    );
  });

  it('throws when sponsorWalletMnemonic is missing for managed type', () => {
    const walletDerivationScheme = {
      type: 'managed',
    };

    expect(() => walletDerivationSchemeSchema.parse(walletDerivationScheme)).toThrow(
      new ZodError([
        {
          expected: 'string',
          code: 'invalid_type',
          path: ['sponsorWalletMnemonic'],
          message: 'Invalid input: expected string, received undefined',
        },
      ])
    );
  });

  it('throws when sponsorAddress is missing for fixed type', () => {
    const walletDerivationScheme = {
      type: 'fixed',
      sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
    };

    expect(() => walletDerivationSchemeSchema.parse(walletDerivationScheme)).toThrow(
      new ZodError([
        {
          expected: 'string',
          code: 'invalid_type',
          path: ['sponsorAddress'],
          message: 'Invalid input: expected string, received undefined',
        },
      ])
    );
  });

  it('throws when sponsorAddress is not a valid EVM address for fixed type', () => {
    const walletDerivationScheme = {
      type: 'fixed',
      sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
    };

    expect(() => walletDerivationSchemeSchema.parse({ ...walletDerivationScheme, sponsorAddress: '' })).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid EVM address',
          path: ['sponsorAddress'],
        },
      ])
    );
    expect(() =>
      walletDerivationSchemeSchema.parse({ ...walletDerivationScheme, sponsorAddress: '0xinvalid' })
    ).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid EVM address',
          path: ['sponsorAddress'],
        },
      ])
    );
  });
});
