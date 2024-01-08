import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { getSignedData } from '../data-fetcher-loop/signed-data-state';
import { calculateMedian, isDataFeedUpdatable } from '../deviation-check';
import { logger } from '../logger';
import { getState } from '../state';
import type { BeaconId, ChainId, SignedData } from '../types';
import { decodeBeaconValue, multiplyBigNumber } from '../utils';

import {
  getApi3ServerV1,
  type DecodedActiveDataFeedResponse,
  decodeGetChainIdResponse,
  verifyMulticallResponse,
} from './contracts';

interface BeaconValue {
  timestamp: ethers.BigNumber;
  value: ethers.BigNumber;
}

export interface UpdatableBeacon {
  beaconId: string;
  signedData: SignedData;
}

export interface UpdatableDataFeed {
  dataFeedInfo: DecodedActiveDataFeedResponse;
  updatableBeacons: UpdatableBeacon[];
}

export const getUpdatableFeeds = async (
  batch: DecodedActiveDataFeedResponse[],
  deviationThresholdCoefficient: number,
  provider: ethers.providers.StaticJsonRpcProvider,
  chainId: ChainId
): Promise<UpdatableDataFeed[]> => {
  const uniqueBeaconIds = [
    ...new Set(batch.flatMap((item) => item.decodedDataFeed.beacons.flatMap((beacon) => beacon.beaconId))),
  ];
  const goOnChainFeedValues = await go(async () => multicallBeaconValues(uniqueBeaconIds, provider, chainId));
  if (!goOnChainFeedValues.success) {
    logger.error(
      `Multicalling on-chain data feed values has failed. Skipping update for all data feeds in a batch`,
      goOnChainFeedValues.error,
      {
        dapiNames: batch.map((dataFeed) => dataFeed.decodedDapiName),
        dataFeedIds: batch.map((dataFeed) => dataFeed.decodedDataFeed.dataFeedId),
      }
    );
    return [];
  }
  const onChainFeedValues = goOnChainFeedValues.data;
  if (!onChainFeedValues) return [];

  return (
    batch
      // Determine on-chain and off-chain values for each beacon.
      .map((dataFeedInfo) => {
        const beaconsWithData = dataFeedInfo.decodedDataFeed.beacons.map(({ beaconId }) => {
          const onChainValue: BeaconValue = onChainFeedValues[beaconId]!;
          const signedData = getSignedData(beaconId);
          const offChainValue: BeaconValue | undefined = signedData
            ? {
                timestamp: ethers.BigNumber.from(signedData.timestamp),
                value: decodeBeaconValue(signedData.encodedValue)!,
              }
            : undefined;
          const isUpdatable = offChainValue?.timestamp.gt(onChainValue.timestamp);

          return { onChainValue, offChainValue, isUpdatable, signedData, beaconId };
        });

        return {
          dataFeedInfo,
          beaconsWithData,
        };
      })
      // Filter out data feeds that cannot be updated.
      .filter(({ dataFeedInfo, beaconsWithData }) => {
        const beaconValues = beaconsWithData.map(({ onChainValue, offChainValue, isUpdatable }) =>
          isUpdatable ? offChainValue! : onChainValue
        );

        const newBeaconSetValue = calculateMedian(beaconValues.map(({ value }) => value));
        const newBeaconSetTimestamp = calculateMedian(beaconValues.map(({ timestamp }) => timestamp))!.toNumber();

        const { decodedUpdateParameters, dataFeedValue, dataFeedTimestamp } = dataFeedInfo;
        const adjustedDeviationThresholdCoefficient = multiplyBigNumber(
          decodedUpdateParameters.deviationThresholdInPercentage,
          deviationThresholdCoefficient
        );

        return isDataFeedUpdatable(
          dataFeedValue,
          dataFeedTimestamp,
          newBeaconSetValue,
          newBeaconSetTimestamp,
          decodedUpdateParameters.heartbeatInterval,
          adjustedDeviationThresholdCoefficient
        );
      })
      // Compute the updateable beacons.
      .map(({ dataFeedInfo, beaconsWithData }) => ({
        dataFeedInfo,
        updatableBeacons: beaconsWithData
          .filter(({ isUpdatable }) => isUpdatable)
          .map(({ beaconId, signedData }) => ({
            beaconId,
            signedData: signedData!,
          })),
      }))
  );
};

export const multicallBeaconValues = async (
  batch: BeaconId[],
  provider: ethers.providers.StaticJsonRpcProvider,
  chainId: ChainId
): Promise<Record<BeaconId, BeaconValue> | null> => {
  const { config } = getState();
  const chain = config.chains[chainId]!;
  const { contracts } = chain;

  // Calling the dataFeeds contract function is guaranteed not to revert, so we are not checking the multicall successes
  // and using returndata directly. If the call fails (e.g. timeout or RPC error) we let the parent handle it.
  const api3ServerV1 = getApi3ServerV1(contracts.Api3ServerV1, provider);
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);
  const returndatas = verifyMulticallResponse(
    await api3ServerV1
      .connect(voidSigner)
      .callStatic.tryMulticall([
        api3ServerV1.interface.encodeFunctionData('getChainId'),
        ...batch.map((beaconId) => api3ServerV1.interface.encodeFunctionData('dataFeeds', [beaconId])),
      ])
  );
  const [chainIdReturndata, ...dataFeedsReturndata] = returndatas;

  const contractChainId = decodeGetChainIdResponse(chainIdReturndata!).toString();
  if (contractChainId !== chainId) {
    logger.warn(`Chain ID mismatch.`, { chainId, contractChainId });
    return null;
  }

  const onChainValues: Record<BeaconId, BeaconValue> = {};
  for (const [idx, beaconId] of batch.entries()) {
    const [value, timestamp] = ethers.utils.defaultAbiCoder.decode(['int224', 'uint32'], dataFeedsReturndata[idx]!);
    onChainValues[beaconId] = { timestamp: ethers.BigNumber.from(timestamp), value: ethers.BigNumber.from(value) };
  }
  return onChainValues;
};
