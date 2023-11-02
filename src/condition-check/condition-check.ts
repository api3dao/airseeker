import { type BigNumber, ethers } from 'ethers';

import { HUNDRED_PERCENT } from '../constants';
import { logger } from '../logger';

export const calculateUpdateInPercentage = (initialValue: ethers.BigNumber, updatedValue: ethers.BigNumber) => {
  const delta = updatedValue.sub(initialValue);
  const absoluteDelta = delta.abs();

  // Avoid division by 0
  const absoluteInitialValue = initialValue.isZero() ? ethers.BigNumber.from(1) : initialValue.abs();

  return absoluteDelta.mul(ethers.BigNumber.from(HUNDRED_PERCENT)).div(absoluteInitialValue);
};

export const calculateMedian = (arr: ethers.BigNumber[]) => {
  const mid = Math.floor(arr.length / 2);

  const nums = [...arr].sort((a, b) => {
    if (a.lt(b)) return -1;
    else if (a.gt(b)) return 1;
    else return 0;
  });

  return arr.length % 2 === 0 ? nums[mid - 1]!.add(nums[mid]!).div(2) : nums[mid];
};

/**
 * Checks if the deviation threshold has been exceeded.
 *
 * @param onChainValue
 * @param deviationThreshold Refer to getDeviationThresholdAsBigNumber()
 * @param apiValue
 */
export const checkDeviationThresholdExceeded = (
  onChainValue: ethers.BigNumber,
  deviationThreshold: ethers.BigNumber,
  apiValue: ethers.BigNumber
) => {
  const updateInPercentage = calculateUpdateInPercentage(onChainValue, apiValue);

  return updateInPercentage.gt(deviationThreshold);
};

/**
 * Returns true when the fulfillment data timestamp is newer than the on chain data timestamp.
 *
 * Update transaction with stale data would revert on chain, draining the sponsor wallet. See:
 * https://github.com/api3dao/airnode-protocol-v1/blob/dev/contracts/dapis/DataFeedServer.sol#L121
 * This can happen if the gateway or Airseeker is down and Airkeeper does the updates instead.
 */
export const checkFulfillmentDataTimestamp = (onChainDataTimestamp: number, fulfillmentDataTimestamp: number) =>
  onChainDataTimestamp < fulfillmentDataTimestamp;

/**
 * Returns true when the on chain data timestamp is newer than the heartbeat interval.
 */
export const checkOnchainDataFreshness = (timestamp: number, heartbeatInterval: number) =>
  timestamp > Date.now() / 1000 - heartbeatInterval;

export const checkUpdateConditions = (
  onChainValue: ethers.BigNumber,
  onChainTimestamp: number,
  offChainValue: ethers.BigNumber,
  offChainTimestamp: number,
  heartbeatInterval: number,
  deviationThreshold: BigNumber
): boolean => {
  // Check that fulfillment data is newer than on chain data
  const isFulfillmentDataFresh = checkFulfillmentDataTimestamp(onChainTimestamp, offChainTimestamp);
  if (!isFulfillmentDataFresh) {
    logger.warn(`Off-chain sample's timestamp is older than on-chain timestamp.`);

    return false;
  }

  // Check that on chain data is newer than heartbeat interval
  const isOnchainDataFresh = checkOnchainDataFreshness(onChainTimestamp, heartbeatInterval);
  if (isOnchainDataFresh) {
    // Check beacon condition
    const shouldUpdate = checkDeviationThresholdExceeded(onChainValue, deviationThreshold, offChainValue);
    if (shouldUpdate) {
      logger.info(`Deviation exceeded.`);

      return true;
    }
  } else {
    logger.info(`On-chain timestamp is older than the heartbeat interval.`);

    return true;
  }

  return false;
};
