import { loadConfig } from './config';
import { startDataFetcherLoop } from './data-fetcher-loop';
import { initializeVerifierPool } from './data-fetcher-loop/signed-data-verifier-pool';
import { loadEnv } from './env/env';
import { startHeartbeatLoop } from './heartbeat-loop';
import { initializeKeycardWallet, terminateKeycardWallet } from './keycard';
import { logger } from './logger';
import { setInitialState } from './state';
import { startUpdateFeedsLoops } from './update-feeds-loops';

const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down.`);
  terminateKeycardWallet();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const main = async () => {
  logger.info('Loading configuration and setting initial state.');
  const config = loadConfig();
  setInitialState(config);
  initializeVerifierPool();

  if (config.walletDerivationScheme.type === 'keycard') {
    logger.info('Initializing keycard wallet.');
    await initializeKeycardWallet();
  }

  logger.info('Starting Airseeker loops.');
  startDataFetcherLoop();
  void startUpdateFeedsLoops();
  const env = loadEnv();
  if (env.LOG_HEARTBEAT) startHeartbeatLoop();
};

main().catch((error: Error) => {
  logger.error('Failed to start Airseeker.', error);
  process.exit(1);
});
