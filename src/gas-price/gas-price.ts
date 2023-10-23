import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { loadConfig } from '../config';
import type { GasSettings } from '../config/schema';


interface DataFeedValue {
  value: ethers.BigNumber;
  timestamp: number;
}
interface GasState {
  gasPrices: { price: ethers.BigNumber; timestamp: number }[];
  lastOnChainDataFeedValues: Record<string, DataFeedValue>;
}

export const gasPriceStore: Record<string, Record<string, GasState>> = {};

export const initializeGasStore = (chainId: string, providerName: string) => {
  if (!gasPriceStore[chainId]) {
    gasPriceStore[chainId] = {};
  }

  if (!gasPriceStore[chainId]![providerName]) {
    gasPriceStore[chainId]![providerName] = { gasPrices: [], lastOnChainDataFeedValues: {} };
  }
};

/**
 * Saves a gas price into the store.
 * @param chainId
 * @param providerName
 * @param gasPrice
 */
export const setStoreGasPrices = (chainId: string, providerName: string, gasPrice: ethers.BigNumber) => {
  gasPriceStore[chainId]![providerName]!.gasPrices = [
    { price: gasPrice, timestamp: Date.now() },
    ...gasPriceStore[chainId]![providerName]!.gasPrices,
  ];
};

/**
 * Removes gas prices where the timestamp is older than sanitizationSamplingWindow from the store.
 * @param chainId
 * @param providerName
 * @param sanitizationSamplingWindow
 */
export const clearExpiredStoreGasPrices = (
  chainId: string,
  providerName: string,
  sanitizationSamplingWindow: number
) => {
  // Remove gasPrices older than the sanitizationSamplingWindow
  gasPriceStore[chainId]![providerName]!.gasPrices = gasPriceStore[chainId]![providerName]!.gasPrices.filter(
    (gasPrice) => gasPrice.timestamp >= Date.now() - sanitizationSamplingWindow * 60 * 1000
  );
};

/**
 * Saves last transaction details into the store.
 * @param chainId
 * @param providerName
 * @param nonce
 */
export const setLastOnChainDatafeedValues = (
  chainId: string,
  providerName: string,
  dataFeedId: string,
  dataFeedValues: { value: ethers.BigNumber; timestamp: number }
) => {
  initializeGasStore(chainId, providerName);
  gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues[dataFeedId] = dataFeedValues;
};

/**
 * Removes last transaction details from the store.
 * @param chainId
 * @param providerName
 * @param nonce
 */
export const clearLastOnChainDatafeedValue = (chainId: string, providerName: string, dataFeedId: string) => {
  if (gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues[dataFeedId]) {
    delete gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues[dataFeedId];
  }
};

// TODO: Copied from airnode-utilities, should we import instead?
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
 * @param scalingMultiplier
 * @param lag
 * @param scalingWindow
 * @returns
 */
export const calculateScalingMultiplier = (
  recommendedGasPriceMultiplier: number,
  scalingMultiplier: number,
  lag: number,
  scalingWindow: number
) => recommendedGasPriceMultiplier + (scalingMultiplier - recommendedGasPriceMultiplier) * (lag / scalingWindow);

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
  const goGasPrice = await go(async () => provider.getGasPrice(), { retries: 1, attemptTimeoutMs: 2000 });
  if (!goGasPrice.success) {
    // eslint-disable-next-line no-console
    console.log(`Failed to get provider gas price. Error: ${goGasPrice.error.message}.`);
    throw goGasPrice.error;
  }

  // Save the new provider recommended gas price to the state
  setStoreGasPrices(chainId, providerName, goGasPrice.data);

  return goGasPrice.data;
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
 * @param nonce
 * @returns {ethers.BigNumber}
 */
export const airseekerV2ProviderRecommendedGasPrice = async (
  chainId: string,
  providerName: string,
  rpcUrl: string,
  gasSettings: GasSettings,
  newDataFeedUpdateOnChainValues?: {
    dataFeedId: string;
    newDataFeedValue: DataFeedValue;
  }
): Promise<ethers.BigNumber> => {
  const { recommendedGasPriceMultiplier, sanitizationPercentile, scalingWindow, scalingMultiplier } = gasSettings;
  // Get the configured percentile of historical gas prices before adding the new price
  const percentileGasPrice = getPercentile(
    sanitizationPercentile,
    gasPriceStore[chainId]![providerName]!.gasPrices.map((gasPrice) => gasPrice.price)
  );

  const gasPrice = await updateGasPriceStore(chainId, providerName, rpcUrl);
  if (!gasPriceStore[chainId]![providerName]!.gasPrices) {
    return multiplyGasPrice(gasPrice, recommendedGasPriceMultiplier);
  }

  const lastDataFeedValue =
    newDataFeedUpdateOnChainValues &&
    gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues[newDataFeedUpdateOnChainValues.dataFeedId];
  // Check if the next update is a retry of a pending transaction and if it has been pending longer than scalingWindow
  if (
    lastDataFeedValue &&
    newDataFeedUpdateOnChainValues &&
    lastDataFeedValue?.value === newDataFeedUpdateOnChainValues.newDataFeedValue.value &&
    lastDataFeedValue?.timestamp < Date.now() - scalingWindow * 60 * 1000
  ) {
    const multiplier = calculateScalingMultiplier(
      recommendedGasPriceMultiplier,
      scalingMultiplier,
      (Date.now() - lastDataFeedValue.timestamp) / (60 * 1000),
      scalingWindow
    );

    return multiplyGasPrice(gasPrice, multiplier);
  }

  // Check if the multiplied gas price is within the percentile and return the smaller value
  // TODO should we check for a minimum length of state gas prices used in the calculation?
  const sanitizedGasPrice = percentileGasPrice && gasPrice.gt(percentileGasPrice) ? percentileGasPrice : gasPrice;

  return multiplyGasPrice(sanitizedGasPrice, recommendedGasPriceMultiplier);
};

export const runGasPriceCollector = async () => {
  const config = await loadConfig();

  await Promise.all(
    Object.entries(config.chains).flatMap(([chainId, chain]) =>
      Object.entries(chain.providers).map(async ([providerName, rpcUrl]) =>
        go(async () =>
          gasPriceCollector(chainId, providerName, rpcUrl.url, chain.gasSettings.sanitizationSamplingWindow)
        )
      )
    )
  );
};

if (require.main === module) {
  runGasPriceCollector().catch((error) => {
    // eslint-disable-next-line no-console
    console.trace(error);
    process.exit(1);
  });
}
