import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { zip } from 'lodash';

import { calculateMedian, checkUpdateConditions } from '../condition-check';
import type { DeviationThresholdCoefficient } from '../config/schema';
import { logger } from '../logger';
import { getStoreDataPoint } from '../signed-data-store';
import { getState } from '../state';
import type { ChainId, ProviderName } from '../types';
import { multiplyBigNumber } from '../utils';

import { getApi3ServerV1 } from './api3-server-v1';
import type { ReadDapiWithIndexResponse } from './dapi-data-registry';
import { decodeBeaconValue } from './update-feeds';
import type { UpdateableDapi } from './update-transactions';

export const shallowCheckFeeds = (
  batch: ReadDapiWithIndexResponse[],
  deviationThresholdCoefficient: DeviationThresholdCoefficient
): UpdateableDapi[] =>
  batch
    .map((dapiInfo): UpdateableDapi | null => {
      const beaconsSignedData = dapiInfo.decodedDataFeed.beacons.map((beacon) => getStoreDataPoint(beacon.beaconId));

      // Only update data feed when we have signed data for all constituent beacons.
      if (beaconsSignedData.some((signedData) => !signedData)) return null;

      const beaconsDecodedValues = beaconsSignedData.map((signedData) => decodeBeaconValue(signedData!.encodedValue));
      // Only update data feed when all beacon values are valid.
      if (beaconsDecodedValues.includes(null)) return null;

      // https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L163
      const newBeaconSetValue = calculateMedian(beaconsDecodedValues.map((decodedValue) => decodedValue!));
      const newBeaconSetTimestamp = calculateMedian(
        beaconsSignedData.map((signedData) => ethers.BigNumber.from(signedData!.timestamp))
      )!.toNumber();
      const adjustedDeviationThresholdCoefficient = multiplyBigNumber(
        dapiInfo.updateParameters.deviationThresholdInPercentage,
        deviationThresholdCoefficient
      );
      if (
        !checkUpdateConditions(
          dapiInfo.dataFeedValue.value,
          dapiInfo.dataFeedValue.timestamp,
          newBeaconSetValue,
          newBeaconSetTimestamp,
          dapiInfo.updateParameters.heartbeatInterval,
          adjustedDeviationThresholdCoefficient
        )
      ) {
        return null;
      }

      return {
        dapiInfo,
        updateableBeacons: zip(dapiInfo.decodedDataFeed.beacons, beaconsSignedData).map(([beacon, signedData]) => ({
          signedData: signedData!,
          beaconId: beacon!.beaconId,
        })),
      };
    })
    .filter((updateableDapi): updateableDapi is UpdateableDapi => updateableDapi !== null);

interface OnChainValue {
  beaconId: string;
  onChainValue: { timestamp: ethers.BigNumber; value: ethers.BigNumber };
}

export const callAndParseMulticall = async (
  batch: string[],
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
