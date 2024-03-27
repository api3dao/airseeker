import { HUNDRED_PERCENT } from '../constants';
import { logger } from '../logger';
import { abs } from '../utils';

export const calculateDeviationPercentage = (initialValue: bigint, updatedValue: bigint) => {
  const delta = updatedValue - initialValue;
  const absoluteDelta = abs(delta);

  // Avoid division by 0
  const absoluteInitialValue = initialValue === 0n ? 1n : abs(initialValue);

  return (absoluteDelta * BigInt(HUNDRED_PERCENT)) / absoluteInitialValue;
};

export const calculateMedian = (arr: bigint[]) => {
  if (arr.length === 0) throw new Error('Cannot calculate median of empty array');
  const mid = Math.floor(arr.length / 2);

  const nums = [...arr].sort((a, b) => {
    if (a < b) return -1;
    else if (a > b) return 1;
    else return 0;
  });

  return arr.length % 2 === 0 ? (nums[mid - 1]! + nums[mid]!) / 2n : nums[mid]!;
};

export const isDeviationThresholdExceeded = (onChainValue: bigint, deviationThreshold: bigint, apiValue: bigint) => {
  const updateInPercentage = calculateDeviationPercentage(onChainValue, apiValue);

  return updateInPercentage > deviationThreshold;
};

/**
 * Returns true when the on chain data timestamp is newer than the heartbeat interval.
 */
export const isOnChainDataFresh = (timestamp: bigint, heartbeatInterval: bigint) =>
  BigInt(timestamp) > BigInt(Math.floor(Date.now() / 1000)) - heartbeatInterval;

export const isDataFeedUpdatable = (
  onChainValue: bigint,
  onChainTimestamp: bigint,
  offChainValue: bigint,
  offChainTimestamp: bigint,
  heartbeatInterval: bigint,
  deviationThreshold: bigint
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
    logger.info(`On-chain timestamp is older than the heartbeat interval.`);
    return true;
  }

  return false;
};
