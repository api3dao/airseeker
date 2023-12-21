import { Api3ServerV1__factory as Api3ServerV1Factory } from '@api3/airnode-protocol-v1';
import { ethers } from 'ethers';

// NOTE: The contract is not yet published, so we generate the Typechain artifacts locally and import it from there.
import { type AirseekerRegistry, AirseekerRegistry__factory as AirseekerRegistryFactory } from '../typechain-types';
import type { DecodedDataFeed } from '../types';
import { decodeDapiName, deriveBeaconId, deriveBeaconSetId } from '../utils';

export const getApi3ServerV1 = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  Api3ServerV1Factory.connect(address, provider);

export const getAirseekerRegistry = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  AirseekerRegistryFactory.connect(address, provider);

export const verifyMulticallResponse = (
  response: Awaited<ReturnType<AirseekerRegistry['callStatic']['tryMulticall']>>
) => {
  const { successes, returndata } = response;

  if (!successes.every(Boolean)) throw new Error('One of the multicalls failed');
  return returndata;
};

export const decodeActiveDataFeedCountResponse = (
  airseekerRegistry: AirseekerRegistry,
  activeDataFeedCountReturndata: string
) => {
  const activeDataFeedCount = airseekerRegistry.interface.decodeFunctionResult(
    'activeDataFeedCount',
    activeDataFeedCountReturndata
  )[0] as Awaited<ReturnType<AirseekerRegistry['activeDataFeedCount']>>;
  return activeDataFeedCount.toNumber();
};

export const decodeDataFeedDetails = (dataFeed: string): DecodedDataFeed => {
  if (dataFeed.length === 130) {
    // (64 [actual bytes] * 2[hex encoding] ) + 2 [for the '0x' preamble]
    // This is a hex encoded string, the contract works with bytes directly
    const [airnodeAddress, templateId] = ethers.utils.defaultAbiCoder.decode(['address', 'bytes32'], dataFeed);

    const dataFeedId = deriveBeaconId(airnodeAddress, templateId)!;

    return { dataFeedId, beacons: [{ beaconId: dataFeedId, airnodeAddress, templateId }] };
  }

  const [airnodeAddresses, templateIds] = ethers.utils.defaultAbiCoder.decode(['address[]', 'bytes32[]'], dataFeed);

  const beacons = (airnodeAddresses as string[]).map((airnodeAddress: string, idx: number) => {
    const templateId = templateIds[idx] as string;
    const beaconId = deriveBeaconId(airnodeAddress, templateId)!;

    return { beaconId, airnodeAddress, templateId };
  });

  const dataFeedId = deriveBeaconSetId(beacons.map((b) => b.beaconId))!;

  return { dataFeedId, beacons };
};

export interface DecodedUpdateParameters {
  deviationReference: ethers.BigNumber;
  deviationThresholdInPercentage: ethers.BigNumber;
  heartbeatInterval: ethers.BigNumber;
}

export const decodeUpdateParameters = (updateParameters: string) => {
  // https://github.com/api3dao/airnode-protocol-v1/blob/5f861715749e182e334c273d6a52c4f2560c7994/contracts/api3-server-v1/extensions/BeaconSetUpdatesWithPsp.sol#L122
  const [deviationThresholdInPercentage, deviationReference, heartbeatInterval] = ethers.utils.defaultAbiCoder.decode(
    ['uint256', 'int224', 'uint256'],
    updateParameters
  );

  return {
    deviationReference,
    deviationThresholdInPercentage,
    heartbeatInterval,
  };
};

export const decodeActiveDataFeedResponse = (
  airseekerRegistry: AirseekerRegistry,
  activeDataFeedReturndata: string
) => {
  const { dapiName, updateParameters, dataFeedValue, dataFeedTimestamp, dataFeedDetails, signedApiUrls } =
    airseekerRegistry.interface.decodeFunctionResult('activeDataFeed', activeDataFeedReturndata) as Awaited<
      ReturnType<AirseekerRegistry['activeDataFeed']>
    >;

  // https://github.com/api3dao/dapi-management/pull/3/files#diff-b6941851ebc92dc9691bbf0cb701fe9c4595cb78488c3bb92ad6e4b917719f4fR346
  const decodedDataFeed = decodeDataFeedDetails(dataFeedDetails);

  // The dAPI name will be set to zero (in bytes32) in case the data feed is not a dAPI and is identified by a data feed
  // ID.
  const decodedDapiName = decodeDapiName(dapiName);

  return {
    dapiName: decodedDapiName === '' ? null : dapiName, // NOTE: Anywhere in the codebase the "dapiName" is the encoded version of the dAPI name.
    decodedDapiName: decodedDapiName === '' ? null : decodedDapiName,
    decodedUpdateParameters: decodeUpdateParameters(updateParameters),
    dataFeedValue,
    dataFeedTimestamp,
    decodedDataFeed,
    signedApiUrls,
  };
};

export type DecodedActiveDataFeedResponse = ReturnType<typeof decodeActiveDataFeedResponse>;
