import type { BigNumber } from 'ethers';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type { ChainId, DApiName, DecodedDataFeed, DataFeedId, SignedData } from '../types';

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
  gasPriceStore: Record<string, Record<string, GasState>>;
  signedApiStore: Record<DataFeedId, SignedData>;
  signedApiUrlStore: string[];
  dapis: Record<DApiName, DapiState>;
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

export const updateState = (updater: StateUpdater) => {
  setState(produce(getState(), updater));
};
