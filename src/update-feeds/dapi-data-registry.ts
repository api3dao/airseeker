import { ethers } from 'ethers';

// NOTE: The contract is not yet published, so we generate the Typechain artifacts locally and import it from there.
import { type DapiDataRegistry, DapiDataRegistry__factory } from '../../typechain-types';
import type { DecodedDataFeed } from '../types';
import { deriveBeaconId, deriveBeaconSetId } from '../utils';

export const getDapiDataRegistry = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  DapiDataRegistry__factory.connect(address, provider);

export const verifyMulticallResponse = (
  response: Awaited<ReturnType<DapiDataRegistry['callStatic']['tryMulticall']>>
) => {
  const { successes, returndata } = response;

  if (!successes.every(Boolean)) throw new Error('One of the multicalls failed');
  return returndata;
};

export const decodeDapisCountResponse = (dapiDataRegistry: DapiDataRegistry, dapisCountReturndata: string) => {
  const dapisCount = dapiDataRegistry.interface.decodeFunctionResult('dapisCount', dapisCountReturndata)[0] as Awaited<
    ReturnType<DapiDataRegistry['dapisCount']>
  >;
  return dapisCount.toNumber();
};

export type DapisCountResponse = ReturnType<typeof decodeDapisCountResponse>;

export const decodeDataFeed = (dataFeed: string): DecodedDataFeed => {
  if (dataFeed.length === 130) {
    // (64 * 2) - 2
    // hex encoded string, contract works with bytes directly
    const [airnodeAddress, templateId] = ethers.utils.defaultAbiCoder.decode(['address', 'bytes32'], dataFeed);

    const dataFeedId = deriveBeaconId(airnodeAddress, templateId)!;

    return { dataFeedId, dataFeeds: [{ dataFeedId, airnodeAddress, templateId }] };
  }

  const [airnodeAddresses, templateIds] = ethers.utils.defaultAbiCoder.decode(['address[]', 'bytes32[]'], dataFeed);

  const dataFeeds = (airnodeAddresses as string[]).map((airnodeAddress: string, idx: number) => {
    const templateId = templateIds[idx] as string;
    const dataFeedId = deriveBeaconId(airnodeAddress, templateId)!;

    return { dataFeedId, airnodeAddress, templateId };
  });

  const dataFeedId = deriveBeaconSetId(dataFeeds.map((df) => df.dataFeedId))!;

  return { dataFeedId, dataFeeds };
};

export const decodeReadDapiWithIndexResponse = (
  dapiDataRegistry: DapiDataRegistry,
  readDapiWithIndexReturndata: string
) => {
  const { dapiName, updateParameters, dataFeedValue, dataFeed, signedApiUrls } =
    dapiDataRegistry.interface.decodeFunctionResult('readDapiWithIndex', readDapiWithIndexReturndata) as Awaited<
      ReturnType<DapiDataRegistry['readDapiWithIndex']>
    >;

  // Ethers responses are returned as a combination of array and object. When such object is logged, only the array part
  // is logged. To make the logs more readable, we convert the object part to a plain object.
  const { deviationReference, deviationThresholdInPercentage, heartbeatInterval } = updateParameters;
  const { value, timestamp } = dataFeedValue;

  // https://github.com/api3dao/dapi-management/pull/3/files#diff-b6941851ebc92dc9691bbf0cb701fe9c4595cb78488c3bb92ad6e4b917719f4fR346
  const decodedDataFeed = decodeDataFeed(dataFeed);

  return {
    dapiName,
    updateParameters: {
      deviationReference,
      deviationThresholdInPercentage,
      heartbeatInterval,
    },
    dataFeedValue: { value, timestamp },
    dataFeed: decodedDataFeed,
    signedApiUrls,
  };
};

export type ReadDapiWithIndexResponse = ReturnType<typeof decodeReadDapiWithIndexResponse>;
