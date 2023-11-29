import { loadConfig } from './config';
import { startDataFetcherLoop } from './data-fetcher-loop';
import { logger } from './logger';
import { setInitialState } from './state';
import { startUpdateFeedsLoops } from './update-feeds-loops';

function main() {
  logger.info('Loading configuration and setting initial state');
  const config = loadConfig();
  setInitialState(config);

  logger.info('Starting Airseeker loops');
  startDataFetcherLoop();
  void startUpdateFeedsLoops();
}

main();
