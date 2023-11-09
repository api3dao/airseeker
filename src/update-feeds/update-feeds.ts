import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { range, size, uniqBy } from 'lodash';

import { calculateMedian, checkUpdateConditions } from '../condition-check';
import type { Chain } from '../config/schema';
import { logger } from '../logger';
import { getStoreDataPoint } from '../signed-data-store';
import { getState, updateState } from '../state';
import type { ChainId, Provider } from '../types';
import { isFulfilled, sleep } from '../utils';

import { getApi3ServerV1 } from './api3-server-v1';
import {
  decodeDapisCountResponse,
  decodeReadDapiWithIndexResponse,
  getDapiDataRegistry,
  verifyMulticallResponse,
  type ReadDapiWithIndexResponse,
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

export const runUpdateFeed = async (providerName: Provider, chain: Chain, chainId: ChainId) => {
  await logger.runWithContext({ chainId, providerName, coordinatorTimestampMs: Date.now().toString() }, async () => {
    const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts } = chain;

    // Create a provider and connect it to the DapiDataRegistry contract.
    const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);
    const dapiDataRegistry = getDapiDataRegistry(contracts.DapiDataRegistry, provider);

    logger.debug(`Fetching first batch of dAPIs batches`);
    const firstBatchStartTime = Date.now();
    const goFirstBatch = await go(async () => {
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
    });
    if (!goFirstBatch.success) {
      logger.error(`Failed to get first active dAPIs batch`, goFirstBatch.error);
      return;
    }
    const { firstBatch, dapisCount } = goFirstBatch.data;
    const processFirstBatchPromise = processBatch(firstBatch, providerName, chainId);

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
        processBatch((result as PromiseFulfilledResult<ReadDapiWithIndexResponse[]>).value, providerName, chainId)
      );

    // Wait for all the batches to be processed.
    //
    // TODO: Consider returning some information (success/error) and log some statistics (e.g. how many dAPIs were
    // updated, etc...).
    await Promise.all([processFirstBatchPromise, ...processOtherBatchesPromises]);
  });
};

export const updateFeeds = async (_batch: ReturnType<typeof getFeedsToUpdate>, _chainId: string) => {
  // TODO implement
  // batch, execute
};

export const getFeedsToUpdate = async (
  batch: ReadDapiWithIndexResponse[], // ReturnType<typeof getFeedsToUpdate>,
  providerName: Provider,
  chainId: ChainId
) => {
  const { config } = getState();
  const chain = config.chains[chainId]!;
  const { providers, contracts } = chain;

  const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);
  const server = getApi3ServerV1(contracts.Api3ServerV1, provider);
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  const shallowCheckedFeedsToUpdate = batch
    .map((dapiResponse: ReadDapiWithIndexResponse) => {
      const signedData = getStoreDataPoint(dapiResponse.decodedDataFeed.dataFeedId);

      return {
        ...dapiResponse,
        signedData,
      };
    })
    .filter(({ signedData, updateParameters, dataFeedValue }) => {
      if (!signedData) {
        return false;
      }

      const offChainValue = ethers.BigNumber.from(signedData.encodedValue);
      const offChainTimestamp = Number.parseInt(signedData?.timestamp ?? '0', 10);
      const deviationThreshold = updateParameters.deviationThresholdInPercentage;

      return checkUpdateConditions(
        dataFeedValue.value,
        dataFeedValue.timestamp,
        offChainValue,
        offChainTimestamp,
        updateParameters.heartbeatInterval,
        deviationThreshold
      );
    });

  const feedCalldata = uniqBy(shallowCheckedFeedsToUpdate.flat(), 'dataFeedId')
    .flatMap((parentFeed) => parentFeed.decodedDataFeed.beacons)
    .map(({ dataFeedId }) => ({
      dataFeedId,
      calldata: server.interface.encodeFunctionData('dataFeeds', [dataFeedId]),
    }));

  const multicallResult = await go(
    async () => server.connect(voidSigner).callStatic.tryMulticall(feedCalldata.map((feed) => feed.calldata)),
    { retries: 1 }
  );

  if (!multicallResult.success) {
    logger.warn(`The multicall attempt to read potentially updateable feed values has failed.`, {
      error: multicallResult.error,
    });
    return shallowCheckedFeedsToUpdate;
  }

  const { successes, returndata } = multicallResult.data;
  if (!(successes.length === feedCalldata.length && returndata.length === feedCalldata.length)) {
    logger.warn(`The number of returned records from the read multicall call does not match the number requested.`);
    return shallowCheckedFeedsToUpdate;
  }

  const feedsThatWouldFailToUpdate = feedCalldata
    .map(({ dataFeedId }, idx) => {
      if (successes[idx]) {
        const [value, timestamp] = ethers.utils.defaultAbiCoder.decode(['int224', 'uint32'], returndata[idx]!);

        return {
          dataFeedId,
          onChainValue: { timestamp: ethers.BigNumber.from(timestamp), value: ethers.BigNumber.from(value) },
        };
      }

      return { dataFeedId, onChainValue: undefined };
    })
    .filter(({ dataFeedId, onChainValue }) => {
      if (!onChainValue) {
        return false;
      }

      const signedData = getStoreDataPoint(dataFeedId);
      if (!signedData) {
        return false;
      }

      const numericalSignedTimestamp = Number.parseInt(signedData.timestamp, 10);
      const numericalOnChainTimestamp = onChainValue.timestamp.toNumber();

      // https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L121
      if (numericalSignedTimestamp < numericalOnChainTimestamp) {
        return true;
      }

      return numericalSignedTimestamp > Date.now() + 60 * 60;
    });

  return batch
    .map((feed) => {
      const beaconValues = feed.decodedDataFeed.beacons.map((beacon) => {
        const latestOnChainValue = feedsThatWouldFailToUpdate.find(
          (failedFeed) => failedFeed.dataFeedId === beacon.dataFeedId && failedFeed.onChainValue
        );
        if (latestOnChainValue?.onChainValue) {
          return latestOnChainValue.onChainValue;
        }

        const storeDatapoint = getStoreDataPoint(feed.decodedDataFeed.dataFeedId);

        const value = ethers.BigNumber.from(storeDatapoint?.encodedValue ?? '1');
        const timestamp = ethers.BigNumber.from(storeDatapoint?.timestamp ?? 1);

        return { timestamp, value };
      });

      const newMedianValue = calculateMedian(beaconValues.map((val) => val.value));
      const newMedianTimestamp = calculateMedian(beaconValues.map((val) => val.timestamp));

      const shouldUpdate = checkUpdateConditions(
        feed.dataFeedValue.value,
        feed.dataFeedValue.timestamp,
        newMedianValue ?? ethers.BigNumber.from(0),
        newMedianTimestamp?.toNumber() ?? 0,
        feed.updateParameters.heartbeatInterval,
        feed.updateParameters.deviationThresholdInPercentage
      );

      // filter out underlying beacons that failed to update
      return {
        ...feed,
        decodedDataFeed: {
          ...feed.decodedDataFeed,
          beacons: feed.decodedDataFeed.beacons.filter(
            (beacon) => !feedsThatWouldFailToUpdate.some((childFeed) => childFeed.dataFeedId === beacon.dataFeedId)
          ),
        },
        shouldUpdate,
      };
    })
    .filter((feed) => feed.shouldUpdate);
};

export const processBatch = async (batch: ReadDapiWithIndexResponse[], providerName: Provider, chainId: ChainId) => {
  logger.debug('Processing batch of active dAPIs', { batch });

  updateState((draft) => {
    for (const dapi of batch) {
      const receivedUrls = dapi.signedApiUrls.flatMap((url) =>
        dapi.decodedDataFeed.beacons.flatMap((dataFeed) => `${url}/${dataFeed.airnodeAddress}`)
      );

      draft.signedApiUrlStore = {
        ...draft.signedApiUrlStore,
        [chainId]: { ...draft.signedApiUrlStore[chainId], [providerName]: receivedUrls.flat() },
      };

      const cachedDapiResponse = draft.dapis[dapi.dapiName];

      draft.dapis[dapi.dapiName] = {
        dataFeed: cachedDapiResponse?.dataFeed ?? dapi.decodedDataFeed,
        dataFeedValues: { ...cachedDapiResponse?.dataFeedValues, [chainId]: dapi.dataFeedValue },
        updateParameters: { ...cachedDapiResponse?.updateParameters, [chainId]: dapi.updateParameters },
      };
    }
  });

  const feedsToUpdate = getFeedsToUpdate(batch, chainId, providerName);

  return updateFeeds(feedsToUpdate, chainId);
};
