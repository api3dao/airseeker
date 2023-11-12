import type { BigNumber } from 'ethers';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type {
  DapiName,
  PrivateKey,
  DecodedDataFeed,
  ChainId,
  SignedData,
  DataFeedId,
  ProviderName,
  SignedApiUrl,
  AirnodeAddress,
} from '../types';

interface GasState {
  gasPrices: { price: BigNumber; timestampMs: number }[];
  sponsorLastUpdateTimestampMs: Record<string, number>;
}

export interface DataFeedValue {
  value: BigNumber;
  timestamp: number;
}

export interface DapiState {
  dataFeed: DecodedDataFeed;
  dataFeedValues: Record<ChainId, DataFeedValue>;
  updateParameters: Record<ChainId, UpdateParameters>;
}

export interface UpdateParameters {
  deviationThresholdInPercentage: BigNumber;
  deviationReference: BigNumber;
  heartbeatInterval: number;
}

export interface State {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
  gasPriceStore: Record<ChainId, Record<ProviderName, GasState>>;
  derivedSponsorWallets: Record<DapiName, PrivateKey>;
  signedApiStore: Record<DataFeedId, SignedData>;
  signedApiUrlStore: Record<ChainId, Record<ProviderName, Record<AirnodeAddress, SignedApiUrl>>>;
  dapis: Record<DapiName, DapiState>;
}

type StateUpdater = (draft: Draft<State>) => void;

let state: State | undefined;

export const getState = (): State => {
  if (!state) {
    throw new Error('State is undefined.');
  }

  return state;
};

export const setState = (newState: State) => {
  state = newState;
};

export const setInitialState = (config: Config) => {
  state = {
    config,
    gasPriceStore: {},
    signedApiStore: {},
    signedApiUrlStore: {},
    derivedSponsorWallets: {},
    dapis: {},
  };
};

export const updateState = (updater: StateUpdater) => {
  setState(produce(getState(), updater));
};
