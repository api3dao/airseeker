import { loadConfig } from './config';
import { runDataFetcher } from './data-fetcher';
import { logger } from './logger';
import { setInitialState } from './state';
import { startUpdateFeedsLoops } from './update-feeds';

function main() {
  logger.info('Loading configuration and setting initial state');
  const config = loadConfig();
  setInitialState(config);

  logger.info('Starting Airseeker loops');
  void runDataFetcher();
  void startUpdateFeedsLoops();
}

main();
