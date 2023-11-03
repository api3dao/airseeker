import { z } from 'zod';

import { type EvmAddress, evmAddressSchema, type EvmId, evmIdSchema } from './config/schema';

export type AirnodeAddress = EvmAddress;
export type TemplateId = EvmId;
export type DataFeedId = EvmId;
export type chainId = string;
export type DApiName = string;

// Taken from https://github.com/api3dao/signed-api/blob/main/packages/api/src/schema.ts
export const signedDataSchema = z.object({
  airnode: evmAddressSchema,
  templateId: evmIdSchema,
  timestamp: z.string(),
  encodedValue: z.string(),
  signature: z.string(),
});

export type SignedData = z.infer<typeof signedDataSchema>;

export const signedApiResponseSchema = z.object({
  count: z.number().positive(),
  data: z.record(signedDataSchema),
});

export type LocalSignedData = Pick<SignedData, 'encodedValue' | 'signature' | 'timestamp'>;

export interface DataFeedSingle {
  airnodeAddress: AirnodeAddress;
  templateId: TemplateId;
  dataFeedId: string;
}

export interface DecodedDataFeed {
  dataFeedId: string;
  dataFeeds: DataFeedSingle[];
}
