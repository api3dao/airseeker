import { go } from '@api3/promise-utils';
import { BigNumber, ethers } from 'ethers';
import { chunk, groupBy, range, size, sortBy } from 'lodash';

import { checkUpdateConditions } from '../condition-check';
import type { Chain } from '../config/schema';
import { FEEDS_TO_UPDATE_CHUNK_SIZE, SIGNED_URL_EXPIRY_IN_MINUTES } from '../constants';
import { logger } from '../logger';
import { getStoreDataPoint } from '../signed-data-store';
import { getState, updateState, type UrlSet } from '../state';
import { isFulfilled, sleep } from '../utils';

import {
  getDapiDataRegistry,
  type ReadDapiWithIndexResponse,
  verifyMulticallResponse,
  decodeReadDapiWithIndexResponse,
  decodeDapisCountResponse,
} from './dapi-data-registry';

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

export type ReadDapiWithIndexResponsesAndChainId = (ReadDapiWithIndexResponse & {
  chainId: string;
})[];

export const runUpdateFeed = async (providerName: string, chain: Chain, chainId: string) => {
  await logger.runWithContext({ chainId, providerName, coordinatorTimestampMs: Date.now().toString() }, async () => {
    const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts } = chain;

    // Create a provider and connect it to the DapiDataRegistry contract.
    const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);
    const dapiDataRegistry = getDapiDataRegistry(contracts.DapiDataRegistry, provider);

    logger.debug(`Fetching first batch of dAPIs batches`);
    const firstBatchStartTime = Date.now();
    const goFirstBatch = await go(async () => {
      const dapisCountCall = dapiDataRegistry.interface.encodeFunctionData('dapisCount');
      const readDapiWithIndexCalls = range(0, dataFeedBatchSize).map((dapiIndex) =>
        dapiDataRegistry.interface.encodeFunctionData('readDapiWithIndex', [dapiIndex])
      );
      const [dapisCountReturndata, ...readDapiWithIndexCallsReturndata] = verifyMulticallResponse(
        await dapiDataRegistry.callStatic.tryMulticall([dapisCountCall, ...readDapiWithIndexCalls])
      );

      const dapisCount = decodeDapisCountResponse(dapiDataRegistry, dapisCountReturndata!);
      const firstBatch = readDapiWithIndexCallsReturndata
        .map((dapiReturndata) => ({ ...decodeReadDapiWithIndexResponse(dapiDataRegistry, dapiReturndata), chainId }))
        // Because the dapisCount is not known during the multicall, we may ask for non-existent dAPIs. These should be filtered out.
        .slice(0, dapisCount);
      return {
        firstBatch,
        dapisCount,
      };
    });
    if (!goFirstBatch.success) {
      logger.error(`Failed to get first active dAPIs batch`, goFirstBatch.error);
      return;
    }
    const { firstBatch, dapisCount } = goFirstBatch.data;
    const processFirstBatchPromise = processBatch(firstBatch);

    // Calculate the stagger time between the rest of the batches.
    const batchesCount = Math.ceil(dapisCount / dataFeedBatchSize);
    const staggerTime = batchesCount <= 1 ? 0 : (dataFeedUpdateInterval / batchesCount) * 1000;

    // Wait the remaining stagger time required after fetching the first batch.
    const firstBatchDuration = Date.now() - firstBatchStartTime;
    await sleep(Math.max(0, staggerTime - firstBatchDuration));

    // Fetch the rest of the batches in parallel in a staggered way.
    if (batchesCount > 1) {
      logger.debug('Fetching batches of active dAPIs', { batchesCount, staggerTime });
    }
    const otherBatches = await Promise.allSettled(
      range(1, batchesCount).map(async (batchIndex) => {
        await sleep((batchIndex - 1) * staggerTime);

        logger.debug(`Fetching batch of active dAPIs`, { batchIndex });
        const dapiBatchIndexStart = batchIndex * dataFeedBatchSize;
        const dapiBatchIndexEnd = Math.min(dapisCount, dapiBatchIndexStart + dataFeedBatchSize);
        const readDapiWithIndexCalls = range(dapiBatchIndexStart, dapiBatchIndexEnd).map((dapiIndex) =>
          dapiDataRegistry.interface.encodeFunctionData('readDapiWithIndex', [dapiIndex])
        );
        const returndata = verifyMulticallResponse(
          await dapiDataRegistry.callStatic.tryMulticall(readDapiWithIndexCalls)
        );

        const decodedBatch = returndata.map((returndata) => ({
          ...decodeReadDapiWithIndexResponse(dapiDataRegistry, returndata),
          chainId,
        }));
        return decodedBatch;
      })
    );
    for (const batch of otherBatches.filter((batch) => !isFulfilled(batch))) {
      logger.error(`Failed to get active dAPIs batch`, (batch as PromiseRejectedResult).reason);
    }
    const processOtherBatchesPromises = otherBatches
      .filter((result) => isFulfilled(result))
      .map(async (result) =>
        processBatch((result as PromiseFulfilledResult<ReadDapiWithIndexResponsesAndChainId>).value)
      );

    // Wait for all the batches to be processed.
    //
    // TODO: Consider returning some information (success/error) and log some statistics (e.g. how many dAPIs were
    // updated, etc...).
    await Promise.all([processFirstBatchPromise, ...processOtherBatchesPromises]);
  });
};

export const mergeUrls = (receivedUrls: UrlSet[], freshExistingUrls: UrlSet[]) =>
  Object.values(groupBy([...receivedUrls, ...freshExistingUrls], 'url')).flatMap(
    (group) => sortBy(group, 'lastReceivedMs').pop()!
  );

export const updateDynamicState = (batch: ReadDapiWithIndexResponsesAndChainId) => {
  batch.map((item) =>
    updateState((draft) => {
      const receivedUrls = item.signedApiUrls.flatMap((url) =>
        item.dataFeed.beacons.flatMap((dataFeed) => ({
          url: `${url}/${dataFeed.airnodeAddress}`,
          lastReceivedMs: Date.now(),
        }))
      );

      const freshExistingUrls = draft.signedApiUrlStore.filter(
        (url) => Date.now() - url.lastReceivedMs > 1000 * 60 * SIGNED_URL_EXPIRY_IN_MINUTES
      );

      // Appends records that don't already exist, updates records that already exist with new timestamps
      draft.signedApiUrlStore = mergeUrls(receivedUrls.flat(), freshExistingUrls);

      const cachedDapiResponse = draft.dapis[item.dapiName];

      draft.dapis[item.dapiName] = {
        dataFeed: cachedDapiResponse?.dataFeed ?? item.dataFeed,
        dataFeedValues: { ...cachedDapiResponse?.dataFeedValues, [item.chainId]: item.dataFeedValue },
        updateParameters: { ...cachedDapiResponse?.updateParameters, [item.chainId]: item.updateParameters },
      };
    })
  );
};

export const getFeedsToUpdate = (batch: ReadDapiWithIndexResponsesAndChainId) =>
  batch
    .map((dapiResponse) => {
      const signedData = getStoreDataPoint(dapiResponse.dataFeed.dataFeedId);

      if (signedData === undefined) {
        return { ...dapiResponse, shouldUpdate: false };
      }

      const offChainValue = BigNumber.from(signedData.encodedValue);
      const offChainTimestamp = Number.parseInt(signedData?.timestamp ?? '0', 10);
      const deviationThreshold = dapiResponse.updateParameters.deviationThresholdInPercentage;

      const shouldUpdate = checkUpdateConditions(
        dapiResponse.dataFeedValue.value,
        dapiResponse.dataFeedValue.timestamp,
        offChainValue,
        offChainTimestamp,
        dapiResponse.updateParameters.heartbeatInterval,
        deviationThreshold
      );

      if (shouldUpdate) {
        return {
          ...dapiResponse,
          signedData,
        };
      }

      return false;
    })
    .filter(Boolean);

export const updateFeeds = async (_batch: ReturnType<typeof getFeedsToUpdate>) => {
  // TODO implement
  // batch, execute
};

export const processBatch = async (batch: ReadDapiWithIndexResponsesAndChainId) => {
  logger.debug('Processing batch of active dAPIs', { batch });

  // Start by merging the dynamic state with the state
  updateDynamicState(batch);

  const feedsToUpdate = getFeedsToUpdate(batch);

  return Promise.allSettled(chunk(feedsToUpdate, FEEDS_TO_UPDATE_CHUNK_SIZE).map(async (feed) => updateFeeds(feed)));
};
