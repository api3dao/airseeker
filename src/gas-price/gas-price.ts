import { ethers } from 'ethers';
import { go } from '@api3/promise-utils';
import { GasSettings } from '../config/schema';
import { loadConfig } from '../config';

let gasPriceCollectorInterval: NodeJS.Timeout | undefined;

interface GasState {
  gasPrices: { price: ethers.BigNumber; timestamp: number }[];
  lastUpdateTimestamp: number;
  lastUpdateNonce: number;
}

export const gasPriceStore: Record<string, GasState> = {};

/**
 * Saves a gas price into the store.
 * @param chainId
 * @param gasPrice
 */
export const setStoreGasPrices = (chainId: string, gasPrice: ethers.BigNumber) => {
  gasPriceStore[chainId]!.gasPrices = [
    { price: gasPrice, timestamp: Date.now() },
    ...gasPriceStore[chainId]!.gasPrices,
  ];
};

/**
 * Removes gas prices where the timestamp is older than sanitizationSamplingWindow from the store.
 * @param chainId
 * @param sanitizationSamplingWindow
 */
export const clearExpiredStoreGasPrices = (chainId: string, sanitizationSamplingWindow: number) => {
  // Remove gasPrices older than the sanitizationSamplingWindow
  gasPriceStore[chainId]!.gasPrices = gasPriceStore[chainId]!.gasPrices.filter(
    (gasPrice) => gasPrice.timestamp >= Date.now() - sanitizationSamplingWindow * 60 * 1_000
  );
};

/**
 * Saves last transaction details into the store.
 * @param chainId
 * @param nonce
 */
export const setLastTransactionDetails = (chainId: string, nonce: number) => {
  if (!gasPriceStore[chainId])
    gasPriceStore[chainId] = {
      gasPrices: [],
      lastUpdateTimestamp: 0,
      lastUpdateNonce: 0,
    };

  gasPriceStore[chainId]!.lastUpdateTimestamp = Date.now();
  gasPriceStore[chainId]!.lastUpdateNonce = nonce;
};

// TODO: Copied from airnode-utilities, should we import instead?
export const getPercentile = (percentile: number, array: ethers.BigNumber[]) => {
  if (!array.length) return;

  array.sort((a, b) => (a.gt(b) ? 1 : -1));
  const index = Math.ceil(array.length * (percentile / 100)) - 1;
  return array[index];
};

export const multiplyGasPrice = (gasPrice: ethers.BigNumber, gasPriceMultiplier: number) =>
  gasPrice.mul(ethers.BigNumber.from(Math.round(gasPriceMultiplier * 100))).div(ethers.BigNumber.from(100));

/**
 * Fetches the provider recommended gas price and saves it in the store.
 * @param chainId
 * @param rpcUrl
 * @returns {ethers.BigNumber}
 */
export const updateGasPriceStore = async (chainId: string, rpcUrl: string) => {
  const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
    chainId: parseInt(chainId),
    name: chainId,
  });

  // Get the provider recommended gas price
  const goGasPrice = await go(() => provider.getGasPrice(), { retries: 1, attemptTimeoutMs: 2_000 });
  if (!goGasPrice.success) {
    // eslint-disable-next-line no-console
    console.log(`Failed to get provider gas price. Error: ${goGasPrice.error.message}.`);
    throw goGasPrice.error;
  }

  // Save the new provider recommended gas price to the state
  setStoreGasPrices(chainId, goGasPrice.data);

  return goGasPrice.data;
};

/**
 * Fetches the provider recommended gas price and saves it in the store. Clears out expired gas prices and calculates the gas price to be used in a transaction based on sanitization and scaling settings.
 * @param chainId
 * @param rpcUrl
 * @param gasSettings
 * @param nonce
 * @returns {ethers.BigNumber}
 */
export const airseekerV2ProviderRecommendedGasPrice = async (
  chainId: string,
  rpcUrl: string,
  gasSettings: GasSettings,
  nonce?: number
): Promise<ethers.BigNumber> => {
  const {
    recommendedGasPriceMultiplier,
    sanitizationSamplingWindow,
    sanitizationPercentile,
    scalingWindow,
    scalingMultiplier,
  } = gasSettings;

  // Initialize the gas store for the chain if not already present
  if (!gasPriceStore[chainId])
    gasPriceStore[chainId] = {
      gasPrices: [],
      lastUpdateTimestamp: 0,
      lastUpdateNonce: 0,
    };

  // Clear expired gas prices from the store
  clearExpiredStoreGasPrices(chainId, sanitizationSamplingWindow);

  // Get the configured percentile of historical gas prices before adding the new price
  const percentileGasPrice = getPercentile(
    sanitizationPercentile,
    gasPriceStore[chainId]!.gasPrices.map((gasPrice) => gasPrice.price)
  );

  const gasPrice = await updateGasPriceStore(chainId, rpcUrl);

  // Check if the next update is a retry of a pending transaction and if it has been pending longer than scalingWindow
  if (
    nonce &&
    gasPriceStore[chainId]!.lastUpdateNonce === nonce &&
    gasPriceStore[chainId] &&
    gasPriceStore[chainId]!.lastUpdateTimestamp < Date.now() - scalingWindow * 60 * 1_000
  ) {
    return multiplyGasPrice(gasPrice, scalingMultiplier);
  }

  // Check if the multiplied gas price is within the percentile and return the smaller value
  // TODO should we check for a minimum length of state gas prices used in the calculation?
  const sanitizedGasPrice = percentileGasPrice && gasPrice.gt(percentileGasPrice) ? percentileGasPrice : gasPrice;

  // const multipliedGasPrice = multiplyGasPrice(sanitizedGasPrice, recommendedGasPriceMultiplier);
  return multiplyGasPrice(sanitizedGasPrice, recommendedGasPriceMultiplier);
};

export const runGasPriceCollector = async () => {
  const config = await loadConfig();

  // TODO: new config gasFetchInterval? Global or chain level?
  const fetchInterval = /*config.fetchInterval*/ 30 * 1_000;

  if (!gasPriceCollectorInterval) {
    gasPriceCollectorInterval = setInterval(runGasPriceCollector, fetchInterval);
  }

  await Promise.all(
    Object.entries(config.chains).map(([chainId, chain]) =>
      go(
        async () =>
          await airseekerV2ProviderRecommendedGasPrice(
            chainId,
            // TODO: what to do with many providers?
            Object.values(chain.providers)[0]!.url,
            chain.gasSettings
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
