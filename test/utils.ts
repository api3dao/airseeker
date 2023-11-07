import { ethers } from 'ethers';

import type { Beacon } from '../src/types';

export const signData = async (signer: ethers.Signer, templateId: string, timestamp: string, data: string) =>
  signer.signMessage(
    ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data])
    )
  );

export const generateRandomBytes32 = () => ethers.utils.hexlify(ethers.utils.randomBytes(32));

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

export const encodeBeaconFeed = (dataFeed: Beacon) =>
  ethers.utils.defaultAbiCoder.encode(['address', 'bytes32'], [dataFeed.airnodeAddress, dataFeed.templateId]);

export const encodeBeaconFeedSet = (dataFeed: Beacon[]) =>
  ethers.utils.defaultAbiCoder.encode(
    ['address[]', 'bytes32[]'],
    [dataFeed.map((item) => item.airnodeAddress), dataFeed.map((item) => item.templateId)]
  );
