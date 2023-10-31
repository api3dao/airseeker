import type { BigNumber } from 'ethers';

import type { Config } from '../config/schema';

export interface DataFeedValue {
  value: BigNumber;
  timestampMs: number;
}

interface GasState {
  gasPrices: { price: BigNumber; timestampMs: number }[];
  lastOnChainDataFeedValues: Record<string, DataFeedValue>;
}

type chainId = string;
type dapiName = string;

export interface State {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
  gasPriceStore: Record<string, Record<string, GasState>>;
  dynamicState: Record<
    dapiName,
    {
      dataFeed: string;
      signedApiUrls: string[];
      dataFeedValues: Record<chainId, { value: BigNumber; timestamp: number }>;
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
