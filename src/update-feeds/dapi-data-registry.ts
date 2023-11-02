import type { ethers } from 'ethers';

// NOTE: The contract is not yet published, so we generate the Typechain artifacts locally and import it from there.
import { type DapiDataRegistry, DapiDataRegistry__factory } from '../../typechain-types';

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
  return {
    dapiName,
    updateParameters: {
      deviationReference,
      deviationThresholdInPercentage,
      heartbeatInterval,
    },
    dataFeedValue: { value, timestamp },
    dataFeed,
    signedApiUrls,
  };
};

export type ReadDapiWithIndexResponse = ReturnType<typeof decodeReadDapiWithIndexResponse>;
