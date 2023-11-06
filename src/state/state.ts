import type { BigNumber } from 'ethers';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type { LocalSignedData, AirnodeAddress, TemplateId, DApiName } from '../types';

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
  derivedSponsorWallets: Record<DApiName, string>;
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
