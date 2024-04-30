import type { Address } from '@api3/commons';
import type { AirseekerRegistry } from '@api3/contracts';
import { go } from '@api3/promise-utils';
import type { ethers } from 'ethers';
import { isError, range, set, size, uniq } from 'lodash';

import type { Chain } from '../config/schema';
import { fetchAndStoreGasPrice, initializeGasState } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import { sleep } from '../utils';

import {
  decodeActiveDataFeedCountResponse,
  decodeActiveDataFeedResponse,
  getAirseekerRegistry,
  verifyMulticallResponse,
  type DecodedActiveDataFeedResponse,
  getApi3ServerV1,
  decodeGetBlockNumberResponse,
  decodeGetChainIdResponse,
  createProvider,
} from './contracts';
import { getUpdatableFeeds } from './get-updatable-feeds';
import { getDerivedSponsorWallet, submitTransactions } from './submit-transactions';
import {
  clearFirstMarkedUpdatableTimestamp,
  initializeFirstMarkedUpdatableTimestamp,
  isAlreadyUpdatable,
  setFirstMarkedUpdatableTimestamp,
} from './updatability-timestamp';

export const startUpdateFeedsLoops = async () => {
  const state = getState();
  const {
    config: { chains },
  } = state;

  // Start update loops for each chain in parallel.
  await Promise.all(
    Object.entries(chains).map(async ([chainId, chain]) => {
      const { dataFeedUpdateInterval, providers, alias } = chain;
      const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

      // Calculate the stagger time for each provider on the same chain to maximize transaction throughput and update
      // frequency.
      const staggerTimeMs = dataFeedUpdateIntervalMs / size(providers);
      logger.debug(`Starting update loops for chain.`, {
        chainName: alias,
        staggerTimeMs,
        providerNames: Object.keys(providers),
      });

      for (const providerName of Object.keys(providers)) {
        initializeGasState(chainId, providerName);
        initializeFirstMarkedUpdatableTimestamp(chainId, providerName);
        logger.debug(`Starting update feeds loop.`, { chainName: alias, providerName });
        // Run the update feed loop manually for the first time, because setInterval first waits for the given period of
        // time before calling the callback function.
        void runUpdateFeeds(providerName, chain, chainId);
        setInterval(async () => runUpdateFeeds(providerName, chain, chainId), dataFeedUpdateIntervalMs);

        await sleep(staggerTimeMs);
      }
    })
  );
};

export const calculateStaggerTimeMs = (
  batchesCount: number,
  firstBatchDurationMs: number,
  dataFeedUpdateIntervalMs: number
) => {
  // First batch duration should not be longer than the update interval because we have a timeout in place. However, it
  // may happen if the fetching resolves very close to the end of timeout and the duration ends up slightly larger. It's
  // arguably a bit better to let the function return 0 instead of throwing an error.
  if (batchesCount <= 1 || firstBatchDurationMs >= dataFeedUpdateIntervalMs) return 0;

  // Calculate the optimal stagger time between the the batches.
  const optimalStaggerTimeMs = Math.round(dataFeedUpdateIntervalMs / batchesCount);
  // If the first batch took longer than the optimal stagger time, we use the remaining time to stagger the rest of
  // the batches.
  if (firstBatchDurationMs > optimalStaggerTimeMs) {
    return batchesCount === 2 ? 0 : Math.round((dataFeedUpdateIntervalMs - firstBatchDurationMs) / (batchesCount - 1));
  }
  return optimalStaggerTimeMs;
};

export const readActiveDataFeedBatch = async (
  provider: ethers.JsonRpcProvider,
  airseekerRegistry: AirseekerRegistry,
  chainId: string,
  fromIndex: number,
  toIndex: number
) => {
  const calldatas: string[] = [];
  if (fromIndex === 0) calldatas.push(airseekerRegistry.interface.encodeFunctionData('activeDataFeedCount'));
  calldatas.push(
    airseekerRegistry.interface.encodeFunctionData('getBlockNumber'),
    airseekerRegistry.interface.encodeFunctionData('getChainId'),
    ...range(fromIndex, toIndex).map((dataFeedIndex) =>
      airseekerRegistry.interface.encodeFunctionData('activeDataFeed', [dataFeedIndex])
    )
  );

  let returndatas = verifyMulticallResponse(await airseekerRegistry.tryMulticall.staticCall(calldatas));
  let activeDataFeedCountReturndata: string | undefined;
  if (fromIndex === 0) {
    activeDataFeedCountReturndata = returndatas[0]!;
    returndatas = returndatas.slice(1);
  }
  const [getBlockNumberReturndata, getChainIdReturndata, ...activeDataFeedReturndatas] = returndatas;

  // Check that the chain ID is correct and log a warning if it's not because it's possible that providers switch chain
  // ID at runtime by mistake. In case the chain ID is wrong, we want to skip all data feeds in the batch (or all of
  // them in case this is the first batch). Another possibility of a wrong chain ID is misconfiguration in airseeker
  // file.
  const contractChainId = decodeGetChainIdResponse(getChainIdReturndata!).toString();
  if (contractChainId !== chainId) {
    logger.warn(`Chain ID mismatch.`, { chainId, contractChainId });
    return null;
  }

  // In the first batch we may have asked for a non-existent data feed. We need to slice them off based on the active
  // data feed count.
  let activeDataFeedCount: number | undefined;
  let batchReturndata = activeDataFeedReturndatas;
  if (fromIndex === 0) {
    activeDataFeedCount = decodeActiveDataFeedCountResponse(activeDataFeedCountReturndata!);
    batchReturndata = activeDataFeedReturndatas.slice(0, activeDataFeedCount);
  }
  const batch = batchReturndata
    .map((dataFeedReturndata) => decodeActiveDataFeedResponse(airseekerRegistry, dataFeedReturndata))
    .filter((dataFeed, dataFeedIndex): dataFeed is DecodedActiveDataFeedResponse => {
      const isRegistered = dataFeed !== null;
      if (!isRegistered) logger.warn(`Data feed not registered.`, { dataFeedIndex });
      return isRegistered;
    });

  // NOTE: https://api3workspace.slack.com/archives/C05TQPT7PNJ/p1713441156074839?thread_ts=1713438669.278119&cid=C05TQPT7PNJ
  const blockNumber =
    chainId === '42161' || chainId === '421614'
      ? await provider.getBlockNumber()
      : decodeGetBlockNumberResponse(getBlockNumberReturndata!);

  return {
    batch,
    blockNumber,
    activeDataFeedCount,
  };
};

export const runUpdateFeeds = async (providerName: string, chain: Chain, chainId: string) => {
  await logger.runWithContext(
    { chainName: chain.alias, providerName, updateFeedsCoordinatorId: Date.now().toString() },
    async () => {
      // We do not expect this function to throw, but its possible that some execution path is incorrectly handled and we
      // want to process the error ourselves, for example log the error using the configured format.
      const goRunUpdateFeeds = await go(async () => {
        const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts, alias } = chain;
        const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

        // Create a provider and connect it to the AirseekerRegistry contract.
        const provider = await createProvider(chainId, alias, providers[providerName]!.url);
        if (!provider) {
          logger.warn('Failed to create provider. This is likely an RPC issue.');
          return;
        }
        const airseekerRegistry = getAirseekerRegistry(contracts.AirseekerRegistry, provider);

        logger.debug(`Fetching first batch of data feeds batches.`);
        const firstBatchStartTimeMs = Date.now();
        const goFirstBatch = await go(
          async () => readActiveDataFeedBatch(provider, airseekerRegistry, chainId, 0, dataFeedBatchSize),
          { totalTimeoutMs: dataFeedUpdateIntervalMs }
        );
        if (!goFirstBatch.success) {
          logger.error(`Failed to get first active data feeds batch.`, goFirstBatch.error);
          return;
        }

        if (goFirstBatch.data === null) return;
        const { batch: firstBatch, activeDataFeedCount, blockNumber: firstBatchBlockNumber } = goFirstBatch.data;
        if (activeDataFeedCount === 0) {
          logger.info(`No active data feeds found.`);
          return;
        }
        // NOTE: We need to explicitly handle the .catch here because it's possible that the promise settles before it's
        // awaited, causing unhandled promise rejection. We do not expect this function to throw, but we want the promise
        // chain to be handled correctly in case there is some unhandled error.
        const processFirstBatchPromise: Promise<Error> | ReturnType<typeof processBatch> = processBatch(
          firstBatch,
          providerName,
          provider,
          chainId,
          firstBatchBlockNumber
        ).catch((error) => error);

        // Calculate the stagger time.
        const batchesCount = Math.ceil(activeDataFeedCount! / dataFeedBatchSize);
        const firstBatchDurationMs = Date.now() - firstBatchStartTimeMs;
        const staggerTimeMs = calculateStaggerTimeMs(batchesCount, firstBatchDurationMs, dataFeedUpdateIntervalMs);

        // Wait the remaining stagger time required after fetching the first batch.
        await sleep(Math.max(0, staggerTimeMs - firstBatchDurationMs));

        // Fetch the rest of the batches in parallel in a staggered way and process them.
        if (batchesCount > 1) {
          logger.debug('Fetching batches of active data feeds.', { batchesCount, staggerTimeMs });
        }
        const processOtherBatchesPromises = range(1, batchesCount).map(async (batchIndex) => {
          await sleep((batchIndex - 1) * staggerTimeMs);

          const goBatch = await go(async () => {
            logger.debug(`Fetching batch of active data feeds.`, { batchIndex });
            const dataFeedBatchIndexStart = batchIndex * dataFeedBatchSize;
            const dataFeedBatchIndexEnd = Math.min(activeDataFeedCount!, dataFeedBatchIndexStart + dataFeedBatchSize);
            const activeBatch = await readActiveDataFeedBatch(
              provider,
              airseekerRegistry,
              chainId,
              dataFeedBatchIndexStart,
              dataFeedBatchIndexEnd
            );

            return activeBatch;
          });
          if (!goBatch.success) {
            logger.error(`Failed to get active data feeds batch.`, goBatch.error);
            return;
          }
          if (goBatch.data === null) return;
          const { batch, blockNumber } = goBatch.data;

          return processBatch(batch, providerName, provider, chainId, blockNumber);
        });

        // Wait for all the batches to be processed and print stats from this run.
        const processedBatches = await Promise.all([
          // eslint-disable-next-line @typescript-eslint/promise-function-async
          new Promise<Awaited<ReturnType<typeof processBatch>>>((resolve, reject) => {
            return processFirstBatchPromise.then((result) => {
              // eslint-disable-next-line promise/always-return
              if (isError(result)) reject(result);
              else resolve(result);
            });
          }),
          ...processOtherBatchesPromises,
        ]);

        // Print stats from this run.
        const skippedBatchesCount = processedBatches.filter((batch) => !batch).length;
        const dataFeedUpdates = processedBatches.reduce((acc, batch) => acc + (batch ? batch.successCount : 0), 0);
        const dataFeedUpdateFailures = processedBatches.reduce((acc, batch) => acc + (batch ? batch.errorCount : 0), 0);
        logger.info(`Finished processing batches of active data feeds.`, {
          skippedBatchesCount,
          dataFeedUpdates,
          dataFeedUpdateFailures,
        });

        // Update the state with the signed API URLs.
        const signedApiUrls = uniq(
          processedBatches.reduce<string[]>((acc, batch) => (batch ? [...acc, ...batch.signedApiUrls] : acc), [])
        );
        // Overwrite the state with the new signed API URLs instead of merging them to avoid stale URLs.
        updateState((draft) => set(draft, ['signedApiUrls', chainId, providerName], signedApiUrls));
      });

      if (!goRunUpdateFeeds.success) {
        logger.error(`Unexpected error when updating data feeds feeds.`, goRunUpdateFeeds.error);
      }
    }
  );
};

export const processBatch = async (
  batch: DecodedActiveDataFeedResponse[],
  providerName: string,
  provider: ethers.JsonRpcProvider,
  chainId: string,
  blockNumber: number
) => {
  logger.debug('Processing batch of active data feeds.', {
    dapiNames: batch.map((dataFeed) => dataFeed.decodedDapiName),
    dataFeedIds: batch.map((dataFeed) => dataFeed.dataFeedId),
    blockNumber,
  });
  const {
    config: {
      sponsorWalletMnemonic,
      chains,
      deviationThresholdCoefficient,
      walletDerivationScheme,
      signedApiUrls: configSignedApiBaseUrls,
    },
    firstMarkedUpdatableTimestamps,
  } = getState();
  const { contracts } = chains[chainId]!;

  const feedsToUpdate = getUpdatableFeeds(batch, deviationThresholdCoefficient);

  // We need to update the first exceeded deviation timestamp for the feeds. We need to set them for feeds for which the
  // deviation is exceeded for the first time and clear the timestamp for feeds that no longer need an update. We apply
  // the logic immediately after checking the deviation to have the most accurate pending transaction timestamp.
  const timeAtDeviationCheck = Date.now();
  for (const feed of batch) {
    const { dapiName, dataFeedId, decodedDapiName, updateParameters } = feed;

    const isFeedUpdatable = feedsToUpdate.some(
      (updatableFeed) =>
        updatableFeed.dataFeedInfo.dapiName === dapiName && updatableFeed.dataFeedInfo.dataFeedId === dataFeedId
    );
    const sponsorWalletAddress = getDerivedSponsorWallet(
      sponsorWalletMnemonic,
      dapiName ?? dataFeedId,
      updateParameters,
      walletDerivationScheme
    ).address as Address;
    const alreadyUpdatable = isAlreadyUpdatable(chainId, providerName, sponsorWalletAddress);

    if (isFeedUpdatable && !alreadyUpdatable) {
      const timestamp = Math.floor(timeAtDeviationCheck / 1000);
      logger.info('Setting timestamp when the feed is first updatable.', { timestamp });
      setFirstMarkedUpdatableTimestamp(chainId, providerName, sponsorWalletAddress, timestamp);
    }
    if (!isFeedUpdatable && alreadyUpdatable) {
      // NOTE: A data feed may stop needing an update for two reasons:
      //  1. It has been updated by some other transaction. This could have been done by this Airseeker or some backup.
      //  2. As a natural price shift in signed API data.
      //
      // We can't differentiate between these cases unless we check recent update transactions, which we don't want to
      // do.
      logger.info(`Clearing data feed update timestamp because it no longer needs an update.`, {
        dapiName: decodedDapiName,
        dataFeedId,
        totalPendingPeriod:
          Math.floor(timeAtDeviationCheck / 1000) -
          firstMarkedUpdatableTimestamps[chainId]![providerName]![sponsorWalletAddress]!,
      });
      clearFirstMarkedUpdatableTimestamp(chainId, providerName, sponsorWalletAddress);
    }
  }

  // Fetch the gas price regardless of whether there are any feeds to be updated or not in order for gas oracle to
  // maintain historical gas prices.
  await fetchAndStoreGasPrice(chainId, providerName, provider);

  const updatedFeeds = await submitTransactions(
    chainId,
    providerName,
    provider,
    getApi3ServerV1(contracts.Api3ServerV1, provider),
    feedsToUpdate,
    blockNumber
  );
  const successCount = updatedFeeds.filter(Boolean).length;

  // Generate signed API URLs for the batch
  const signedApiUrls = batch
    .map((dataFeed) =>
      dataFeed.beaconsWithData.map((beacon, index) => {
        const configSignedApiUrls = configSignedApiBaseUrls.map((baseUrl) => `${baseUrl}/${beacon.airnodeAddress}`);

        // NOTE: contractSignedApiBaseUrl is an array of empty strings if it's not set on-chain
        const contractSignedApiBaseUrl = dataFeed.signedApiUrls[index];
        const contractSignedApiUrls = contractSignedApiBaseUrl
          ? [`${contractSignedApiBaseUrl}/${beacon.airnodeAddress}`]
          : [];

        return [...configSignedApiUrls, ...contractSignedApiUrls];
      })
    )
    .flat(2);
  return { signedApiUrls, successCount, errorCount: size(feedsToUpdate) - successCount };
};
