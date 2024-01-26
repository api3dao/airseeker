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
export const saveGasPrice = (chainId: string, providerName: string, gasPrice: ethers.BigNumber) =>
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

export const getPercentile = (percentile: number, array: ethers.BigNumber[]) => {
  if (array.length === 0) return;

  array.sort((a, b) => (a.gt(b) ? 1 : -1));
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

/**
 *  Calculates the gas price to be used in a transaction based on sanitization and scaling settings.
 * @param chainId
 * @param providerName
 * @param provider
 * @param gasSettings
 * @param sponsorWalletAddress
 */
export const getRecommendedGasPrice = async (
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider,
  sponsorWalletAddress: string
) => {
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
    dataFeedUpdateInterval,
  } = state.config.chains[chainId]!;

  // Get the provider recommended gas price and save it to the state
  logger.debug('Fetching gas price and saving it to the state.');
  const goGasPrice = await go(async () => {
    const feeData = await provider.getFeeData();
    return feeData.gasPrice;
  });
  let gasPrice = goGasPrice.data;
  if (!goGasPrice.success) logger.error('Failed to fetch gas price from RPC provider.', goGasPrice.error);
  if (gasPrice) saveGasPrice(chainId, providerName, gasPrice);

  // If the gas price from RPC provider is not available, use the last saved gas price (provided it's fresh enough)
  if (!gasPrice && gasPrices.length > 0) {
    const lastSavedTimestamp = Math.max(...gasPrices.map((gasPrice) => gasPrice.timestamp));
    const lastSavedGasPrice = gasPrices.find((gasPrice) => gasPrice.timestamp === lastSavedTimestamp)!.price;

    if (lastSavedTimestamp >= Math.floor(Date.now() / 1000) - 10 * dataFeedUpdateInterval) {
      gasPrice = lastSavedGasPrice;
    }
  }
  if (!gasPrice) {
    logger.warn('There is no gas price to use. Skipping update.');
    return null;
  }

  logger.debug('Purging old gas prices.');
  purgeOldGasPrices(chainId, providerName, sanitizationSamplingWindow);

  const lastUpdateTimestamp = sponsorLastUpdateTimestamp[sponsorWalletAddress];

  // Check if the next update is a retry of a pending transaction and if it has been pending longer than scalingWindow
  if (lastUpdateTimestamp && lastUpdateTimestamp < Math.floor(Date.now() / 1000) - scalingWindow) {
    const multiplier = calculateScalingMultiplier(
      recommendedGasPriceMultiplier,
      maxScalingMultiplier,
      Math.floor(Date.now() / 1000) - lastUpdateTimestamp,
      scalingWindow
    );

    logger.warn('Scaling gas price.', { gasPrice: gasPrice.toString(), multiplier });
    return multiplyBigNumber(gasPrice, multiplier);
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
  );
  if (!percentileGasPrice) {
    logger.debug('No historical gas prices to compute the percentile. Using the provider recommended gas price.');
    return multiplyBigNumber(gasPrice, recommendedGasPriceMultiplier);
  }

  // Log a warning if there is not enough historical data to sanitize the gas price but the price could be sanitized
  if (!hasSufficientSanitizationData && gasPrice.gt(percentileGasPrice)) {
    logger.warn('Gas price could be sanitized but there is not enough historical data.', {
      gasPrice: gasPrice.toString(),
      percentileGasPrice: percentileGasPrice.toString(),
    });
  }

  // If necessary, sanitize the gas price and log a warning because this should not happen under normal circumstances
  if (hasSufficientSanitizationData && gasPrice.gt(percentileGasPrice)) {
    logger.warn('Sanitizing gas price.', {
      gasPrice: gasPrice.toString(),
      percentileGasPrice: percentileGasPrice.toString(),
    });
    return multiplyBigNumber(percentileGasPrice, recommendedGasPriceMultiplier);
  }

  return multiplyBigNumber(gasPrice, recommendedGasPriceMultiplier);
};
