import { addressSchema, hexSchema, keccak256HashSchema } from '@api3/commons';
import { z } from 'zod';
import { WalletDerivationScheme } from './config/schema';

// Taken from https://github.com/api3dao/signed-api/blob/main/packages/api/src/schema.ts
export const signedDataSchema = z.object({
  airnode: addressSchema,
  templateId: keccak256HashSchema,
  timestamp: z.string(),
  encodedValue: hexSchema,
  signature: hexSchema,
});

export type SignedData = z.infer<typeof signedDataSchema>;

export const signedApiResponseSchema = z.object({
  count: z.number().positive(),
  data: z.record(signedDataSchema),
});

interface BaseParams {
  dapiNameOrDataFeedId: string;
  updateParameters: string;
}

export type SelfFundedParams = {
  walletDerivationScheme: WalletDerivationScheme;
} & BaseParams;

export type ManagedParams = {
  walletDerivationScheme: WalletDerivationScheme;
  dapiNameOrDataFeedId: string;
} & Omit<BaseParams, 'updateParameters'>;

export type FixedParams = {
  walletDerivationScheme: WalletDerivationScheme;
};

export type SponsorParams = SelfFundedParams | ManagedParams | FixedParams;
