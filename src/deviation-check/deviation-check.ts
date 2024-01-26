import type { BigNumber, ethers } from 'ethers';

import { HUNDRED_PERCENT } from '../constants';
import { logger } from '../logger';

export const calculateDeviationPercentage = (initialValue: ethers.BigNumber, updatedValue: ethers.BigNumber) => {
  const delta = updatedValue.sub(initialValue);
  const absoluteDelta = delta.abs();

  // Avoid division by 0
  const absoluteInitialValue = initialValue.isZero() ? BigInt(1) : initialValue.abs();

  return absoluteDelta.mul(BigInt(HUNDRED_PERCENT)).div(absoluteInitialValue);
};

export const calculateMedian = (arr: ethers.BigNumber[]) => {
  if (arr.length === 0) throw new Error('Cannot calculate median of empty array');
  const mid = Math.floor(arr.length / 2);

  const nums = [...arr].sort((a, b) => {
    if (a.lt(b)) return -1;
    else if (a.gt(b)) return 1;
    else return 0;
  });

  return arr.length % 2 === 0 ? nums[mid - 1]!.add(nums[mid]!).div(2) : nums[mid]!;
};

export const isDeviationThresholdExceeded = (
  onChainValue: ethers.BigNumber,
  deviationThreshold: ethers.BigNumber,
  apiValue: ethers.BigNumber
) => {
  const updateInPercentage = calculateDeviationPercentage(onChainValue, apiValue);

  return updateInPercentage.gt(deviationThreshold);
};

/**
 * Returns true when the on chain data timestamp is newer than the heartbeat interval.
 */
export const isOnChainDataFresh = (timestamp: number, heartbeatInterval: BigNumber) =>
  timestamp > Date.now() / 1000 - heartbeatInterval.toNumber();

export const isDataFeedUpdatable = (
  onChainValue: ethers.BigNumber,
  onChainTimestamp: number,
  offChainValue: ethers.BigNumber,
  offChainTimestamp: number,
  heartbeatInterval: BigNumber,
  deviationThreshold: BigNumber
): boolean => {
  // Check that fulfillment data is newer than on chain data. Update transaction with stale data would revert on chain,
  // draining the sponsor wallet. See:
  // https://github.com/api3dao/airnode-protocol-v1/blob/dev/contracts/dapis/DataFeedServer.sol#L121
  if (offChainTimestamp <= onChainTimestamp) {
    if (offChainTimestamp < onChainTimestamp) {
      logger.warn(`Off-chain sample's timestamp is older than on-chain timestamp.`);
    }
    return false;
  }

  // Check that on chain data is newer than heartbeat interval
  const isFreshEnough = isOnChainDataFresh(onChainTimestamp, heartbeatInterval);
  if (isFreshEnough) {
    // Check beacon condition
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, deviationThreshold, offChainValue);
    if (shouldUpdate) {
      logger.info(`Deviation exceeded.`);
      return true;
    }
  } else {
    logger.debug(`On-chain timestamp is older than the heartbeat interval.`);
    return true;
  }

  return false;
};
