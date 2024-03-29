import * as path from 'path';
import { logger } from './logging';
import { loadConfig } from './config';
import { initiateFetchingBeaconData } from './fetch-beacon-data';
import { initiateDataFeedUpdates } from './update-data-feeds';
import { initializeProviders } from './providers';
import { filterSponsorWallets, initializeWallets } from './wallets';
import { expireLimiterJobs, initializeState, updateState } from './state';

export const handleStopSignal = (signal: string) => {
  logger.info(`Signal ${signal} received`);
  logger.info('Stopping Airseeker gracefully...');

  expireLimiterJobs();
  updateState((state) => ({ ...state, stopSignalReceived: true }));
};

export async function main() {
  const config = loadConfig(path.join(__dirname, '..', 'config', 'airseeker.json'), process.env);
  initializeState(config);

  // TODO Remove
  // We do it after initializeState because logger facilities aren't available before initializeState
  process.on('SIGINT', handleStopSignal); // CTRL+C
  process.on('SIGTERM', handleStopSignal);

  process.on('exit', () => {
    logger.info('Airseeker has quit.');
  });

  initializeProviders();
  initializeWallets();
  await filterSponsorWallets();
  await Promise.all([initiateFetchingBeaconData(), initiateDataFeedUpdates()]);
}
