import { goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { HUNDRED_PERCENT } from './constants';
import type { Beacon } from './types';

export const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isFulfilled<T>(item: PromiseSettledResult<T>): item is PromiseFulfilledResult<T> {
  return item.status === 'fulfilled';
}

export function deriveBeaconId(airnodeAddress: string, templateId: string) {
  return goSync(() => ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnodeAddress, templateId])).data;
}

export function deriveBeaconSetId(beaconIds: string[]) {
  return goSync(() => ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds]))).data;
}

export const encodeBeaconSetFeed = (dataFeed: Beacon[]) =>
  deriveBeaconSetId(dataFeed.map((item) => deriveBeaconId(item.airnodeAddress, item.templateId)!));

export const getDeviationThresholdAsBigNumber = (input: number) =>
  ethers.BigNumber.from(Math.trunc(input * HUNDRED_PERCENT)).div(ethers.BigNumber.from(100));
