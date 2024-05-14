import { addressSchema, hexSchema, keccak256HashSchema } from '@api3/commons';
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

export const signedApiResponseSchema = z.object({
  count: z.number().positive(),
  data: z.record(signedDataSchema),
});
