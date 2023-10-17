import { ethers } from 'ethers';
import * as hre from 'hardhat';

import '@nomiclabs/hardhat-ethers';
import { airseekerV2ProviderRecommendedGasPrice, multiplyGasPrice, gasPriceStore } from '../../src/gas-price/gas-price';

const chainId = '31337';
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
    // Reset the gasPriceStore
    gasPriceStore[chainId] = { gasPrices: [], lastUpdateTimestamp: 0, lastUpdateNonce: 0 };
  });

  it('gets, sets and returns provider recommended gas prices', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();
    const providerRecommendedGasprice = await provider.getGasPrice();

    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
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

    gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];
    const providerRecommendedGasprice = await provider.getGasPrice();

    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
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
    gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];

    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
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
    gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];

    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

    expect(gasPrice).toStrictEqual(multiplyGasPrice(oldGasPriceValueMock, gasSettings.recommendedGasPriceMultiplier));
    expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestamp: timestampMock },
      oldGasPriceMock,
    ]);
  });

  it('applies scaling if past the scaling window and same nonce', async () => {
    const nonce = 1;
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();
    const providerRecommendedGasprice = await provider.getGasPrice();

    gasPriceStore[chainId]!.lastUpdateNonce = nonce;
    gasPriceStore[chainId]!.lastUpdateTimestamp = timestampMock - gasSettings.scalingWindow * 60 * 1000 - 1;
    const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings, nonce);

    expect(gasPrice).toStrictEqual(multiplyGasPrice(providerRecommendedGasprice, gasSettings.scalingMultiplier));
    expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestamp: timestampMock },
    ]);
  });
});
