import type { Api3ServerV1 } from '@api3/contracts';
import { go } from '@api3/promise-utils';

import { logger } from '../logger';
import { sanitizeEthersError } from '../utils';

import type { UpdatableBeacon } from './get-updatable-feeds';

export const handleRpcGasLimitFailure = (error: Error, fallbackGasLimit: number | undefined) => {
  const errorMessage = sanitizeEthersError(error).message;
  // It is possible that the gas estimation failed because of a contract revert due to timestamp check, because the feed
  // was updated by other provider in the meantime. Try to detect this expected case and log INFO instead.
  if (errorMessage.includes('Does not update timestamp')) {
    logger.info(`Gas estimation failed because of a contract revert.`, { errorMessage });
  } else {
    logger.warn(`Unable to estimate gas using provider.`, { errorMessage });
  }

  if (!fallbackGasLimit) {
    // Logging it as an INFO because in practice this would result in double logging of the same issue. If there is no
    // fallback gas limit specified it's expected that the update transcation will be skipped in case of gas limit
    // estimation failure.
    logger.info('No fallback gas limit provided. No gas limit to use.');
    return null;
  }

  return BigInt(fallbackGasLimit);
};

export const estimateSingleBeaconGasLimit = async (
  api3ServerV1: Api3ServerV1,
  beacon: UpdatableBeacon,
  fallbackGasLimit: number | undefined
) => {
  const { signedData } = beacon;

  const goEstimateGas = await go(async () =>
    api3ServerV1.updateBeaconWithSignedData.estimateGas(
      signedData.airnode,
      signedData.templateId,
      signedData.timestamp,
      signedData.encodedValue,
      signedData.signature
    )
  );
  if (goEstimateGas.success) return BigInt(goEstimateGas.data);
  return handleRpcGasLimitFailure(goEstimateGas.error, fallbackGasLimit);
};

export const estimateMulticallGasLimit = async (
  api3ServerV1: Api3ServerV1,
  calldatas: string[],
  fallbackGasLimit: number | undefined
) => {
  const goEstimateGas = await go(async () => api3ServerV1.multicall.estimateGas(calldatas));
  if (goEstimateGas.success) {
    // Adding a extra 10% because multicall consumes less gas than tryMulticall
    return (goEstimateGas.data * BigInt(Math.round(1.1 * 100))) / 100n;
  }
  return handleRpcGasLimitFailure(goEstimateGas.error, fallbackGasLimit);
};
