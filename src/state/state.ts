import type { BigNumber } from 'ethers';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type {
  DapiName,
  PrivateKey,
  ChainId,
  SignedData,
  BeaconId,
  ProviderName,
  SignedApiUrl,
  AirnodeAddress,
} from '../types';

interface GasState {
  gasPrices: { price: BigNumber; timestampMs: number }[];
  sponsorLastUpdateTimestampMs: Record<string, number>;
}

export interface State {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
  gasPriceStore: Record<ChainId, Record<ProviderName, GasState>>;
  derivedSponsorWallets: Record<DapiName, PrivateKey>;
  signedApiStore: Record<BeaconId, SignedData>;
  signedApiUrlStore: Record<ChainId, Record<ProviderName, Record<AirnodeAddress, SignedApiUrl>>>;
}

type StateUpdater = (draft: Draft<State>) => void;

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
    gasPriceStore: {},
    signedApiStore: {},
    signedApiUrlStore: {},
    derivedSponsorWallets: {},
  };
};

export const updateState = (updater: StateUpdater) => {
  state = produce(getState(), updater);
};
