import { ethers } from 'ethers';
import * as hre from 'hardhat';

import '@nomiclabs/hardhat-ethers';
import {
  airseekerV2ProviderRecommendedGasPrice,
  multiplyGasPrice,
  gasPriceStore,
  initializeGasStore,
  clearExpiredStoreGasPrices,
} from '../../src/gas-price/gas-price';

const chainId = '31337';
const providerName = 'localhost';
const rpcUrl = 'http://127.0.0.1:8545/';
const gasSettings = {
  recommendedGasPriceMultiplier: 1.5,
  sanitizationSamplingWindow: 15,
  sanitizationPercentile: 80,
  scalingWindow: 2,
  scalingMultiplier: 2,
};
const provider = new hre.ethers.providers.StaticJsonRpcProvider(rpcUrl);
const timestampMock = 1_696_930_907_351;

const sendTransaction = async (gasPriceOverride?: ethers.BigNumber) => {
  const wallets = await hre.ethers.getSigners();
  const wallet = wallets[0]!;

  await wallet.sendTransaction({
    to: hre.ethers.constants.AddressZero,
    ...(gasPriceOverride ? { gasPrice: gasPriceOverride } : {}),
  });
};

describe('airseekerV2ProviderRecommendedGasPrice', () => {
  beforeEach(async () => {
    // Reset the local hardhat network state for each test to prevent issues with other test contracts
    await hre.network.provider.send('hardhat_reset');
    initializeGasStore(chainId, providerName);
    // Reset the gasPriceStore
    gasPriceStore[chainId]![providerName] = { gasPrices: [], lastOnChainDataFeedValues: {} };
  });

  it('gets, sets and returns provider recommended gas prices', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();
    const providerRecommendedGasprice = await provider.getGasPrice();

    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestamp: timestampMock },
    ]);
  });

  it('clears expired gas prices from the store', async () => {
    const oldGasPriceMock = {
      price: ethers.utils.parseUnits('5', 'gwei'),
      timestamp: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();

    gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];
    const providerRecommendedGasprice = await provider.getGasPrice();

    clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestamp: timestampMock },
    ]);
  });

  it('returns new price if it is within the percentile', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();

    const providerRecommendedGasprice = await provider.getGasPrice();
    const oldGasPriceMock = {
      price: providerRecommendedGasprice.add(ethers.utils.parseUnits('1', 'gwei')),
      timestamp: timestampMock,
    };
    gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];

    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestamp: timestampMock },
      oldGasPriceMock,
    ]);
  });

  it('returns sanitized price if new price is above the percentile', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();

    const providerRecommendedGasprice = await provider.getGasPrice();
    const oldGasPriceValueMock = providerRecommendedGasprice.sub(ethers.utils.parseUnits('1', 'gwei'));
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestamp: timestampMock,
    };
    gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];

    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

    expect(gasPrice).toStrictEqual(multiplyGasPrice(oldGasPriceValueMock, gasSettings.recommendedGasPriceMultiplier));
    expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestamp: timestampMock },
      oldGasPriceMock,
    ]);
  });

  it('applies scaling if past the scaling window and same nonce', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();
    const providerRecommendedGasprice = await provider.getGasPrice();

    const dataFeedId = '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04';
    const dataFeedValue = {
      value: ethers.BigNumber.from(1),
      // This sets the timestamp to be 1ms past the scalingWindow
      timestamp: timestampMock - gasSettings.scalingWindow * 60 * 1000 - 1,
    };
    gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues[dataFeedId] = dataFeedValue;
    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings, {
      dataFeedId,
      newDataFeedValue: dataFeedValue,
    });

    expect(gasPrice).toStrictEqual(multiplyGasPrice(providerRecommendedGasprice, gasSettings.scalingMultiplier));
    expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestamp: timestampMock },
    ]);
  });
});
