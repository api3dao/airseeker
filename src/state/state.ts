import type { Address, ChainId, Hex } from '@api3/commons';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type { SignedData } from '../types';

interface GasPriceInfo {
  price: bigint;
  timestamp: number;
}

export interface PendingTransactionInfo {
  // The timestamp of when we last detected that the feed requires an update. Note, that if the feed requires an update
  // consecutively, the timestamp is not updated until the feed stops being updatable again.
  firstUpdatableTimestamp: number;
  // The count of how many consecutive updates are required for this data feed. This is used to determine if the
  // transaction is a retry or not.
  consecutivelyUpdatableCount: number;
}

export interface State {
  config: Config;
  gasPrices: Record<ChainId, Record<string /* Provider name */, GasPriceInfo[]>>;
  pendingTransactionsInfo: Record<
    ChainId,
    Record<string /* Provider name */, Record<Address /* Sponsor wallet */, PendingTransactionInfo | null>>
  >;
  derivedSponsorWallets: Record<string /* dAPI name or data feed ID */, Hex /* Private key */>;
  signedDatas: Record<Hex /* Beacon ID */, SignedData>;
  signedApiUrls: Record<ChainId, Record<string /* Provider name */, string[]>>;
  // The timestamp of when the service was initialized. This can be treated as a "deployment" timestamp.
  deploymentTimestamp: string;
  activeDataFeedBeaconIds: Record<ChainId, Record<string /* Provider name */, Hex[]>>;
}

let state: State | undefined;

export const getState = (): State => {
  if (!state) {
    throw new Error('State is undefined.');
  }

  return state;
};

export const setInitialState = (config: Config) => {
  state = {
    config,
    gasPrices: {},
    pendingTransactionsInfo: {},
    signedDatas: {},
    signedApiUrls: {},
    derivedSponsorWallets: {},
    deploymentTimestamp: Math.floor(Date.now() / 1000).toString(),
    activeDataFeedBeaconIds: {},
  };
};

export const updateState = (updater: (draft: Draft<State>) => void) => {
  state = produce(getState(), updater);
};
