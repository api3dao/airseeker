import { getSignedData } from '../data-fetcher-loop/signed-data-state';
import { calculateMedian, checkUpdateCondition } from '../deviation-check';
import { logger } from '../logger';
import type { SignedData } from '../types';
import { decodeBeaconValue, multiplyBigNumber } from '../utils';

import type { DecodedActiveDataFeedResponse } from './contracts';

interface BeaconValue {
  timestamp: bigint;
  value: bigint;
}

export interface UpdatableBeacon {
  beaconId: string;
  signedData: SignedData;
}

export interface UpdatableDataFeed {
  dataFeedInfo: DecodedActiveDataFeedResponse;
  updatableBeacons: UpdatableBeacon[];
}

export const getUpdatableFeeds = (
  batch: DecodedActiveDataFeedResponse[],
  deviationThresholdCoefficient: number
): UpdatableDataFeed[] => {
  return (
    batch
      // Determine on-chain and off-chain values for each beacon.
      .map((dataFeedInfo) => {
        const aggregatedBeaconsWithData = dataFeedInfo.beaconsWithData.map(({ beaconId, timestamp, value }) => {
          const onChainValue: BeaconValue = { timestamp, value };
          const signedData = getSignedData(beaconId);
          const offChainValue: BeaconValue | undefined = signedData
            ? {
                timestamp: BigInt(signedData.timestamp),
                value: decodeBeaconValue(signedData.encodedValue)!,
              }
            : undefined;
          const isUpdatable = offChainValue && offChainValue.timestamp > onChainValue.timestamp;

          return { onChainValue, offChainValue, isUpdatable, signedData, beaconId };
        });

        return {
          dataFeedInfo,
          aggregatedBeaconsWithData,
        };
      })
      // Filter out data feeds that cannot be updated.
      .filter(({ dataFeedInfo, aggregatedBeaconsWithData }) => {
        // Beacons are updatable when the off-chain timestamp is newer than the on-chain one. If we can't update the
        // timestamp, we reuse the on-chain value.
        //
        // NOTE: This guarantees that the off-chain data feed timestamp is greater or equal to the on-chain one.
        const beaconValues = aggregatedBeaconsWithData.map(({ onChainValue, offChainValue, isUpdatable }) =>
          isUpdatable ? offChainValue! : onChainValue
        );

        // Works for both beacon sets and single beacon feed.
        const newDataFeedValue = calculateMedian(beaconValues.map(({ value }) => value));
        const newDataFeedTimestamp = calculateMedian(beaconValues.map(({ timestamp }) => timestamp));

        const {
          decodedUpdateParameters: { deviationThresholdInPercentage, deviationReference, heartbeatInterval },
          dataFeedValue,
          dataFeedTimestamp,
          decodedDapiName,
          dataFeedId,
        } = dataFeedInfo;
        const adjustedDeviationThresholdCoefficient = multiplyBigNumber(
          deviationThresholdInPercentage,
          deviationThresholdCoefficient
        );

        // We need to make sure that the update transaction actually changes the on-chain value. There are two cases:
        // 1. Data feed is a beacon - We need to make sure the off-chain data updates the feed. This requires timestamp
        //    to change. See:
        //    https://github.com/api3dao/airnode-protocol-v1/blob/65a77cdc23dc5434e143357a506327b9f0ccb7ef/contracts/api3-server-v1/DataFeedServer.sol#L120
        // 2. Data feed is a beacon set - We need make sure that the beacon set will change. The contract requires the
        //    beacon set value or timestamp to change. See:
        //    https://github.com/api3dao/airnode-protocol-v1/blob/65a77cdc23dc5434e143357a506327b9f0ccb7ef/contracts/api3-server-v1/DataFeedServer.sol#L54
        const isBeaconSet = beaconValues.length > 1;
        // Note, that the beacon set value/timestamp is computed as median, so single beacon update may not result in a beacon set update.
        if (isBeaconSet && newDataFeedValue === dataFeedValue && newDataFeedTimestamp === dataFeedTimestamp) {
          return false;
        }
        if (!isBeaconSet && newDataFeedTimestamp === dataFeedTimestamp) return false;

        return logger.runWithContext(
          {
            dapiName: decodedDapiName,
            dataFeedId,
          },
          () =>
            checkUpdateCondition(
              dataFeedValue,
              dataFeedTimestamp,
              newDataFeedValue,
              newDataFeedTimestamp,
              heartbeatInterval,
              adjustedDeviationThresholdCoefficient,
              deviationReference
            )
        );
      })
      // Compute the updateable beacons.
      .map(({ dataFeedInfo, aggregatedBeaconsWithData }) => ({
        dataFeedInfo,
        updatableBeacons: aggregatedBeaconsWithData
          .filter(({ isUpdatable }) => isUpdatable)
          .map(({ beaconId, signedData }) => ({
            beaconId,
            signedData: signedData!,
          })),
      }))
  );
};
