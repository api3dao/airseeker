import { references } from '@api3/airnode-protocol-v1';
import { CHAINS } from '@api3/chains';
import { ethers } from 'ethers';
import { z } from 'zod';

import packageJson from '../../package.json';

export const evmAddressSchema = z.string().regex(/^0x[\dA-Fa-f]{40}$/, 'Must be a valid EVM address');

export type EvmAddress = z.infer<typeof evmAddressSchema>;

export const evmIdSchema = z.string().regex(/^0x[\dA-Fa-f]{64}$/, 'Must be a valid EVM hash');

export type EvmId = z.infer<typeof evmIdSchema>;

export const providerSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export type Provider = z.infer<typeof providerSchema>;

export const optionalContractsSchema = z
  .object({
    // If unspecified, Api3ServerV1 will be loaded from "airnode-protocol-v1" or error out during validation.
    Api3ServerV1: evmAddressSchema.optional(),
    AirseekerRegistry: evmAddressSchema,
  })
  .strict();

// The contracts are guaraneteed to exist after the configuration is passed, but the inferred type would be optional so
// we create a new schema just to infer the type correctly.
const contractsSchema = optionalContractsSchema.required();

export type Contracts = z.infer<typeof contractsSchema>;

export const gasSettingsSchema = z
  .object({
    // TODO: Rename to baseGasPriceMultiplier and maxGasPriceMultiplier (when issue is fixed).
    recommendedGasPriceMultiplier: z.number().positive(),
    sanitizationSamplingWindow: z.number().positive(),
    sanitizationPercentile: z.number().positive(),
    scalingWindow: z.number().positive(),
    maxScalingMultiplier: z.number().positive(),
  })
  .superRefine((gasSettings, ctx) => {
    if (gasSettings.recommendedGasPriceMultiplier > gasSettings.maxScalingMultiplier) {
      ctx.addIssue({
        code: 'custom',
        message: 'recommendedGasPriceMultiplier must be less than or equal to maxScalingMultiplier.',
        path: ['recommendedGasPriceMultiplier'],
      });
    }
  });

export type GasSettings = z.infer<typeof gasSettingsSchema>;

// Contracts are optional. If unspecified, they will be loaded from "airnode-protocol-v1" or error out during
// validation. We need a chain ID from parent schema to load the contracts.
export const optionalChainSchema = z
  .object({
    alias: z.string().optional(), // By default, the chain alias is loaded from "@api3/chains" package
    providers: z.record(providerSchema), // The record key is the provider "nickname"
    contracts: optionalContractsSchema,
    gasSettings: gasSettingsSchema,
    dataFeedUpdateInterval: z.number().positive(),
    dataFeedBatchSize: z.number().positive(),
    fallbackGasLimit: z.number().positive().optional(),
  })
  .strict();

// The contracts are guaraneteed to exist after the configuration is passed, but the inferred type would be optional so
// we create a new schema just to infer the type correctly.
const chainSchema = optionalChainSchema
  .extend({
    alias: z.string(), // Will fallback to `unknown` in case there is no user provided value and no record in "@api3/chains"
    contracts: contractsSchema,
  })
  .strict();

export type Chain = z.infer<typeof chainSchema>;

// Ensure that the contracts are loaded from "airnode-protocol-v1" if not specified.
export const chainsSchema = z
  .record(optionalChainSchema)
  .superRefine((chains, ctx) => {
    if (Object.keys(chains).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Missing chains. At least one chain is required.',
        path: ['chains'],
      });
    }

    for (const [chainId, chain] of Object.entries(chains)) {
      if (Object.keys(chain.providers).length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Missing provider. At least one provider is required.',
          path: ['chains', chainId, 'providers'],
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
            contracts.Api3ServerV1 ?? references.Api3ServerV1[chainId as keyof typeof references.Api3ServerV1],
          AirseekerRegistry: contracts.AirseekerRegistry,
        });
        if (!parsedContracts.success) {
          ctx.addIssue({
            code: 'custom',
            message: 'Invalid contract addresses',
            // Show at least the first error.
            path: [chainId, 'contracts', ...parsedContracts.error.errors[0]!.path],
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
  .default(1) // Explicitly agreed to make this optional. See: https://github.com/api3dao/airseeker-v2/pull/20#issuecomment-1750856113.
  .superRefine((coefficient, ctx) => {
    // Check if the number has a maximum of two decimals
    const decimalCount = coefficient.toString().split('.')[1]?.length;
    if (decimalCount && decimalCount > 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid deviationThresholdCoefficient. A maximum of 2 decimals are supported.',
        path: ['deviationThresholdCoefficient'],
      });
    }
  });

export type DeviationThresholdCoefficient = z.infer<typeof deviationThresholdCoefficientSchema>;

export const walletDerivationTypeSchema = z.union([z.literal('self-funded'), z.literal('managed')]);

export type WalletDerivationType = z.infer<typeof walletDerivationTypeSchema>;

export const walletDerivationSchemeSchema = z
  .object({
    type: walletDerivationTypeSchema,
  })
  .strict();

export type WalletDerivationScheme = z.infer<typeof walletDerivationSchemeSchema>;

export const configSchema = z
  .object({
    sponsorWalletMnemonic: z
      .string()
      .refine((mnemonic) => ethers.Mnemonic.isValidMnemonic(mnemonic), 'Invalid mnemonic'),
    chains: chainsSchema,
    signedDataFetchInterval: z.number().positive(),
    deviationThresholdCoefficient: deviationThresholdCoefficientSchema,
    signedApiUrls: z.array(z.string().url()),
    walletDerivationScheme: walletDerivationSchemeSchema,
    stage: z
      .string()
      .regex(/^[\da-z-]{1,256}$/, 'Only lowercase letters, numbers and hyphens are allowed (max 256 characters)'),
    version: z.string().refine((version) => version === packageJson.version, 'Invalid Airseeker version'),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;
