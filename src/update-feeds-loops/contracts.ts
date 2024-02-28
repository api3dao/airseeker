import { ethers } from 'ethers';
import { zip } from 'lodash';

import {
  type AirseekerRegistry,
  AirseekerRegistry__factory as AirseekerRegistryFactory,
  Api3ServerV1__factory as Api3ServerV1Factory,
} from '../typechain-types';
import type { AirnodeAddress, TemplateId } from '../types';
import { decodeDapiName, deriveBeaconId } from '../utils';

export const getApi3ServerV1 = (address: string, provider: ethers.JsonRpcProvider) =>
  Api3ServerV1Factory.connect(address, provider);

export const getAirseekerRegistry = (address: string, provider: ethers.JsonRpcProvider) =>
  AirseekerRegistryFactory.connect(address, provider);

export const verifyMulticallResponse = (
  response: Awaited<ReturnType<AirseekerRegistry['tryMulticall']['staticCall']>>
) => {
  const { successes, returndata } = response;

  if (!successes.every(Boolean)) throw new Error('One of the multicalls failed');
  return returndata;
};

export const decodeActiveDataFeedCountResponse = Number;

export const decodeGetBlockNumberResponse = Number;

export const decodeGetChainIdResponse = Number;

export interface Beacon {
  airnodeAddress: AirnodeAddress;
  templateId: TemplateId;
  beaconId: string;
}

export const decodeDataFeedDetails = (dataFeed: string): Beacon[] | null => {
  // The contract returns empty bytes if the data feed is not registered. See:
  // https://github.com/bbenligiray/api3-contracts/blob/d394581549e4d2f343e9910bc330b21266808851/contracts/AirseekerRegistry.sol#L346
  if (dataFeed === '0x') return null;

  // This is a hex encoded string, the contract works with bytes directly
  // 2 characters for the '0x' preamble + 32 * 2 hexadecimals for 32 bytes + 32 * 2 hexadecimals for 32 bytes
  if (dataFeed.length === 2 + 32 * 2 + 32 * 2) {
    const [airnodeAddress, templateId] = ethers.AbiCoder.defaultAbiCoder().decode(['address', 'bytes32'], dataFeed);

    const dataFeedId = deriveBeaconId(airnodeAddress, templateId)!;

    return [{ beaconId: dataFeedId, airnodeAddress, templateId }];
  }

  const [airnodeAddresses, templateIds] = ethers.AbiCoder.defaultAbiCoder().decode(
    ['address[]', 'bytes32[]'],
    dataFeed
  );

  const beacons = (airnodeAddresses as string[]).map((airnodeAddress: string, idx: number) => {
    const templateId = templateIds[idx] as string;
    const beaconId = deriveBeaconId(airnodeAddress, templateId)!;

    return { beaconId, airnodeAddress, templateId };
  });

  return beacons;
};

export interface DecodedUpdateParameters {
  deviationReference: bigint;
  deviationThresholdInPercentage: bigint;
  heartbeatInterval: bigint;
}

export const decodeUpdateParameters = (updateParameters: string): DecodedUpdateParameters => {
  // https://github.com/api3dao/airnode-protocol-v1/blob/5f861715749e182e334c273d6a52c4f2560c7994/contracts/api3-server-v1/extensions/BeaconSetUpdatesWithPsp.sol#L122
  const [deviationThresholdInPercentage, deviationReference, heartbeatInterval] =
    ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'int224', 'uint256'], updateParameters);
  // 2 characters for the '0x' preamble + 3 parameters, 32 * 2 hexadecimals for 32 bytes each
  if (updateParameters.length !== 2 + 3 * (32 * 2)) {
    throw new Error(`Unexpected trailing data in update parameters`);
  }

  return {
    deviationReference,
    deviationThresholdInPercentage,
    heartbeatInterval,
  };
};

export interface BeaconWithData extends Beacon {
  value: bigint;
  timestamp: bigint;
}

export interface DecodedActiveDataFeedResponse {
  dapiName: string | null; // NOTE: Encoded dAPI name
  decodedDapiName: string | null;
  updateParameters: string; // NOTE: Encoded update parameters
  decodedUpdateParameters: DecodedUpdateParameters;
  dataFeedId: string;
  dataFeedValue: bigint;
  dataFeedTimestamp: bigint;
  beaconsWithData: BeaconWithData[];
  signedApiUrls: string[];
}

export const createBeaconsWithData = (beacons: Beacon[], beaconValues: bigint[], beaconTimestamps: bigint[]) => {
  return zip(beacons, beaconValues, beaconTimestamps).map(([beacon, value, timestamp]) => ({
    ...beacon!,
    value: value!,
    timestamp: BigInt(timestamp!),
  }));
};

export const decodeActiveDataFeedResponse = (
  airseekerRegistry: AirseekerRegistry,
  activeDataFeedReturndata: string
): DecodedActiveDataFeedResponse | null => {
  const {
    dataFeedId,
    dapiName,
    updateParameters,
    dataFeedValue,
    dataFeedTimestamp,
    dataFeedDetails,
    signedApiUrls,
    beaconValues,
    beaconTimestamps,
  } = airseekerRegistry.interface.decodeFunctionResult(
    'activeDataFeed',
    activeDataFeedReturndata
  ) as unknown as Awaited<ReturnType<AirseekerRegistry['activeDataFeed']['staticCall']>>;

  // https://github.com/bbenligiray/api3-contracts/blob/d394581549e4d2f343e9910bc330b21266808851/contracts/AirseekerRegistry.sol#L295
  const beacons = decodeDataFeedDetails(dataFeedDetails);
  if (!beacons) return null;
  const beaconsWithData = createBeaconsWithData(beacons, beaconValues, beaconTimestamps);

  // The dAPI name will be set to zero (in bytes32) in case the data feed is not a dAPI and is identified by a data feed
  // ID.
  const decodedDapiName = decodeDapiName(dapiName);

  return {
    dapiName: decodedDapiName === '' ? null : dapiName,
    decodedDapiName: decodedDapiName === '' ? null : decodedDapiName,
    updateParameters,
    decodedUpdateParameters: decodeUpdateParameters(updateParameters),
    dataFeedId,
    dataFeedValue,
    dataFeedTimestamp,
    beaconsWithData,
    signedApiUrls,
  };
};
