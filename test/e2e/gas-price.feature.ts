import { ethers } from 'ethers';
import * as hre from 'hardhat';

import '@nomiclabs/hardhat-ethers';
import {
  getAirseekerRecommendedGasPrice,
  multiplyGasPrice,
  initializeGasStore,
  clearExpiredStoreGasPrices,
} from '../../src/gas-price/gas-price';
import { getState, updateState } from '../../src/state';
import { init } from '../fixtures/mock-config';

const chainId = '31337';
const providerName = 'localhost';
const rpcUrl = 'http://127.0.0.1:8545/';
const gasSettings = {
  recommendedGasPriceMultiplier: 1.5,
  sanitizationSamplingWindow: 15,
  sanitizationPercentile: 80,
  scalingWindow: 2,
  maxScalingMultiplier: 2,
};
const provider = new hre.ethers.providers.StaticJsonRpcProvider(rpcUrl);
const timestampMock = 1_696_930_907_351;
const sponsorWalletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const sendTransaction = async (gasPriceOverride?: ethers.BigNumber) => {
  const wallets = await hre.ethers.getSigners();
  const wallet = wallets[0]!;

  await wallet.sendTransaction({
    to: hre.ethers.constants.AddressZero,
    ...(gasPriceOverride ? { gasPrice: gasPriceOverride } : {}),
  });
};

describe(getAirseekerRecommendedGasPrice.name, () => {
  beforeAll(() => {
    init();
  });

  beforeEach(async () => {
    // Reset the local hardhat network getState() for each test to prevent issues with other test contracts
    await hre.network.provider.send('hardhat_reset');
    initializeGasStore(chainId, providerName);
    // Reset the gasPriceStore
    updateState((draft) => {
      draft.gasPriceStore[chainId] = { [providerName]: { gasPrices: [], sponsorLastUpdateTimestampMs: {} } };
      return draft;
    });
  });

  it('gets, sets and returns provider recommended gas prices', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();
    const providerRecommendedGasprice = await provider.getGasPrice();

    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      rpcUrl,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestampMs: timestampMock },
    ]);
  });

  it('clears expired gas prices from the store', async () => {
    const oldGasPriceMock = {
      price: ethers.utils.parseUnits('5', 'gwei'),
      timestampMs: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
      return draft;
    });
    const providerRecommendedGasprice = await provider.getGasPrice();

    clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      rpcUrl,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestampMs: timestampMock },
    ]);
  });

  it('returns new price if it is within the percentile', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();

    const providerRecommendedGasprice = await provider.getGasPrice();
    const oldGasPriceMock = {
      price: providerRecommendedGasprice.add(ethers.utils.parseUnits('1', 'gwei')),
      timestampMs: timestampMock,
    };

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
      return draft;
    });

    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      rpcUrl,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(
      multiplyGasPrice(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestampMs: timestampMock },
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
      timestampMs: timestampMock - 0.9 * gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
    };

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
      return draft;
    });

    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      rpcUrl,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(multiplyGasPrice(oldGasPriceValueMock, gasSettings.recommendedGasPriceMultiplier));
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestampMs: timestampMock },
      oldGasPriceMock,
    ]);
  });

  it('applies scaling if last update timestamp is past the scaling window', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();
    const providerRecommendedGasprice = await provider.getGasPrice();

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress] =
        timestampMock - gasSettings.scalingWindow * 60 * 1000 - 1;
      return draft;
    });
    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      rpcUrl,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(multiplyGasPrice(providerRecommendedGasprice, gasSettings.maxScalingMultiplier));
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestampMs: timestampMock },
    ]);
  });
});
