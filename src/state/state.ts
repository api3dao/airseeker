import type { BigNumber } from 'ethers';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type { chainId, dapiName, DecodedDataFeed, DataFeedId, SignedData } from '../types';

interface GasState {
  gasPrices: { price: BigNumber; timestampMs: number }[];
  sponsorLastUpdateTimestampMs: Record<string, number>;
}

export interface DataFeedOnChainValue {
  value: BigNumber;
  timestamp: number; // in seconds
}

export interface DApi {
  dataFeed: DecodedDataFeed;
  dataFeedValues: Record<chainId, DataFeedOnChainValue>;
  updateParameters: Record<chainId, UpdateParameters>;
}

export interface UpdateParameters {
  deviationThresholdInPercentage: BigNumber;
  deviationReference: BigNumber;
  heartbeatInterval: number;
}

export interface State {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
  gasPriceStore: Record<string, Record<string, GasState>>;
  signedApiStore: Record<DataFeedId, SignedData>;
  signedApiUrlStore: { url: string; lastReceived: number }[];
  dapis: Record<dapiName, DApi>;
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

  if (!state.dapis) {
    state.dapis = {};
  }
};

export const updateState = (updater: StateUpdater) => {
  setState(produce(getState(), updater));
};
