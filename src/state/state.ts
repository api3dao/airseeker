import type { BigNumber } from 'ethers';

import type { Config } from '../config/schema';

interface GasState {
  gasPrices: { price: BigNumber; timestampMs: number }[];
  sponsorLastUpdateTimestampMs: Record<string, number>;
}

export interface State {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
  gasPriceStore: Record<string, Record<string, GasState>>;
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
};
