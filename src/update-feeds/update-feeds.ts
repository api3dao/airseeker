import { go } from '@api3/promise-utils';
import { range, size } from 'lodash';

import type { Chain } from '../config/schema';
import { logger } from '../logger';
import { getState } from '../state';
import { isFulfilled, sleep } from '../utils';

import { type ActiveDapisBatch, getStaticActiveDapis } from './temporary-contract-mock';

export const startUpdateFeedLoops = async () => {
  const state = getState();
  const {
    config: { chains },
  } = state;

  // Start update loops for each chain in parallel.
  await Promise.all(
    Object.entries(chains).map(async ([chainId, chain]) => {
      const { dataFeedUpdateInterval, providers } = chain;

      // Calculate the stagger time for each provider on the same chain to maximize transaction throughput and update
      // frequency.
      const staggerTime = (dataFeedUpdateInterval / size(providers)) * 1000;
      logger.debug(`Starting update loops for chain`, { chainId, staggerTime, providerNames: Object.keys(providers) });

      for (const providerName of Object.keys(providers)) {
        logger.debug(`Starting update feed loop`, { chainId, providerName });
        setInterval(async () => runUpdateFeed(providerName, chain, chainId), dataFeedUpdateInterval * 1000);

        await sleep(staggerTime);
      }
    })
  );
};

export const runUpdateFeed = async (providerName: string, chain: Chain, chainId: string) => {
  const { dataFeedBatchSize, dataFeedUpdateInterval } = chain;
  // TODO: Consider adding a start timestamp (as ID) to the logs to identify batches from this runUpdateFeed tick.
  const baseLogContext = { chainId, providerName };

  logger.debug(`Fetching first batch of dAPIs batches`, baseLogContext);
  const firstBatchStartTime = Date.now();
  const goFirstBatch = await go(async () => getActiveDapiBatch(chain));
  if (!goFirstBatch.success) {
    logger.error(`Failed to get first active dAPIs batch`, goFirstBatch.error, baseLogContext);
    return;
  }
  const processFirstBatchPromise = processBatch(goFirstBatch.data);

  // Calculate the stagger time between the rest of the batches.
  const batchesCount = goFirstBatch.data.totalCount / dataFeedBatchSize;
  const staggerTime = batchesCount <= 1 ? 0 : (dataFeedUpdateInterval / batchesCount) * 1000;

  // Wait the remaining stagger time required after fetching the first batch.
  const firstBatchDuration = Date.now() - firstBatchStartTime;
  await sleep(Math.max(0, staggerTime - firstBatchDuration));

  // Fetch the rest of the batches in parallel in a staggered way.
  logger.debug('Fetching batches of active dAPIs', { batchesCount, staggerTime, ...baseLogContext });
  const otherBatches = await Promise.allSettled(
    range(1, batchesCount).map(async (batchIndex) => {
      await sleep((batchIndex - 1) * staggerTime);

      logger.debug(`Fetching batch of active dAPIs`, { batchIndex, ...baseLogContext });
      return getActiveDapiBatch(chain, batchIndex * dataFeedBatchSize);
    })
  );
  for (const batch of otherBatches.filter((batch) => !isFulfilled(batch))) {
    logger.error(`Failed to get active dAPIs batch`, (batch as PromiseRejectedResult).reason, baseLogContext);
  }
  const processOtherBatchesPromises = otherBatches
    .filter((result) => isFulfilled(result))
    .map(async (result) => processBatch((result as PromiseFulfilledResult<ActiveDapisBatch>).value));

  // Wait for all the batches to be processed.
  //
  // TODO: Consider returning some information (success/error) and log some statistics (e.g. how many dAPIs were
  // updated, etc...).
  await Promise.all([processFirstBatchPromise, ...processOtherBatchesPromises]);
};

export const processBatch = async (_batch: ActiveDapisBatch) => {
  // TODO: Implement.
};

export const getActiveDapiBatch = async (chain: Chain, offset = 0) => {
  const { dataFeedBatchSize } = chain;

  return getStaticActiveDapis(offset, dataFeedBatchSize);
};
