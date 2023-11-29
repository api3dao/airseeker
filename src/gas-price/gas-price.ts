import type { ethers } from 'ethers';
import { remove } from 'lodash';

import type { GasSettings } from '../config/schema';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import { multiplyBigNumber } from '../utils';

export const initializeGasStore = (chainId: string, providerName: string) =>
  updateState((draft) => {
    if (!draft.gasPrices[chainId]) {
      draft.gasPrices[chainId] = {};
    }

    draft.gasPrices[chainId]![providerName] = { gasPrices: [], sponsorLastUpdateTimestampMs: {} };
  });

/**
 * Saves a gas price into the store.
 * @param chainId
 * @param providerName
 * @param gasPrice
 */
export const saveGasPrice = (chainId: string, providerName: string, gasPrice: ethers.BigNumber) =>
  updateState((draft) => {
    draft.gasPrices[chainId]![providerName]!.gasPrices.unshift({ price: gasPrice, timestampMs: Date.now() });
  });

/**
 * Removes gas prices where the timestamp is older than sanitizationSamplingWindow from the store.
 * @param chainId
 * @param providerName
 * @param sanitizationSamplingWindow
 */
// TODO: This is unused
export const purgeOldGasPrices = (chainId: string, providerName: string, sanitizationSamplingWindow: number) =>
  updateState((draft) => {
    // Remove gasPrices older than the sanitizationSamplingWindow.
    remove(
      draft.gasPrices[chainId]![providerName]!.gasPrices,
      (gasPrice) => gasPrice.timestampMs < Date.now() - sanitizationSamplingWindow * 1000
    );
  });

/**
 * Saves a sponsor wallet's last update timestamp into the store.
 * @param chainId
 * @param providerName
 * @param sponsorWalletAddress
 */
export const setSponsorLastUpdateTimestampMs = (
  chainId: string,
  providerName: string,
  sponsorWalletAddress: string
) => {
  updateState((draft) => {
    draft.gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress] = Date.now();
  });
};

/**
 * Removes a sponsor wallet's last update timestamp from the store.
 * @param chainId
 * @param providerName
 * @param sponsorWalletAddress
 */
export const clearSponsorLastUpdateTimestampMs = (
  chainId: string,
  providerName: string,
  sponsorWalletAddress: string
) =>
  updateState((draft) => {
    const gasPriceStorePerChain = draft?.gasPrices[chainId] ?? {};

    const sponsorLastUpdateTimestampMs =
      gasPriceStorePerChain[providerName]?.sponsorLastUpdateTimestampMs[sponsorWalletAddress];

    if (sponsorLastUpdateTimestampMs) {
      delete draft.gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress];
    }
  });

export const getPercentile = (percentile: number, array: ethers.BigNumber[]) => {
  if (array.length === 0) return;

  array.sort((a, b) => (a.gt(b) ? 1 : -1));
  const index = Math.ceil(array.length * (percentile / 100)) - 1;
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
 * Fetches the provider recommended gas price and saves it in the store.
 * @param chainId
 * @param providerName
 * @param provider
 */
// TODO: Inline
export const updateGasPriceStore = async (
  chainId: string,
  providerName: string,
  provider: ethers.providers.StaticJsonRpcProvider
) => {
  // Get the provider recommended gas price
  const gasPrice = await provider.getGasPrice();
  // Save the new provider recommended gas price to the state
  saveGasPrice(chainId, providerName, gasPrice);

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
export const getRecommendedGasPrice = async (
  chainId: string,
  providerName: string,
  provider: ethers.providers.StaticJsonRpcProvider,
  gasSettings: GasSettings,
  sponsorWalletAddress: string
) => {
  const {
    recommendedGasPriceMultiplier,
    sanitizationPercentile,
    sanitizationSamplingWindow,
    scalingWindow,
    maxScalingMultiplier,
  } = gasSettings;
  const state = getState();
  const { gasPrices, sponsorLastUpdateTimestampMs } = state.gasPrices[chainId]![providerName]!;

  // Get the configured percentile of historical gas prices before adding the new price
  const percentileGasPrice = getPercentile(
    sanitizationPercentile,
    gasPrices.map((gasPrice) => gasPrice.price)
  );

  logger.debug('Updating gas price store.');
  const gasPrice = await updateGasPriceStore(chainId, providerName, provider);

  const lastUpdateTimestampMs = sponsorLastUpdateTimestampMs[sponsorWalletAddress];

  // Check if the next update is a retry of a pending transaction and if it has been pending longer than scalingWindow
  if (lastUpdateTimestampMs && lastUpdateTimestampMs < Date.now() - scalingWindow * 1000) {
    const multiplier = calculateScalingMultiplier(
      recommendedGasPriceMultiplier,
      maxScalingMultiplier,
      (Date.now() - lastUpdateTimestampMs) / 1000,
      scalingWindow
    );

    logger.warn('Scaling gas price', { gasPrice: gasPrice.toString(), multiplier });
    return multiplyBigNumber(gasPrice, multiplier);
  }

  // Check that there are enough entries in the stored gas prices to determine whether to use sanitization or not
  // Calculate the minimum timestamp that should be within the 90% of the sanitizationSamplingWindow
  const minTimestampMs = Date.now() - 0.9 * sanitizationSamplingWindow * 1000;

  // Check if there are entries with a timestamp older than at least 90% of the sanitizationSamplingWindow
  const hasSufficientSanitizationData = gasPrices.some((gasPrice) => gasPrice.timestampMs <= minTimestampMs);

  // Log a warning if there is not enough historical data to sanitize the gas price but the price could be sanitized
  if (!hasSufficientSanitizationData && percentileGasPrice && gasPrice.gt(percentileGasPrice)) {
    logger.warn('Gas price could be sanitized but there is not enough historical data');
  }

  // If necessary, sanitize the gas price and log a warning because this should not happen under normal circumstances
  if (hasSufficientSanitizationData && percentileGasPrice && gasPrice.gt(percentileGasPrice)) {
    logger.warn('Sanitizing gas price', {
      gasPrice: gasPrice.toString(),
      percentileGasPrice: percentileGasPrice.toString(),
    });
    return multiplyBigNumber(percentileGasPrice, recommendedGasPriceMultiplier);
  }

  return multiplyBigNumber(gasPrice, recommendedGasPriceMultiplier);
};
