import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { uniqBy } from 'lodash';

import { calculateMedian, checkUpdateConditions } from '../condition-check';
import { logger } from '../logger';
import { getStoreDataPoint } from '../signed-data-store';
import { getState } from '../state';
import type { ChainId, Provider } from '../types';

import { getApi3ServerV1 } from './api3-server-v1';
import type { ReadDapiWithIndexResponse } from './dapi-data-registry';

export const shallowCheckFeeds = (batch: ReadDapiWithIndexResponse[]) =>
  batch
    .map((dapiResponse: ReadDapiWithIndexResponse) => ({
      ...dapiResponse,
      signedData: dapiResponse.decodedDataFeed.beacons.map(({ dataFeedId }) => getStoreDataPoint(dataFeedId)),
    }))
    .filter(({ signedData, updateParameters, dataFeedValue }) => {
      if (!signedData) {
        return false;
      }

      const offChainValue =
        calculateMedian(signedData.map((point) => ethers.BigNumber.from(point?.encodedValue ?? 0))) ??
        ethers.BigNumber.from(1);
      const offChainTimestamp =
        calculateMedian(signedData.map((point) => ethers.BigNumber.from(point?.timestamp ?? 0)))?.toNumber() ?? 1;
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

export const callAndParseMulticall = async (
  batch: ReturnType<typeof shallowCheckFeeds>,
  providerName: Provider,
  chainId: ChainId
) => {
  const { config } = getState();
  const chain = config.chains[chainId]!;
  const { providers, contracts } = chain;

  const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);
  const server = getApi3ServerV1(contracts.Api3ServerV1, provider);
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  const feedCalldata = uniqBy(batch.flat(), 'dataFeedId')
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
    throw multicallResult.error;
  }

  const { successes, returndata } = multicallResult.data;
  if (!(successes.length === feedCalldata.length && returndata.length === feedCalldata.length)) {
    throw new Error(`The number of returned records from the read multicall call does not match the number requested.`);
  }

  return feedCalldata
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
};

export const getFeedsToUpdate = async (
  batch: ReadDapiWithIndexResponse[], // ReturnType<typeof getFeedsToUpdate>,
  providerName: Provider,
  chainId: ChainId
) => {
  const shallowCheckedFeedsToUpdate = shallowCheckFeeds(batch);

  const feedsThatWouldFailToUpdateResult = await go(
    async () => callAndParseMulticall(shallowCheckedFeedsToUpdate, providerName, chainId),
    { retries: 0 }
  );
  if (!feedsThatWouldFailToUpdateResult.success) {
    return batch;
  }

  const feedsThatWouldFailToUpdate = feedsThatWouldFailToUpdateResult.data;

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
