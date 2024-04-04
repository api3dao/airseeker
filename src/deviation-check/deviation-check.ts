import { HUNDRED_PERCENT, UINT256_MAX } from '../constants';
import { logger } from '../logger';
import { abs } from '../utils';

export const calculateDeviationPercentage = (
  initialValue: bigint,
  updatedValue: bigint,
  deviationReference: bigint
) => {
  const absoluteDelta = abs(updatedValue - initialValue);
  if (absoluteDelta === 0n) return 0n;

  const absoluteInitialValue = abs(deviationReference - initialValue);
  if (!absoluteInitialValue) return UINT256_MAX;

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

export const isDeviationThresholdExceeded = (
  onChainValue: bigint,
  deviationThreshold: bigint,
  apiValue: bigint,
  deviationReference: bigint
) => {
  const updateInPercentage = calculateDeviationPercentage(onChainValue, apiValue, deviationReference);

  return updateInPercentage >= deviationThreshold;
};

export const isHeartbeatUpdatable = (timestamp: bigint, heartbeatInterval: bigint) =>
  BigInt(timestamp) + heartbeatInterval <= BigInt(Math.floor(Date.now() / 1000));

// Mirroring the logic of https://github.com/api3dao/airnode-protocol-v1/blob/65a77cdc23dc5434e143357a506327b9f0ccb7ef/contracts/api3-server-v1/extensions/BeaconSetUpdatesWithPsp.sol#L111
export const isDataFeedUpdatable = (
  onChainValue: bigint,
  onChainTimestamp: bigint,
  offChainValue: bigint,
  offChainTimestamp: bigint,
  heartbeatInterval: bigint,
  deviationThreshold: bigint,
  deviationReference: bigint
): boolean => {
  if (onChainTimestamp === 0n && offChainTimestamp > 0) return true;
  if (
    deviationThreshold &&
    isDeviationThresholdExceeded(onChainValue, deviationThreshold, offChainValue, deviationReference)
  ) {
    logger.info(`Deviation exceeded.`);
    return true;
  }
  if (heartbeatInterval && isHeartbeatUpdatable(onChainTimestamp, heartbeatInterval)) {
    logger.info(`On-chain timestamp is older than the heartbeat interval.`);
    return true;
  }

  return false;
};
