import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { range, size, uniq } from 'lodash';

import type { Chain } from '../config/schema';
import { logger } from '../logger';
import { getStoreDataPoint } from '../signed-data-store';
import { getState, setState } from '../state';
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

type ReadDapiWithIndexResponsesAndChainId = (ReadDapiWithIndexResponse & {
  chainId: string;
})[];

export const runUpdateFeed = async (providerName: string, chain: Chain, chainId: string) => {
  const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts } = chain;
  // TODO: Consider adding a start timestamp (as ID) to the logs to identify batches from this runUpdateFeed tick.
  const baseLogContext = { chainId, providerName };

  // Create a provider and connect it to the DapiDataRegistry contract.
  const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);
  const dapiDataRegistry = getDapiDataRegistry(contracts.DapiDataRegistry, provider);

  logger.debug(`Fetching first batch of dAPIs batches`, baseLogContext);
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
    logger.error(`Failed to get first active dAPIs batch`, goFirstBatch.error, baseLogContext);
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
    logger.debug('Fetching batches of active dAPIs', { batchesCount, staggerTime, ...baseLogContext });
  }
  const otherBatches = await Promise.allSettled(
    range(1, batchesCount).map(async (batchIndex) => {
      await sleep((batchIndex - 1) * staggerTime);

      logger.debug(`Fetching batch of active dAPIs`, { batchIndex, ...baseLogContext });
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
    logger.error(`Failed to get active dAPIs batch`, (batch as PromiseRejectedResult).reason, baseLogContext);
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
};

export const updateDynamicState = (batch: ReadDapiWithIndexResponsesAndChainId) => {
  batch.map((item) => {
    const state = getState();

    const cachedDapiResponse = state.dynamicState[item.dapiName] ?? {
      dataFeed: item.dataFeed,
      signedApiUrls: [],
      dataFeedValues: {},
      updateParameters: {},
    };

    // We're assuming the received data feed value is newer than what we already have... this may not actually be the case
    // but the alternative is that we accept a later value but then DoS future values.
    // This should probably be time-constrained and require updated values (eg. only update if newer but not newer than 15 minutes)
    const newDapiResponse = {
      dataFeed: cachedDapiResponse?.dataFeed ?? item.dataFeed,
      dataFeedValues: { ...cachedDapiResponse?.dataFeedValues, [item.chainId]: item.dataFeedValue },
      updateParameters: { ...cachedDapiResponse.updateParameters, [item.chainId]: item.updateParameters },
      signedApiUrls: uniq([...item.signedApiUrls, ...(cachedDapiResponse?.signedApiUrls ?? [])]),
    };

    setState({ ...state, dynamicState: { ...state.dynamicState, [item.dapiName]: newDapiResponse } });
  });
};

export const getFeedsToUpdate = (batch: ReadDapiWithIndexResponsesAndChainId) => {
  // const state = getState();

  return batch.map((dapiResponse) => {
    const signedData = getStoreDataPoint(dapiResponse.dataFeed);

    // TODO do comparison



    return {
      ...dapiResponse,
    };
  });
};

// eslint-disable-next-line @typescript-eslint/require-await
export const processBatch = async (batch: ReadDapiWithIndexResponsesAndChainId) => {
  logger.debug('Processing batch of active dAPIs', { batch });
  // TODO: Implement.

  // Start by merging the dynamic state with the state
  updateDynamicState(batch);

  // Record<chainId, {dataFeed: string, signedData: SignedData}>
  const _feedsToUpdate = getFeedsToUpdate(batch);
};
