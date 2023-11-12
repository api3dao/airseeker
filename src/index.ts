import { loadConfig } from './config';
import { logger } from './logger';
import { runDataFetcher } from './signed-api-fetch';
import { setInitialState } from './state';
import { startUpdateFeedLoops } from './update-feeds';

function main() {
  logger.info('Loading configuration and setting initial state');
  const config = loadConfig();
  setInitialState(config);

  logger.info('Starting Airseeker loops');
  void runDataFetcher();
  void startUpdateFeedLoops();
}

main();
