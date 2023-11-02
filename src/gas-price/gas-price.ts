import { ethers } from 'ethers';
import { get, remove } from 'lodash';

import type { GasSettings } from '../config/schema';
import { getState, updateState } from '../state';

export const initializeGasStore = (chainId: string, providerName: string) =>
  updateState((draft) => {
    if (!draft.gasPriceStore[chainId]) {
      draft.gasPriceStore[chainId] = {};
    }

    if (!draft.gasPriceStore[chainId]![providerName]) {
      draft.gasPriceStore[chainId] = { [providerName]: { gasPrices: [], sponsorLastUpdateTimestampMs: {} } };
    }
  });

/**
 * Saves a gas price into the store.
 * @param chainId
 * @param providerName
 * @param gasPrice
 */
export const setStoreGasPrices = (chainId: string, providerName: string, gasPrice: ethers.BigNumber) =>
  updateState((draft) => {
    draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift({ price: gasPrice, timestampMs: Date.now() });
  });

/**
 * Removes gas prices where the timestamp is older than sanitizationSamplingWindow from the store.
 * @param chainId
 * @param providerName
 * @param sanitizationSamplingWindow
 */
export const clearExpiredStoreGasPrices = (chainId: string, providerName: string, sanitizationSamplingWindow: number) =>
  updateState((draft) => {
    // Remove gasPrices older than the sanitizationSamplingWindow
    remove(
      draft.gasPriceStore[chainId]![providerName]!.gasPrices,
      (gasPrice) => gasPrice.timestampMs < Date.now() - sanitizationSamplingWindow * 60 * 1000
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
  initializeGasStore(chainId, providerName);
  updateState((draft) => {
    draft.gasPriceStore[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress] = Date.now();
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
    const sponsorLastUpdateTimestampMs = get(
      draft,
      `gasPriceStore[${chainId}][${providerName}].sponsorLastUpdateTimestampMs[${sponsorWalletAddress}]`
    );

    if (sponsorLastUpdateTimestampMs) {
      delete draft.gasPriceStore[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress];
    }
  });

export const getPercentile = (percentile: number, array: ethers.BigNumber[]) => {
  if (array.length === 0) return;

  array.sort((a, b) => (a.gt(b) ? 1 : -1));
  const index = Math.ceil(array.length * (percentile / 100)) - 1;
  return array[index];
};

export const multiplyGasPrice = (gasPrice: ethers.BigNumber, gasPriceMultiplier: number) =>
  gasPrice.mul(ethers.BigNumber.from(Math.round(gasPriceMultiplier * 100))).div(ethers.BigNumber.from(100));

/**
 * Calculates the multiplier to use for pending transactions.
 * @param recommendedGasPriceMultiplier
 * @param maxScalingMultiplier
 * @param lag
 * @param scalingWindow
 * @returns
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
 * @param rpcUrl
 * @returns {ethers.BigNumber}
 */
export const updateGasPriceStore = async (chainId: string, providerName: string, rpcUrl: string) => {
  const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
    chainId: Number.parseInt(chainId, 10),
    name: chainId,
  });
  // Get the provider recommended gas price
  const gasPrice = await provider.getGasPrice();
  // Save the new provider recommended gas price to the state
  setStoreGasPrices(chainId, providerName, gasPrice);

  return gasPrice;
};

/**
 * Fetches the provider recommended gas price, saves it in the store and clears out expired gas prices.
 * @param chainId
 * @param providerName
 * @param rpcUrl
 */
export const gasPriceCollector = async (
  chainId: string,
  providerName: string,
  rpcUrl: string,
  sanitizationSamplingWindow: number
) => {
  // Initialize the gas store for the chain if not already present
  initializeGasStore(chainId, providerName);
  clearExpiredStoreGasPrices(chainId, providerName, sanitizationSamplingWindow);
  await updateGasPriceStore(chainId, providerName, rpcUrl);
};

/**
 *  Calculates the gas price to be used in a transaction based on sanitization and scaling settings.
 * @param chainId
 * @param providerName
 * @param rpcUrl
 * @param gasSettings
 * @param sponsorWalletAddress
 * @returns {ethers.BigNumber}
 */
export const getAirseekerRecommendedGasPrice = async (
  chainId: string,
  providerName: string,
  rpcUrl: string,
  gasSettings: GasSettings,
  sponsorWalletAddress: string
): Promise<ethers.BigNumber> => {
  const {
    recommendedGasPriceMultiplier,
    sanitizationPercentile,
    sanitizationSamplingWindow,
    scalingWindow,
    maxScalingMultiplier,
  } = gasSettings;
  const state = getState();
  const { gasPrices, sponsorLastUpdateTimestampMs } = state.gasPriceStore[chainId]![providerName]!;

  // Get the configured percentile of historical gas prices before adding the new price
  const percentileGasPrice = getPercentile(
    sanitizationPercentile,
    gasPrices.map((gasPrice) => gasPrice.price)
  );

  const gasPrice = await updateGasPriceStore(chainId, providerName, rpcUrl);

  const lastUpdateTimestampMs = sponsorLastUpdateTimestampMs[sponsorWalletAddress];

  // Check if the next update is a retry of a pending transaction and if it has been pending longer than scalingWindow
  if (lastUpdateTimestampMs && lastUpdateTimestampMs < Date.now() - scalingWindow * 60 * 1000) {
    const multiplier = calculateScalingMultiplier(
      recommendedGasPriceMultiplier,
      maxScalingMultiplier,
      (Date.now() - lastUpdateTimestampMs) / (60 * 1000),
      scalingWindow
    );

    return multiplyGasPrice(gasPrice, multiplier);
  }

  // Check that there are enough entries in the stored gas prices to determine whether to use sanitization or not
  // Calculate the minimum timestamp that should be within the 90% of the sanitizationSamplingWindow
  const minTimestampMs = Date.now() - 0.9 * sanitizationSamplingWindow * 60 * 1000;

  // Check if there are entries with a timestamp older than at least 90% of the sanitizationSamplingWindow
  const hasSufficientSanitizationData = gasPrices.some((gasPrice) => gasPrice.timestampMs <= minTimestampMs);

  // Check if the multiplied gas price is within the percentile and return the smaller value
  const sanitizedGasPrice =
    hasSufficientSanitizationData && percentileGasPrice && gasPrice.gt(percentileGasPrice)
      ? percentileGasPrice
      : gasPrice;

  return multiplyGasPrice(sanitizedGasPrice, recommendedGasPriceMultiplier);
};
