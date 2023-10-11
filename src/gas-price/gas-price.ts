import { ethers } from 'ethers';
import { go } from '@api3/promise-utils';
import { GasSettings } from '../config/schema';

interface GasState {
  gasPrices: { price: ethers.BigNumber; timestamp: number }[];
  lastUpdateTimestamp: number;
  lastUpdateNonce: number;
}

export const gasPriceStore: Record<string, GasState> = {};

export const setStoreGasPrices = (chainId: string, sanitizationSamplingWindow: number, gasPrice: ethers.BigNumber) => {
  if (!gasPriceStore[chainId])
    gasPriceStore[chainId] = {
      gasPrices: [],
      lastUpdateTimestamp: 0,
      lastUpdateNonce: 0,
    };

  const newGasPrices = [{ price: gasPrice, timestamp: Date.now() }, ...gasPriceStore[chainId]!.gasPrices];
  // Remove gasPrices older than the sanitizationSamplingWindow
  const filteredNewGasPrices = newGasPrices.filter(
    (gasPrice) => gasPrice.timestamp >= Date.now() - sanitizationSamplingWindow * 60 * 1_000
  );

  gasPriceStore[chainId]!.gasPrices = filteredNewGasPrices;
};

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

export const updateGasPriceStore = async (chainId: string, rpcUrl: string, sanitizationSamplingWindow: number) => {
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
  setStoreGasPrices(chainId, sanitizationSamplingWindow, goGasPrice.data);

  return goGasPrice.data;
};

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

  // Get the configured percentile of historical gas prices before adding the new price
  const percentileGasPrice = getPercentile(
    sanitizationPercentile,
    gasPriceStore[chainId]!.gasPrices.map((gasPrice) => gasPrice.price)
  );

  const gasPrice = await updateGasPriceStore(chainId, rpcUrl, sanitizationSamplingWindow);

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
