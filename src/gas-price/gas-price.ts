import type { Address, Hex } from '@api3/commons';
import { go } from '@api3/promise-utils';
import type { ethers } from 'ethers';
import { maxBy, minBy, remove } from 'lodash';

import { logger } from '../logger';
import { type PendingTransactionInfo, getState, updateState } from '../state';
import { multiplyBigNumber, sanitizeEthersError } from '../utils';

export const initializeGasState = (chainId: string, providerName: string) =>
  updateState((draft) => {
    if (!draft.gasPrices[chainId]) draft.gasPrices[chainId] = {};
    draft.gasPrices[chainId]![providerName] = [];
  });

export const saveGasPrice = (chainId: string, providerName: string, gasPrice: bigint) =>
  updateState((draft) => {
    draft.gasPrices[chainId]![providerName]!.unshift({
      price: gasPrice,
      timestamp: Math.floor(Date.now() / 1000),
    });
  });

export const purgeOldGasPrices = (chainId: string, providerName: string, sanitizationSamplingWindow: number) =>
  updateState((draft) => {
    // Remove gasPrices older than the sanitizationSamplingWindow.
    remove(
      draft.gasPrices[chainId]![providerName]!,
      (gasPrice) => gasPrice.timestamp < Math.floor(Date.now() / 1000) - sanitizationSamplingWindow
    );
  });

export const getPercentile = (percentile: number, array: bigint[]) => {
  if (array.length === 0) return;

  array.sort((a, b) => (a > b ? 1 : -1));
  const index = Math.max(0, Math.ceil(array.length * (percentile / 100)) - 1);
  return array[index];
};

export const calculateScalingMultiplier = (
  recommendedGasPriceMultiplier: number,
  maxScalingMultiplier: number,
  lag: number,
  scalingWindow: number
) =>
  Math.min(
    recommendedGasPriceMultiplier + (maxScalingMultiplier - recommendedGasPriceMultiplier) * (lag / scalingWindow),
    maxScalingMultiplier
  );

export const fetchAndStoreGasPrice = async (
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider
) => {
  // Get the provider recommended gas price and save it to the state
  logger.debug('Fetching gas price and saving it to the state.');
  const goGasPrice = await go(async () => {
    const feeData = await provider.getFeeData();
    // We assume the legacy gas price will always exist. See:
    // https://api3workspace.slack.com/archives/C05TQPT7PNJ/p1699098552350519
    return feeData.gasPrice;
  });
  const gasPrice = goGasPrice.data;
  if (!goGasPrice.success) {
    logger.error('Failed to fetch gas price from RPC provider.', sanitizeEthersError(goGasPrice.error));
    return null;
  }
  if (!gasPrice) {
    logger.error('No gas price returned from RPC provider.');
    return null;
  }

  const state = getState();
  const {
    gasSettings: { sanitizationSamplingWindow },
  } = state.config.chains[chainId]!;
  saveGasPrice(chainId, providerName, gasPrice);
  purgeOldGasPrices(chainId, providerName, sanitizationSamplingWindow);
  return gasPrice;
};

export const getRecommendedGasPrice = (
  chainId: string,
  providerName: string,
  sponsorWalletAddress: Address,
  dataFeedIds: Hex[]
) => {
  const state = getState();
  // Get the oldest PendingTransactionInfo and if the oldest is not a single object then minBy will return the one with the largest consecutivelyUpdatableCount.
  const pendingTransactionInfo = minBy(
    dataFeedIds
      .map((dataFeedId) => state.pendingTransactionsInfo[chainId]?.[providerName]?.[sponsorWalletAddress]?.[dataFeedId])
      .sort((a, b) => (b?.consecutivelyUpdatableCount ?? 0) - (a?.consecutivelyUpdatableCount ?? 0)), // Sort by consecutivelyUpdatableCount
    (info) => info?.firstUpdatableTimestamp
  );

  const gasPrices = state.gasPrices[chainId]![providerName]!;
  const {
    gasSettings: {
      recommendedGasPriceMultiplier,
      sanitizationPercentile,
      sanitizationSamplingWindow,
      scalingWindow,
      maxScalingMultiplier,
      sanitizationMultiplier,
    },
  } = state.config.chains[chainId]!;

  let latestGasPrice: bigint | undefined;
  // Use the latest gas price that is stored in the state. We assume that the gas price is fetched frequently and has
  // been fetched immediately before making this call. In case it fails, we fallback to the previously stored gas price.
  if (gasPrices.length > 0) latestGasPrice = maxBy(gasPrices, (x) => x.timestamp)!.price;
  if (!latestGasPrice) {
    logger.warn('There is no gas price stored.');
    return null;
  }

  // Check if the next update is a retry of a pending transaction and scale the gas price accordingly.
  let gasPriceToUse = multiplyBigNumber(latestGasPrice, recommendedGasPriceMultiplier);
  if (pendingTransactionInfo && pendingTransactionInfo.consecutivelyUpdatableCount > 1) {
    const pendingPeriod = Math.floor(Date.now() / 1000) - pendingTransactionInfo.firstUpdatableTimestamp;
    const scalingMultiplier = calculateScalingMultiplier(
      recommendedGasPriceMultiplier,
      maxScalingMultiplier,
      pendingPeriod,
      scalingWindow
    );

    logger.warn('Scaling gas price.', {
      gasPrice: latestGasPrice.toString(),
      multiplier: scalingMultiplier,
      pendingPeriod,
    });
    gasPriceToUse = multiplyBigNumber(latestGasPrice, scalingMultiplier);
  }

  // Check that there are enough entries in the stored gas prices to determine whether to use sanitization or not
  // Calculate the minimum timestamp that should be within the 90% of the sanitizationSamplingWindow.
  const minTimestamp = Math.floor(Date.now() / 1000) - 0.9 * sanitizationSamplingWindow;
  // Check if there are entries with a timestamp older than at least 90% of the sanitizationSamplingWindow.
  const hasSufficientSanitizationData = gasPrices.some((gasPrice) => gasPrice.timestamp <= minTimestamp);
  // Get the configured gas price cap for sanitization.
  const sanitizationGasPriceCap = multiplyBigNumber(
    getPercentile(
      sanitizationPercentile,
      gasPrices.map((gasPrice) => gasPrice.price)
    )!,
    sanitizationMultiplier
  );

  // Log a warning if there is not enough historical data to sanitize the gas price but the price could be sanitized.
  if (!hasSufficientSanitizationData && gasPriceToUse > sanitizationGasPriceCap) {
    logger.warn('Gas price could be sanitized but there is not enough historical data.', {
      gasPrice: gasPriceToUse.toString(),
      sanitizationGasPriceCap: sanitizationGasPriceCap.toString(),
    });
  }
  // If necessary, sanitize the gas price and log a warning because this should not happen under normal circumstances.
  if (hasSufficientSanitizationData && gasPriceToUse > sanitizationGasPriceCap) {
    logger.warn('Sanitizing gas price.', {
      gasPrice: gasPriceToUse.toString(),
      sanitizationGasPriceCap: sanitizationGasPriceCap.toString(),
      ratio: (Number(gasPriceToUse) / Number(sanitizationGasPriceCap)).toFixed(2),
    });
    return sanitizationGasPriceCap;
  }

  return gasPriceToUse;
};
