import { randomBytes } from 'node:crypto';

import type { Address, Hex } from '@api3/commons';
import { ethers, type HDNodeWallet } from 'ethers';

import { verifySignedData } from '../src/data-fetcher-loop/signed-data-verifier';
import type { getVerifier } from '../src/data-fetcher-loop/signed-data-verifier-pool';
import type { SignedData, SignedDataRecordEntry } from '../src/types';
import type { Beacon } from '../src/update-feeds-loops/contracts';
import { encodeBeaconValue } from '../src/utils';

export const signData = async (signer: ethers.Signer, templateId: string, timestamp: string, data: string) =>
  signer.signMessage(
    ethers.getBytes(ethers.solidityPackedKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data]))
  ) as Promise<Hex>;

export const generateRandomBytes = (length: number): Hex => `0x${randomBytes(length).toString('hex')}`;

export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/**
 * A helper functions which accepts a deeply partial object and casts it to a given (non-partial) type. This makes it
 * convenient to create a mocked data object with properties that are only used for the given test.
 */
export const allowPartial = <T = unknown>(obj: DeepPartial<T>): T => obj as T;

export const encodeBeaconDetails = (dataFeed: Beacon) =>
  ethers.AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [dataFeed.airnodeAddress, dataFeed.templateId]);

export const encodeBeaconSetDetails = (dataFeed: Beacon[]) =>
  ethers.AbiCoder.defaultAbiCoder().encode(
    ['address[]', 'bytes32[]'],
    [dataFeed.map((item) => item.airnodeAddress), dataFeed.map((item) => item.templateId)]
  );

export const generateSignedData = async (
  airnodeWallet: HDNodeWallet,
  templateId: Hex,
  dataFeedTimestamp: string,
  apiValue = BigInt(generateRandomBytes(Math.floor(Math.random() * 27) + 1)) // Fits into uint224.
): Promise<SignedData> => {
  const encodedValue = encodeBeaconValue(apiValue);
  const signature = await signData(airnodeWallet, templateId, dataFeedTimestamp, encodedValue);

  return {
    airnode: airnodeWallet.address as Address,
    templateId,
    timestamp: dataFeedTimestamp,
    encodedValue,
    signature,
  };
};

export const createMockSignedDataVerifier = () => {
  return {
    verifySignedData: async (signedDataBatch: SignedDataRecordEntry[]) => verifySignedData(signedDataBatch),
  } as unknown as Awaited<ReturnType<typeof getVerifier>>;
};
