import { randomBytes } from 'node:crypto';

import { type Wallet, ethers } from 'ethers';

import type { SignedData, Beacon } from '../src/types';

export const signData = async (signer: ethers.Signer, templateId: string, timestamp: string, data: string) =>
  signer.signMessage(
    ethers.getBytes(ethers.solidityPackedKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data]))
  );

export const generateRandomBytes32 = () => ethers.toBeHex(randomBytes(32).toString('hex'));

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
  airnodeWallet: Wallet,
  templateId: string,
  dataFeedTimestamp: string,
  apiValue = ethers.BigNumber.from(ethers.utils.randomBytes(Math.floor(Math.random() * 27) + 1)) // Fits into uint224.
): Promise<SignedData> => {
  const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['uint224'], [ethers.BigNumber.from(apiValue)]);
  const signature = await signData(airnodeWallet, templateId, dataFeedTimestamp, encodedValue);

  return { airnode: airnodeWallet.address, templateId, timestamp: dataFeedTimestamp, encodedValue, signature };
};
