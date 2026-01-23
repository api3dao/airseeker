import { addressSchema } from '@api3/commons';
import { CHAINS, deploymentAddresses } from '@api3/contracts';
import { ethers } from 'ethers';
import { z } from 'zod';

import { version as packageVersion } from '../../package.json';

// eslint-disable-next-line unicorn/prefer-export-from
export { packageVersion as version };

export const providerSchema = z.strictObject({
  url: z.url(),
});

export type Provider = z.infer<typeof providerSchema>;

export const optionalContractsSchema = z.strictObject({
  // If unspecified, Api3ServerV1 will be loaded from the package @api3/contracts or error out during validation.
  Api3ServerV1: addressSchema.optional(),
  AirseekerRegistry: addressSchema,
});

// The contracts are guaraneteed to exist after the configuration is passed, but the inferred type would be optional so
// we create a new schema just to infer the type correctly.
const contractsSchema = optionalContractsSchema.required();

export type Contracts = z.infer<typeof contractsSchema>;

export const gasSettingsSchema = z
  .object({
    recommendedGasPriceMultiplier: z.number().positive(),
    sanitizationSamplingWindow: z.number().positive(),
    sanitizationPercentile: z.number().positive(),
    scalingWindow: z.number().positive(),
    maxScalingMultiplier: z.number().positive(),
    sanitizationMultiplier: z.number().positive(),
  })
  .superRefine((gasSettings, ctx) => {
    const { recommendedGasPriceMultiplier, maxScalingMultiplier, sanitizationPercentile } = gasSettings;
    if (recommendedGasPriceMultiplier > maxScalingMultiplier) {
      ctx.issues.push({
        code: 'custom',
        message: 'recommendedGasPriceMultiplier must be less than or equal to maxScalingMultiplier.',
        path: [], // No specific path since it's related to multiple fields
        input: {
          recommendedGasPriceMultiplier,
          maxScalingMultiplier,
        },
      });
    }

    if (sanitizationPercentile >= 100) {
      ctx.issues.push({
        code: 'custom',
        message: 'sanitizationPercentile must be less than 100.',
        path: ['sanitizationPercentile'],
        input: sanitizationPercentile,
      });
    }
  });

export type GasSettings = z.infer<typeof gasSettingsSchema>;

// Contracts are optional. If unspecified, they will be loaded from the package @api3/contracts or error out during
// validation. We need a chain ID from parent schema to load the contracts.
export const optionalChainSchema = z.strictObject({
  alias: z.string().optional(), // By default, the chain alias is loaded from "@api3/contracts" package
  providers: z.record(z.string(), providerSchema), // The record key is the provider "nickname"
  contracts: optionalContractsSchema,
  gasSettings: gasSettingsSchema,
  dataFeedUpdateInterval: z.number().positive(),
  dataFeedBatchSize: z.number().positive(),
  fallbackGasLimit: z.number().positive().optional(),
});

// The contracts are guaraneteed to exist after the configuration is passed, but the inferred type would be optional so
// we create a new schema just to infer the type correctly.
const chainSchema = optionalChainSchema
  .extend({
    alias: z.string(), // Will fallback to `unknown` in case there is no user provided value and no record in "@api3/contracts"
    contracts: contractsSchema,
  })
  .strict();

export type Chain = z.infer<typeof chainSchema>;

// Ensure that the contracts are loaded from the package @api3/contracts if not specified.
export const chainsSchema = z
  .record(z.string(), optionalChainSchema)
  .superRefine((chains, ctx) => {
    if (Object.keys(chains).length === 0) {
      ctx.issues.push({
        code: 'custom',
        message: 'Missing chains. At least one chain is required.',
        input: chains,
      });
    }

    for (const [chainId, chain] of Object.entries(chains)) {
      if (Object.keys(chain.providers).length === 0) {
        ctx.issues.push({
          code: 'custom',
          message: 'Missing provider. At least one provider is required.',
          path: [chainId, 'providers'],
          input: chain.providers,
        });
      }
    }
  })
  .transform((chains, ctx) => {
    return Object.fromEntries(
      Object.entries(chains).map(([chainId, chain]) => {
        const { contracts, alias } = chain;
        const parsedContracts = contractsSchema.safeParse({
          Api3ServerV1:
            contracts.Api3ServerV1 ??
            deploymentAddresses.Api3ServerV1[chainId as keyof typeof deploymentAddresses.Api3ServerV1],
          AirseekerRegistry:
            contracts.AirseekerRegistry ??
            deploymentAddresses.AirseekerRegistry[chainId as keyof typeof deploymentAddresses.AirseekerRegistry],
        });
        if (!parsedContracts.success) {
          ctx.issues.push({
            code: 'custom',
            message: 'Invalid contract addresses',
            path: [chainId, 'contracts'],
            input: contracts,
          });

          return z.NEVER;
        }

        return [
          chainId,
          {
            ...chain,
            alias: alias ?? CHAINS.find((c) => c.id === chainId)?.alias ?? 'unknown',
            contracts: parsedContracts.data,
          },
        ];
      })
    );
  });

export const deviationThresholdCoefficientSchema = z
  .number()
  .positive()
  .default(1) // Explicitly agreed to make this optional. See: https://github.com/api3dao/airseeker/pull/20#issuecomment-1750856113.
  .superRefine((coefficient, ctx) => {
    // Check if the number has a maximum of two decimals
    const decimalCount = coefficient.toString().split('.')[1]?.length;
    if (decimalCount && decimalCount > 2) {
      ctx.issues.push({
        code: 'custom',
        message: 'Invalid deviationThresholdCoefficient. A maximum of 2 decimals are supported.',
        input: coefficient,
      });
    }
  });

export type DeviationThresholdCoefficient = z.infer<typeof deviationThresholdCoefficientSchema>;

export const heartbeatIntervalModifierSchema = z.number().default(0);

export type HeartbeatIntervalModifier = z.infer<typeof heartbeatIntervalModifierSchema>;

export const individualBeaconUpdateSettingsSchema = z
  .object({
    deviationThresholdCoefficient: deviationThresholdCoefficientSchema,
    heartbeatIntervalModifier: heartbeatIntervalModifierSchema,
  })
  .nullable()
  .default(null);

export type IndividualBeaconUpdateSettings = z.infer<typeof individualBeaconUpdateSettingsSchema>;

export const sponsorWalletMnemonicSchema = z
  .string()
  .refine((mnemonic) => ethers.Mnemonic.isValidMnemonic(mnemonic), 'Invalid mnemonic');

export const walletDerivationSchemeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('self-funded'), sponsorWalletMnemonic: sponsorWalletMnemonicSchema }),
  z.strictObject({ type: z.literal('managed'), sponsorWalletMnemonic: sponsorWalletMnemonicSchema }),
  z.strictObject({
    type: z.literal('fixed'),
    sponsorAddress: addressSchema,
    sponsorWalletMnemonic: sponsorWalletMnemonicSchema,
  }),
  z.strictObject({ type: z.literal('keycard'), pin: z.string().optional() }),
]);

export type WalletDerivationScheme = z.infer<typeof walletDerivationSchemeSchema>;

export const configSchema = z.strictObject({
  chains: chainsSchema,
  deviationThresholdCoefficient: deviationThresholdCoefficientSchema,
  heartbeatIntervalModifier: heartbeatIntervalModifierSchema,
  individualBeaconUpdateSettings: individualBeaconUpdateSettingsSchema,
  signedApiUrls: z.array(z.url()),
  signedDataFetchInterval: z.number().positive(),
  stage: z
    .string()
    .regex(/^[\da-z-]{1,256}$/, 'Only lowercase letters, numbers and hyphens are allowed (max 256 characters)'),
  useSignedApiUrlsFromContract: z.boolean().default(true),
  version: z.string().refine((version) => version === packageVersion, 'Invalid Airseeker version'),
  walletDerivationScheme: walletDerivationSchemeSchema,
});

export type Config = z.infer<typeof configSchema>;
