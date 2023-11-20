import { loadConfig } from './config';
import { logger } from './logger';
import { runDataFetcher } from './signed-api-fetch';
import { setInitialState } from './state';
import { startUpdateFeedsLoops } from './update-feeds';

const main = () => {
  logger.info('Loading configuration and setting initial state');
  const config = loadConfig();
  setInitialState(config);

  logger.info('Starting Airseeker loops');
  // void benchmarkProviders();
  void runDataFetcher();
  void startUpdateFeedsLoops();
};

main();
