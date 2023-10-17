import { Config } from '../config/schema';

type State = {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
};

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
