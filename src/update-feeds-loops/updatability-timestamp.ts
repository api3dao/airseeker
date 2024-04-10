import type { Address } from '@api3/commons';

import { getState, updateState } from '../state';

export const isAlreadyUpdatable = (chainId: string, providerName: string, sponsorWalletAddress: Address) => {
  const firstExceededDeviationTimestamp =
    getState().firstMarkedUpdatableTimestamps[chainId]![providerName]![sponsorWalletAddress];

  return !!firstExceededDeviationTimestamp;
};

export const initializeFirstMarkedUpdateableTimestamp = (chainId: string, providerName: string) =>
  updateState((draft) => {
    if (!draft.firstMarkedUpdatableTimestamps[chainId]) draft.firstMarkedUpdatableTimestamps[chainId] = {};
    draft.firstMarkedUpdatableTimestamps[chainId]![providerName] = {};
  });

export const setFirstMarkedUpdatableTimestamp = (
  chainId: string,
  providerName: string,
  sponsorWalletAddress: Address,
  timestamp: number
) => {
  updateState((draft) => {
    draft.firstMarkedUpdatableTimestamps[chainId]![providerName]![sponsorWalletAddress] = timestamp;
  });
};

export const clearFirstMarkedUpdatableTimestamp = (
  chainId: string,
  providerName: string,
  sponsorWalletAddress: Address
) =>
  updateState((draft) => {
    const exceededDeviationTimestamps = draft.firstMarkedUpdatableTimestamps[chainId]![providerName]!;
    if (exceededDeviationTimestamps[sponsorWalletAddress]) {
      exceededDeviationTimestamps[sponsorWalletAddress] = null;
    }
  });
