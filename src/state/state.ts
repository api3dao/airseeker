import { cloneDeep } from 'lodash';
import { Config } from '../config/schema';

type State = {
  config: Config;
  dataFetcherInterval?: NodeJS.Timeout;
};

let state: State | undefined;

export const getState = (): State => cloneDeep(state)!;

export const setState = (newState: State) => {
  state = cloneDeep(newState);
};
