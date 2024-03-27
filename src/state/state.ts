import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type {
  PrivateKey,
  ChainId,
  SignedData,
  BeaconId,
  ProviderName,
  SignedApiUrl,
  DapiNameOrDataFeedId,
} from '../types';

interface GasState {
  gasPrices: { price: bigint; timestamp: number }[];
  sponsorLastUpdateTimestamp: Record<string, number>;
}

export interface State {
  config: Config;
  gasPrices: Record<ChainId, Record<ProviderName, GasState>>;
  derivedSponsorWallets: Record<DapiNameOrDataFeedId, PrivateKey>;
  signedDatas: Record<BeaconId, SignedData>;
  signedApiUrls: Record<ChainId, Record<ProviderName, SignedApiUrl[]>>;
  // The timestamp of when the service was initialized. This can be treated as a "deployment" timestamp.
  deploymentTimestamp: string;
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
    signedDatas: {},
    signedApiUrls: {},
    derivedSponsorWallets: {},
    deploymentTimestamp: Math.floor(Date.now() / 1000).toString(),
  };
};

export const updateState = (updater: (draft: Draft<State>) => void) => {
  state = produce(getState(), updater);
};
