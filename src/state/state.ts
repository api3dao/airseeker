import type { BigNumber } from 'ethers';

import type { Config } from '../config/schema';
import type { chainId, dapiName, DecodedDataFeed } from '../types';

export interface DataFeedValue {
  value: BigNumber;
  timestampMs: number;
}

export interface DataFeedOnChainValue {
  value: BigNumber;
  timestamp: number; // in seconds
}

interface GasState {
  gasPrices: { price: BigNumber; timestampMs: number }[];
  lastOnChainDataFeedValues: Record<string, DataFeedValue>;
}

export interface State {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
  gasPriceStore: Record<string, Record<string, GasState>>;
  dynamicState: Record<
    dapiName,
    {
      dataFeed: DecodedDataFeed;
      signedApiUrls: string[];
      dataFeedValues: Record<chainId, DataFeedOnChainValue>;
      updateParameters: Record<
        chainId,
        {
          deviationThresholdInPercentage: BigNumber;
          deviationReference: BigNumber;
          heartbeatInterval: number;
        }
      >;
    }
  >;
}

let state: State | undefined;

export const getState = (): State => {
  if (!state) {
    throw new Error('State is undefined.');
  }

  return state;
};

export const setState = (newState: State) => {
  state = newState;

  if (!state.dynamicState) {
    state.dynamicState = {};
  }
};
