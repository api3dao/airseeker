import type { IndividualBeaconUpdateSettings } from '../config/schema';
import { getSignedData, isSignedDataFresh } from '../data-fetcher-loop/signed-data-state';
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
  shouldUpdateBeaconSet: boolean;
}

const adjustDeviationThreshold = (deviationThresholdInPercentage: bigint, deviationThresholdCoefficient: number) =>
  multiplyBigNumber(deviationThresholdInPercentage, deviationThresholdCoefficient);

const adjustHeartbeatInterval = (heartbeatInterval: bigint, heartbeatIntervalModifier: number): bigint => {
  const calculatedHeartbeatInterval = heartbeatInterval + BigInt(heartbeatIntervalModifier);
  if (calculatedHeartbeatInterval < 0n) {
    logger.warn('Resulting heartbeat interval is negative. Setting it to 0.', {
      heartbeatInterval,
      heartbeatIntervalModifier,
    });
  }
  return calculatedHeartbeatInterval < 0n ? 0n : calculatedHeartbeatInterval;
};

export const getUpdatableFeeds = (
  batch: DecodedActiveDataFeedResponse[],
  deviationThresholdCoefficient: number,
  heartbeatIntervalModifier: number,
  individualBeaconUpdateSettings: IndividualBeaconUpdateSettings | null
): UpdatableDataFeed[] => {
  const updatableDataFeeds: UpdatableDataFeed[] = [];
  for (const dataFeedInfo of batch) {
    const {
      beaconsWithData,
      decodedUpdateParameters: { deviationThresholdInPercentage, deviationReference, heartbeatInterval },
      dataFeedValue,
      dataFeedTimestamp,
      decodedDapiName,
      dataFeedId,
    } = dataFeedInfo;
    logger.runWithContext({ dapiName: decodedDapiName, dataFeedId }, () => {
      // Fetch signed data and determine the value based on on-chain and off-chain data for each beacon.
      const aggregatedBeaconsWithData = beaconsWithData.map(({ beaconId, timestamp, value }) => {
        const onChainValue: BeaconValue = { timestamp, value };
        let signedData = getSignedData(beaconId);
        if (signedData && !isSignedDataFresh(signedData)) {
          const { airnode, templateId } = signedData;
          // This should not happen under normal circumstances. Something must be off with the Signed API.
          logger.warn("Not using the signed data because it's older than 24 hours.", {
            airnode,
            templateId,
          });
          signedData = undefined;
        }
        const offChainValue: BeaconValue | undefined = signedData
          ? {
              timestamp: BigInt(signedData.timestamp),
              value: decodeBeaconValue(signedData.encodedValue)!,
            }
          : undefined;

        const isUpdatable = offChainValue && offChainValue.timestamp > onChainValue.timestamp;

        return { isUpdatable, offChainValue, onChainValue, beaconId, signedData };
      });

      // Beacons are updatable when the off-chain timestamp is newer than the on-chain one. If we can't update the
      // timestamp, we reuse the on-chain value.
      //
      // NOTE: This guarantees that the off-chain data feed timestamp is greater or equal to the on-chain one.
      const beaconValues = aggregatedBeaconsWithData.map(({ isUpdatable, offChainValue, onChainValue }) =>
        isUpdatable ? offChainValue! : onChainValue
      );

      // Works for both beacon sets and single beacon feed.
      const newDataFeedValue = calculateMedian(beaconValues.map(({ value }) => value));
      const newDataFeedTimestamp = calculateMedian(beaconValues.map(({ timestamp }) => timestamp));

      const adjustedDeviationThreshold = adjustDeviationThreshold(
        deviationThresholdInPercentage,
        deviationThresholdCoefficient
      );

      const adjustedHeartbeatInterval = adjustHeartbeatInterval(heartbeatInterval, heartbeatIntervalModifier);

      const isBeaconSet = beaconValues.length > 1;

      // We need to make sure that the update transaction actually changes the
      // on-chain value. There are two cases:
      // 1. Data feed is a beacon - We need to make sure the off-chain data
      //    updates the feed. This requires timestamp to change. See:
      //    https://github.com/api3dao/airnode-protocol-v1/blob/65a77cdc23dc5434e143357a506327b9f0ccb7ef/contracts/api3-server-v1/DataFeedServer.sol#L120
      const isValidBeaconUpdate = !isBeaconSet && newDataFeedTimestamp !== dataFeedTimestamp;

      // 2. Data feed is a beacon set - We need to make sure that the beacon set will change. The contract requires the
      //    beacon set value or timestamp to change. See:
      //    https://github.com/api3dao/airnode-protocol-v1/blob/65a77cdc23dc5434e143357a506327b9f0ccb7ef/contracts/api3-server-v1/DataFeedServer.sol#L54
      // Note, that the beacon set value/timestamp is computed as median, so single beacon update may not result in a beacon set update.
      const isValidBeaconSetUpdate =
        isBeaconSet && (newDataFeedValue !== dataFeedValue || newDataFeedTimestamp !== dataFeedTimestamp);

      const dataFeedNeedsUpdate =
        (isValidBeaconUpdate || isValidBeaconSetUpdate) &&
        checkUpdateCondition(
          dataFeedValue,
          dataFeedTimestamp,
          newDataFeedValue,
          newDataFeedTimestamp,
          adjustedHeartbeatInterval,
          adjustedDeviationThreshold,
          deviationReference
        );

      if (dataFeedNeedsUpdate) {
        updatableDataFeeds.push({
          dataFeedInfo,
          updatableBeacons: aggregatedBeaconsWithData
            .filter(({ isUpdatable }) => isUpdatable)
            .map(({ beaconId, signedData }) => ({
              beaconId,
              signedData: signedData!,
            })),
          shouldUpdateBeaconSet: isBeaconSet,
        });
        return;
      }

      if (isBeaconSet && individualBeaconUpdateSettings) {
        // There is a special case when data feed is a beacon set that doesn't need
        // to be updated but some of its beacon constituents do. In this
        // particular case, Airseeker can update only these beacons and skip the
        // beacon set update.
        const updatableBeacons = aggregatedBeaconsWithData
          .filter(
            ({ isUpdatable, offChainValue, onChainValue, beaconId }) =>
              isUpdatable &&
              offChainValue &&
              logger.runWithContext(
                {
                  beaconId,
                },
                () => {
                  const {
                    deviationThresholdCoefficient: individualBeaconUpdateDeviationThresholdCoefficient,
                    heartbeatIntervalModifier: individualBeaconUpdateHeartbeatIntervalModifier,
                  } = individualBeaconUpdateSettings;

                  return checkUpdateCondition(
                    onChainValue.value,
                    onChainValue.timestamp,
                    offChainValue.value,
                    offChainValue.timestamp,
                    adjustHeartbeatInterval(adjustedHeartbeatInterval, individualBeaconUpdateHeartbeatIntervalModifier),
                    adjustDeviationThreshold(
                      adjustedDeviationThreshold,
                      individualBeaconUpdateDeviationThresholdCoefficient
                    ),
                    deviationReference
                  );
                }
              )
          )
          .map(({ beaconId, signedData }) => ({
            beaconId,
            signedData: signedData!,
          }));
        if (updatableBeacons && updatableBeacons.length > 0) {
          updatableDataFeeds.push({
            dataFeedInfo,
            updatableBeacons,
            shouldUpdateBeaconSet: false,
          });
        }
      }
    });
  }

  return updatableDataFeeds;
};
