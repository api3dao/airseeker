import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { range, size, zip } from 'lodash';

import type { Chain } from '../config/schema';
import { INT224_MAX, INT224_MIN, RPC_PROVIDER_TIMEOUT_MS } from '../constants';
import { clearSponsorLastUpdateTimestampMs, initializeGasStore, hasPendingTransaction } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { ChainId, ProviderName } from '../types';
import { isFulfilled, sleep, deriveSponsorWallet } from '../utils';

import { getApi3ServerV1 } from './api3-server-v1';
import { getUpdatableFeeds } from './check-feeds';
import {
  decodeDapisCountResponse,
  decodeReadDapiWithIndexResponse,
  getDapiDataRegistry,
  verifyMulticallResponse,
  type ReadDapiWithIndexResponse,
} from './dapi-data-registry';
import { updateFeeds } from './update-transactions';

export const startUpdateFeedsLoops = async () => {
  const state = getState();
  const {
    config: { chains },
  } = state;

  // Start update loops for each chain in parallel.
  await Promise.all(
    Object.entries(chains).map(async ([chainId, chain]) => {
      const { dataFeedUpdateInterval, providers } = chain;
      const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

      // Calculate the stagger time for each provider on the same chain to maximize transaction throughput and update
      // frequency.
      const staggerTime = dataFeedUpdateIntervalMs / size(providers);
      logger.debug(`Starting update loops for chain`, { chainId, staggerTime, providerNames: Object.keys(providers) });

      for (const providerName of Object.keys(providers)) {
        logger.debug(`Initializing gas store`, { chainId, providerName });
        initializeGasStore(chainId, providerName);

        logger.debug(`Starting update feed loop`, { chainId, providerName });
        // Run the update feed loop manually for the first time, because setInterval first waits for the given period of
        // time.
        void runUpdateFeeds(providerName, chain, chainId);
        setInterval(async () => runUpdateFeeds(providerName, chain, chainId), dataFeedUpdateIntervalMs);

        await sleep(staggerTime);
      }
    })
  );
};

export const runUpdateFeeds = async (providerName: ProviderName, chain: Chain, chainId: ChainId) => {
  await logger.runWithContext({ chainId, providerName, updateFeedsCoordinatorId: Date.now().toString() }, async () => {
    const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts } = chain;
    const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

    // Create a provider and connect it to the DapiDataRegistry contract.
    const provider = new ethers.providers.StaticJsonRpcProvider({
      url: providers[providerName]!.url,
      timeout: RPC_PROVIDER_TIMEOUT_MS,
    });
    const dapiDataRegistry = getDapiDataRegistry(contracts.DapiDataRegistry, provider);

    logger.debug(`Fetching first batch of dAPIs batches`);
    const firstBatchStartTime = Date.now();
    const goFirstBatch = await go(
      async () => {
        const dapisCountCalldata = dapiDataRegistry.interface.encodeFunctionData('dapisCount');
        const readDapiWithIndexCalldatas = range(0, dataFeedBatchSize).map((dapiIndex) =>
          dapiDataRegistry.interface.encodeFunctionData('readDapiWithIndex', [dapiIndex])
        );
        const [dapisCountReturndata, ...readDapiWithIndexCallsReturndata] = verifyMulticallResponse(
          await dapiDataRegistry.callStatic.tryMulticall([dapisCountCalldata, ...readDapiWithIndexCalldatas])
        );

        const dapisCount = decodeDapisCountResponse(dapiDataRegistry, dapisCountReturndata!);
        const firstBatch = readDapiWithIndexCallsReturndata
          // Because the dapisCount is not known during the multicall, we may ask for non-existent dAPIs. These should be filtered out.
          .slice(0, dapisCount)
          .map((dapiReturndata) => ({ ...decodeReadDapiWithIndexResponse(dapiDataRegistry, dapiReturndata), chainId }));
        return {
          firstBatch,
          dapisCount,
        };
      },
      { totalTimeoutMs: dataFeedUpdateIntervalMs }
    );
    if (!goFirstBatch.success) {
      logger.error(`Failed to get first active dAPIs batch`, goFirstBatch.error);
      return;
    }
    if (Date.now() >= firstBatchStartTime + dataFeedUpdateIntervalMs) {
      logger.warn(`Fetching the first batch took the whole interval. Skipping updates.`);
      return;
    }

    const { firstBatch, dapisCount } = goFirstBatch.data;
    if (dapisCount === 0) {
      logger.warn(`No active dAPIs found`);
      return;
    }
    const processFirstBatchPromise = processBatch(firstBatch, providerName, provider, chainId);

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
        const readDapiWithIndexCalldatas = range(dapiBatchIndexStart, dapiBatchIndexEnd).map((dapiIndex) =>
          dapiDataRegistry.interface.encodeFunctionData('readDapiWithIndex', [dapiIndex])
        );
        const returndata = verifyMulticallResponse(
          await dapiDataRegistry.callStatic.tryMulticall(readDapiWithIndexCalldatas)
        );

        return returndata.map((returndata) => decodeReadDapiWithIndexResponse(dapiDataRegistry, returndata));
      })
    );
    for (const batch of otherBatches.filter((batch) => !isFulfilled(batch))) {
      logger.error(`Failed to get active dAPIs batch`, (batch as PromiseRejectedResult).reason);
    }
    const processOtherBatchesPromises = otherBatches
      .filter((result) => isFulfilled(result))
      .map(async (result) =>
        processBatch(
          (result as PromiseFulfilledResult<ReadDapiWithIndexResponse[]>).value,
          providerName,
          provider,
          chainId
        )
      );

    // Wait for all the batches to be processed and print stats from this run.
    const processingResult = await Promise.all([processFirstBatchPromise, ...processOtherBatchesPromises]);
    const successCount = processingResult.reduce((acc, { successCount }) => acc + successCount, 0);
    const errorCount = processingResult.reduce((acc, { errorCount }) => acc + errorCount, 0);
    logger.debug(`Finished processing batches of active dAPIs`, { batchesCount, successCount, errorCount });
  });
};

// https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L132
export const decodeBeaconValue = (encodedBeaconValue: string) => {
  const decodedBeaconValue = ethers.BigNumber.from(
    ethers.utils.defaultAbiCoder.decode(['int256'], encodedBeaconValue)[0]
  );
  if (decodedBeaconValue.gt(INT224_MAX) || decodedBeaconValue.lt(INT224_MIN)) {
    return null;
  }

  return decodedBeaconValue;
};

export const processBatch = async (
  batch: ReadDapiWithIndexResponse[],
  providerName: ProviderName,
  provider: ethers.providers.StaticJsonRpcProvider,
  chainId: ChainId
) => {
  logger.debug('Processing batch of active dAPIs', { dapiNames: batch.map((dapi) => dapi.dapiName) });
  const {
    config: { sponsorWalletMnemonic, chains, deviationThresholdCoefficient },
  } = getState();
  const { contracts } = chains[chainId]!;

  updateState((draft) => {
    for (const dapi of batch) {
      const receivedUrls = zip(dapi.signedApiUrls, dapi.decodedDataFeed.beacons).map(([url, beacon]) => ({
        url: `${url}/${beacon!.airnodeAddress}`,
        airnodeAddress: beacon!.airnodeAddress,
      }));
      if (!draft.signedApiUrlStore) draft.signedApiUrlStore = {};
      if (!draft.signedApiUrlStore[chainId]) draft.signedApiUrlStore[chainId] = {};
      if (!draft.signedApiUrlStore[chainId]![providerName]) draft.signedApiUrlStore[chainId]![providerName] = {};
      for (const { airnodeAddress, url } of receivedUrls) {
        draft.signedApiUrlStore[chainId]![providerName]![airnodeAddress] = url;
      }

      const cachedDapiResponse = draft.dapis[dapi.dapiName];
      draft.dapis[dapi.dapiName] = {
        dataFeed: cachedDapiResponse?.dataFeed ?? dapi.decodedDataFeed,
        dataFeedValues: { ...cachedDapiResponse?.dataFeedValues, [chainId]: dapi.dataFeedValue },
        updateParameters: { ...cachedDapiResponse?.updateParameters, [chainId]: dapi.updateParameters },
      };
    }
  });

  const feedsToUpdate = await getUpdatableFeeds(batch, deviationThresholdCoefficient, providerName, chainId);
  const dapiNamesToUpdate = new Set(feedsToUpdate.map((feed) => feed.dapiInfo.dapiName));

  // Clear last update timestamps for feeds that don't need an update
  for (const feed of batch) {
    const { dapiName } = feed;

    if (!dapiNamesToUpdate.has(dapiName)) {
      const sponsorWalletAddress = deriveSponsorWallet(sponsorWalletMnemonic, dapiName).address;
      const timestampNeedsClearing = hasPendingTransaction(chainId, providerName, sponsorWalletAddress);
      if (timestampNeedsClearing) {
        // NOTE: A dAPI may stop needing an update for two reasons:
        //  1. It has been updated by a transaction. This could have been done by this Airseeker or some backup.
        //  2. As a natural price shift in signed API data.
        //
        // We can't differentiate between these cases unless we check recent update transactions, which we don't want to
        // do.
        logger.debug(`Clearing dAPI update timestamp because it no longer needs an update`, {
          dapiName,
        });
        clearSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWalletAddress);
      }
    }
  }

  const updatedFeeds = await updateFeeds(
    chainId,
    providerName,
    provider,
    getApi3ServerV1(contracts.Api3ServerV1, provider),
    feedsToUpdate
  );
  const successCount = updatedFeeds.filter(Boolean).length;
  return { successCount, errorCount: size(feedsToUpdate) - successCount };
};
