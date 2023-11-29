import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { calculateMedian, isDataFeedUpdatable } from '../deviation-check';
import { logger } from '../logger';
import { getSignedData } from '../signed-data-store';
import { getState } from '../state';
import type { BeaconId, ChainId } from '../types';
import { multiplyBigNumber } from '../utils';

import { getApi3ServerV1 } from './api3-server-v1';
import type { DecodedReadDapiWithIndexResponse } from './dapi-data-registry';
import { decodeBeaconValue } from './update-feeds';
import type { UpdatableDapi } from './update-transactions';

interface BeaconValue {
  timestamp: ethers.BigNumber;
  value: ethers.BigNumber;
}

export const getUpdatableFeeds = async (
  batch: DecodedReadDapiWithIndexResponse[],
  deviationThresholdCoefficient: number,
  provider: ethers.providers.StaticJsonRpcProvider,
  chainId: ChainId
): Promise<UpdatableDapi[]> => {
  const uniqueBeaconIds = [
    ...new Set(batch.flatMap((item) => item.decodedDataFeed.beacons.flatMap((beacon) => beacon.beaconId))),
  ];
  const goOnChainFeedValues = await go(async () => multicallBeaconValues(uniqueBeaconIds, provider, chainId));
  if (!goOnChainFeedValues.success) {
    logger.error(
      `Multicalling on-chain data feed values has failed. Skipping update for all dAPIs in a batch`,
      goOnChainFeedValues.error,
      { dapiNames: batch.map((dapi) => dapi.decodedDapiName) }
    );
    return [];
  }
  const onChainFeedValues = goOnChainFeedValues.data;

  return (
    batch
      // Determine on-chain and off-chain values for each beacon.
      .map((dapiInfo) => {
        const beaconsWithData = dapiInfo.decodedDataFeed.beacons.map(({ beaconId }) => {
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
          dapiInfo,
          beaconsWithData,
        };
      })
      // Filter out dapis that cannot be updated.
      .filter(({ dapiInfo, beaconsWithData }) => {
        const beaconValues = beaconsWithData.map(({ onChainValue, offChainValue, isUpdatable }) =>
          isUpdatable ? offChainValue! : onChainValue
        );

        const newBeaconSetValue = calculateMedian(beaconValues.map(({ value }) => value));
        const newBeaconSetTimestamp = calculateMedian(beaconValues.map(({ timestamp }) => timestamp))!.toNumber();

        const { updateParameters, dataFeedValue } = dapiInfo;
        const adjustedDeviationThresholdCoefficient = multiplyBigNumber(
          updateParameters.deviationThresholdInPercentage,
          deviationThresholdCoefficient
        );

        return isDataFeedUpdatable(
          dataFeedValue.value,
          dataFeedValue.timestamp,
          newBeaconSetValue,
          newBeaconSetTimestamp,
          updateParameters.heartbeatInterval,
          adjustedDeviationThresholdCoefficient
        );
      })
      // Compute the updateable beacons.
      .map(({ dapiInfo, beaconsWithData }) => ({
        dapiInfo,
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
): Promise<Record<BeaconId, BeaconValue>> => {
  const { config } = getState();
  const chain = config.chains[chainId]!;
  const { contracts } = chain;

  const server = getApi3ServerV1(contracts.Api3ServerV1, provider);
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);
  const feedCalldata = batch.map((beaconId) => ({
    beaconId,
    calldata: server.interface.encodeFunctionData('dataFeeds', [beaconId]),
  }));

  // Calling the dataFeeds contract function is guaranteed not to revert, so we are not checking the multicall successes
  // and using returndata directly. If the call fails (e.g. timeout or RPC error) we let the parent handle it.
  const { returndata } = await server
    .connect(voidSigner)
    .callStatic.tryMulticall(feedCalldata.map((feed) => feed.calldata));

  const onChainValues: Record<BeaconId, BeaconValue> = {};
  for (const [idx, beaconId] of batch.entries()) {
    const [value, timestamp] = ethers.utils.defaultAbiCoder.decode(['int224', 'uint32'], returndata[idx]!);
    onChainValues[beaconId] = { timestamp: ethers.BigNumber.from(timestamp), value: ethers.BigNumber.from(value) };
  }
  return onChainValues;
};
