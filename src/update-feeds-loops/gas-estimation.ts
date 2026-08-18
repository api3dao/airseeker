import { go } from '@api3/commons';
import type { Api3ServerV1 } from '@api3/contracts';

import { logger } from '../logger';
import { multiplyBigNumber, sanitizeEthersError } from '../utils';

import type { Api3ServerV1BuilderTipExtension } from './contracts';
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

// The gas is estimated on the strict multicall variant (which reverts in case the update is no longer necessary)
// while the transaction is submitted using the try variant, which consumes slightly more gas, hence the extra 10%.
const estimateGasLimitWithBuffer = async (estimateGas: () => Promise<bigint>, fallbackGasLimit: number | undefined) => {
  const goEstimateGas = await go(estimateGas);
  if (goEstimateGas.success) return multiplyBigNumber(goEstimateGas.data, 1.1);
  return handleRpcGasLimitFailure(goEstimateGas.error, fallbackGasLimit);
};

export const estimateMulticallGasLimit = async (
  api3ServerV1: Api3ServerV1,
  calldatas: string[],
  fallbackGasLimit: number | undefined
) => estimateGasLimitWithBuffer(async () => api3ServerV1.multicall.estimateGas(calldatas), fallbackGasLimit);

// Extra headroom for the tip transfer, whose gas cost at inclusion time can exceed the one at estimation time because
// the coinbase of the including block may be an empty account or a contract with a costly receive function.
const BUILDER_TIP_TRANSFER_GAS_HEADROOM = 30_000n;

export const estimateBuilderTipMulticallGasLimit = async (
  api3ServerV1BuilderTipExtension: Api3ServerV1BuilderTipExtension,
  calldatas: string[]
) => {
  // A placeholder tip of 1 wei is used because "multicallAndTip" requires a non-zero value to be sent. There is
  // deliberately no fallback gas limit, because it is calibrated for the cheaper direct Api3ServerV1 multicall. The
  // caller falls back to an untipped update when the estimation fails.
  const gasLimit = await estimateGasLimitWithBuffer(
    async () => api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas(calldatas, { value: 1n }),
    undefined
  );
  return gasLimit === null ? null : gasLimit + BUILDER_TIP_TRANSFER_GAS_HEADROOM;
};
