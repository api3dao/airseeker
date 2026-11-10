import { type Hex, addressSchema, hexSchema, keccak256HashSchema } from '@api3/commons';
import { z } from 'zod';

// The on-chain contract stores timestamps as uint32, whose largest value has 10 digits.
const timestampSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,9})$/, 'Must be a non-negative integer timestamp of at most 10 digits');

// Taken from https://github.com/api3dao/signed-api/blob/8b4976a23ed1f5dc01011155e442c90d239bda38/packages/airnode-feed/src/validation/schema.ts#L326-L338
export const signedDataSchema = z.object({
  airnode: addressSchema,
  templateId: keccak256HashSchema,
  timestamp: timestampSchema,
  encodedValue: hexSchema,
  signature: hexSchema,
});

export type SignedData = z.infer<typeof signedDataSchema>;

const signedDataRecord = z.record(keccak256HashSchema, signedDataSchema);

export type SignedDataRecord = z.infer<typeof signedDataRecord>;

export const signedApiResponseSchema = z.object({
  count: z.number().nonnegative(),
  data: signedDataRecord,
});

export type SignedDataRecordEntry = [Hex /* Beacon ID */, SignedData];
