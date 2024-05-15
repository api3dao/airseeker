import { type Hex, addressSchema, hexSchema, keccak256HashSchema } from '@api3/commons';
import { z } from 'zod';

// Taken from https://github.com/api3dao/signed-api/blob/main/packages/api/src/schema.ts
export const signedDataSchema = z.object({
  airnode: addressSchema,
  templateId: keccak256HashSchema,
  timestamp: z.string(),
  encodedValue: hexSchema,
  signature: hexSchema,
});

export type SignedData = z.infer<typeof signedDataSchema>;

const signedDataRecord = z.record(keccak256HashSchema, signedDataSchema);

export type SignedDataRecord = z.infer<typeof signedDataRecord>;

export const signedApiResponseSchema = z.object({
  count: z.number().positive(),
  data: signedDataRecord,
});

export type SignedDataRecordEntry = [Hex /* Beacon ID */, SignedData];
