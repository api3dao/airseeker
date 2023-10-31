import type { BigNumber } from 'ethers';

import type { Config } from '../config/schema';
import type { LocalSignedData, AirnodeAddress, TemplateId } from '../types';

interface GasState {
  gasPrices: { price: BigNumber; timestampMs: number }[];
  sponsorLastUpdateTimestampMs: Record<string, number>;
}

export interface State {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
  gasPriceStore: Record<string, Record<string, GasState>>;
  signedApiStore: Record<AirnodeAddress, Record<TemplateId, LocalSignedData>>;
  signedApiUrlStore: Record<string, Record<AirnodeAddress, string>>;
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
