import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { calculateMedian, checkUpdateConditions } from '../condition-check';
import { logger } from '../logger';
import { getStoreDataPoint } from '../signed-data-store';
import { getState } from '../state';
import type { BeaconId, ChainId, ProviderName } from '../types';
import { multiplyBigNumber } from '../utils';

import { getApi3ServerV1 } from './api3-server-v1';
import type { ReadDapiWithIndexResponse } from './dapi-data-registry';
import { decodeBeaconValue } from './update-feeds';
import type { UpdatableDapi } from './update-transactions';

export const getUpdatableFeeds = async (
  batch: ReadDapiWithIndexResponse[],
  deviationThresholdCoefficient: number,
  providerName: ProviderName,
  chainId: ChainId
): Promise<UpdatableDapi[]> => {
  const uniqueBeaconIds = [
    ...new Set(batch.flatMap((item) => item.decodedDataFeed.beacons.flatMap((beacon) => beacon.beaconId))),
  ];
  const onChainFeedValues = await multicallBeaconValues(uniqueBeaconIds, providerName, chainId);

  // Merge the latest values into the batch
  return (
    batch
      .map((dapi) => ({
        ...dapi,
        decodedDataFeed: {
          ...dapi.decodedDataFeed,
          beacons: dapi.decodedDataFeed.beacons.map((beacon) => {
            const onChainValue = onChainFeedValues.find((onChainValue) => beacon.beaconId === onChainValue.beaconId)
              ?.onChainValue ?? {
              value: ethers.BigNumber.from(1),
              timestamp: ethers.BigNumber.from(1),
            };
            const signedData = getStoreDataPoint(beacon.beaconId) ?? {
              timestamp: '1',
              airnode: ethers.constants.AddressZero,
              encodedValue: ethers.constants.HashZero,
              templateId: ethers.constants.HashZero,
              signature: ethers.constants.HashZero,
            };
            const offChainValue = {
              timestamp: ethers.BigNumber.from(signedData.timestamp),
              value: decodeBeaconValue(signedData.encodedValue)!,
            };

            const localDataIsInvalid =
              signedData?.airnode === ethers.constants.AddressZero ||
              offChainValue.timestamp.lt(onChainValue.timestamp) ||
              offChainValue.timestamp.gt(Math.ceil(Date.now() / 1000 + 60 * 60));
            const currentValue = offChainValue.timestamp.gt(onChainValue.timestamp) ? offChainValue : onChainValue;

            return {
              ...beacon,
              currentValue,
              localDataIsInvalid,
              signedData,
            };
          }),
        },
      }))
      // Filter out dapis that cannot be updated
      .filter((dapi) => {
        const newBeaconSetValue = calculateMedian(
          dapi.decodedDataFeed.beacons.map((beacon) => beacon.currentValue.value)
        );
        const newBeaconSetTimestamp = calculateMedian(
          dapi.decodedDataFeed.beacons.map((beacon) => beacon.currentValue.timestamp)
        )!.toNumber();
        const adjustedDeviationThresholdCoefficient = multiplyBigNumber(
          dapi.updateParameters.deviationThresholdInPercentage,
          deviationThresholdCoefficient
        );

        return checkUpdateConditions(
          dapi.dataFeedValue.value,
          dapi.dataFeedValue.timestamp,
          newBeaconSetValue,
          newBeaconSetTimestamp,
          dapi.updateParameters.heartbeatInterval,
          adjustedDeviationThresholdCoefficient
        );
      })
      // Transform the batch and exclude beacons that cannot be updated
      .map((dapiInfo) => ({
        dapiInfo,
        updatableBeacons: dapiInfo.decodedDataFeed.beacons
          .filter(({ localDataIsInvalid }) => !localDataIsInvalid)
          .map(({ beaconId, signedData }) => ({
            beaconId,
            signedData,
          })),
      }))
  );
};

interface OnChainValue {
  beaconId: string;
  onChainValue: { timestamp: ethers.BigNumber; value: ethers.BigNumber };
}

export const multicallBeaconValues = async (
  batch: BeaconId[],
  providerName: ProviderName,
  chainId: ChainId
): Promise<OnChainValue[]> => {
  const { config } = getState();
  const chain = config.chains[chainId]!;
  const { providers, contracts } = chain;

  const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);
  const server = getApi3ServerV1(contracts.Api3ServerV1, provider);
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  const feedCalldata = batch.map((beaconId) => ({
    beaconId,
    calldata: server.interface.encodeFunctionData('dataFeeds', [beaconId]),
  }));

  if (feedCalldata.length === 0) {
    return [];
  }

  const multicallResult = await go(
    async () => server.connect(voidSigner).callStatic.tryMulticall(feedCalldata.map((feed) => feed.calldata)),
    { retries: 1 }
  );

  if (!multicallResult.success) {
    logger.warn(`The multicall attempt to read potentially Updatable feed values has failed.`, {
      error: multicallResult.error,
    });
    throw multicallResult.error;
  }

  const { successes, returndata } = multicallResult.data;
  if (!(successes.length === feedCalldata.length && returndata.length === feedCalldata.length)) {
    throw new Error(`The number of returned records from the read multicall call does not match the number requested.`);
  }

  return feedCalldata
    .map(({ beaconId }, idx) => {
      if (successes[idx]) {
        const [value, timestamp] = ethers.utils.defaultAbiCoder.decode(['int224', 'uint32'], returndata[idx]!);

        return {
          beaconId,
          onChainValue: { timestamp: ethers.BigNumber.from(timestamp), value: ethers.BigNumber.from(value) },
        };
      }

      return null;
    })
    .filter((onChainValue): onChainValue is OnChainValue => onChainValue !== null);
};
