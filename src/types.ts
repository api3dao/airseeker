import { z } from 'zod';
import { EvmAddress, evmAddressSchema, EvmId, evmIdSchema } from './config/schema';

export type AirnodeAddress = EvmAddress;
export type TemplateId = EvmId;

// Taken from https://github.com/api3dao/signed-api/blob/main/packages/api/src/schema.ts
export const signedDataSchema = z.object({
  airnode: evmAddressSchema,
  templateId: evmIdSchema,
  // beaconId: evmIdSchema, // it is removed prior to tx to us | https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L94
  timestamp: z.string(),
  encodedValue: z.string(),
  signature: z.string(),
});

export type SignedData = z.infer<typeof signedDataSchema>;

export const signedApiResponseSchema = z.object({
  count: z.number().positive(),
  data: z.record(signedDataSchema),
});

export type LocalSignedData = Pick<SignedData, 'timestamp' | 'encodedValue' | 'signature'>;

export type DataStore = {
  init: () => Promise<void>;
  prune: () => Promise<void>;
  clear: () => Promise<void>;
  shutdown: () => Promise<void>;
  setStoreDataPoint: (signedData: SignedData) => Promise<void>;
  getStoreDataPoint: (airnode: AirnodeAddress, templateId: TemplateId) => Promise<LocalSignedData | undefined>;
};
