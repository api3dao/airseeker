import { go } from '@api3/promise-utils';
import type { ethers } from 'ethers';
import { remove } from 'lodash';

import { logger } from '../logger';
import { getState, updateState } from '../state';
import { multiplyBigNumber } from '../utils';

export const initializeGasState = (chainId: string, providerName: string) =>
  updateState((draft) => {
    if (!draft.gasPrices[chainId]) {
      draft.gasPrices[chainId] = {};
    }

    draft.gasPrices[chainId]![providerName] = { gasPrices: [], sponsorLastUpdateTimestamp: {} };
  });

/**
 * Saves a gas price into the state.
 * @param chainId
 * @param providerName
 * @param gasPrice
 */
export const saveGasPrice = (chainId: string, providerName: string, gasPrice: bigint) =>
  updateState((draft) => {
    draft.gasPrices[chainId]![providerName]!.gasPrices.unshift({
      price: gasPrice,
      timestamp: Math.floor(Date.now() / 1000),
    });
  });

/**
 * Removes gas prices where the timestamp is older than sanitizationSamplingWindow from the state.
 * @param chainId
 * @param providerName
 * @param sanitizationSamplingWindow
 */
export const purgeOldGasPrices = (chainId: string, providerName: string, sanitizationSamplingWindow: number) =>
  updateState((draft) => {
    // Remove gasPrices older than the sanitizationSamplingWindow.
    remove(
      draft.gasPrices[chainId]![providerName]!.gasPrices,
      (gasPrice) => gasPrice.timestamp < Math.floor(Date.now() / 1000) - sanitizationSamplingWindow
    );
  });

/**
 * Saves a sponsor wallet's last update timestamp into the state.
 * @param chainId
 * @param providerName
 * @param sponsorWalletAddress
 */
export const setSponsorLastUpdateTimestamp = (chainId: string, providerName: string, sponsorWalletAddress: string) => {
  updateState((draft) => {
    draft.gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestamp[sponsorWalletAddress] = Math.floor(
      Date.now() / 1000
    );
  });
};

/**
 * Removes a sponsor wallet's last update timestamp from the state.
 * @param chainId
 * @param providerName
 * @param sponsorWalletAddress
 */
export const clearSponsorLastUpdateTimestamp = (chainId: string, providerName: string, sponsorWalletAddress: string) =>
  updateState((draft) => {
    const gasPriceStatePerChain = draft?.gasPrices[chainId] ?? {};

    const sponsorLastUpdateTimestamp =
      gasPriceStatePerChain[providerName]?.sponsorLastUpdateTimestamp[sponsorWalletAddress];

    if (sponsorLastUpdateTimestamp) {
      delete draft.gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestamp[sponsorWalletAddress];
    }
  });

export const getPercentile = (percentile: number, array: bigint[]) => {
  if (array.length === 0) return;

  array.sort((a, b) => (a > b ? 1 : -1));
  const index = Math.max(0, Math.ceil(array.length * (percentile / 100)) - 1);
  return array[index];
};

/**
 * Calculates the multiplier to use for pending transactions.
 * @param recommendedGasPriceMultiplier
 * @param maxScalingMultiplier
 * @param lag
 * @param scalingWindow
 */
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
    if (!goGasPrice.success) logger.error('Failed to fetch gas price from RPC provider.', goGasPrice.error);
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

/**
 *  Calculates the gas price to be used in a transaction based on sanitization and scaling settings.
 * @param chainId
 * @param providerName
 * @param provider
 * @param gasSettings
 * @param sponsorWalletAddress
 */
export const getRecommendedGasPrice = (chainId: string, providerName: string, sponsorWalletAddress: string) => {
  const state = getState();
  const { gasPrices, sponsorLastUpdateTimestamp } = state.gasPrices[chainId]![providerName]!;
  const {
    gasSettings: {
      recommendedGasPriceMultiplier,
      sanitizationPercentile,
      sanitizationSamplingWindow,
      scalingWindow,
      maxScalingMultiplier,
    },
  } = state.config.chains[chainId]!;

  let latestGasPrice: bigint | undefined;
  // Use the latest gas price that is stored in the state. We assume that the gas price is fetched frequently and has
  // been fetched immediately before making this call. In case it fails, we fallback to the previously stored gas price.
  if (gasPrices.length > 0) {
    const lastSavedTimestamp = Math.max(...gasPrices.map((gasPrice) => gasPrice.timestamp));
    latestGasPrice = gasPrices.find((gasPrice) => gasPrice.timestamp === lastSavedTimestamp)!.price;
  }
  if (!latestGasPrice) {
    logger.warn('There is no gas price stored.');
    return null;
  }

  const lastUpdateTimestamp = sponsorLastUpdateTimestamp[sponsorWalletAddress];
  // Check if the next update is a retry of a pending transaction
  if (lastUpdateTimestamp) {
    const pendingPeriod = Math.floor(Date.now() / 1000) - lastUpdateTimestamp;
    const multiplier = calculateScalingMultiplier(
      recommendedGasPriceMultiplier,
      maxScalingMultiplier,
      pendingPeriod,
      scalingWindow
    );

    logger.warn('Scaling gas price.', { gasPrice: latestGasPrice.toString(), multiplier, pendingPeriod });
    return multiplyBigNumber(latestGasPrice, multiplier);
  }

  // Check that there are enough entries in the stored gas prices to determine whether to use sanitization or not
  // Calculate the minimum timestamp that should be within the 90% of the sanitizationSamplingWindow
  const minTimestamp = Math.floor(Date.now() / 1000) - 0.9 * sanitizationSamplingWindow;

  // Check if there are entries with a timestamp older than at least 90% of the sanitizationSamplingWindow
  const hasSufficientSanitizationData = gasPrices.some((gasPrice) => gasPrice.timestamp <= minTimestamp);

  // Get the configured percentile of historical gas prices
  const percentileGasPrice = getPercentile(
    sanitizationPercentile,
    gasPrices.map((gasPrice) => gasPrice.price)
  )!;
  // Log a warning if there is not enough historical data to sanitize the gas price but the price could be sanitized
  if (!hasSufficientSanitizationData && latestGasPrice > percentileGasPrice) {
    logger.warn('Gas price could be sanitized but there is not enough historical data.', {
      gasPrice: latestGasPrice.toString(),
      percentileGasPrice: percentileGasPrice.toString(),
    });
  }

  // If necessary, sanitize the gas price and log a warning because this should not happen under normal circumstances
  if (hasSufficientSanitizationData && latestGasPrice > percentileGasPrice) {
    logger.warn('Sanitizing gas price.', {
      gasPrice: latestGasPrice.toString(),
      percentileGasPrice: percentileGasPrice.toString(),
    });
    return multiplyBigNumber(percentileGasPrice, recommendedGasPriceMultiplier);
  }

  return multiplyBigNumber(latestGasPrice, recommendedGasPriceMultiplier);
};
