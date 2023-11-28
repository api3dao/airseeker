import type { BigNumber } from 'ethers';
import { ethers, network } from 'hardhat';

import { getAirseekerRecommendedGasPrice, initializeGasStore, clearExpiredStoreGasPrices } from '../../src/gas-price';
import { getState, updateState } from '../../src/state';
import { multiplyBigNumber } from '../../src/utils';
import { initializeState } from '../fixtures/mock-config';

const chainId = '31337';
const providerName = 'localhost';
const rpcUrl = 'http://127.0.0.1:8545/';
const gasSettings = {
  recommendedGasPriceMultiplier: 1.5,
  sanitizationSamplingWindow: 900,
  sanitizationPercentile: 80,
  scalingWindow: 120,
  maxScalingMultiplier: 2,
};
const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl);
const timestampMock = 1_696_930_907_351;
const sponsorWalletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const sendTransaction = async (gasPriceOverride?: BigNumber) => {
  const wallets = await ethers.getSigners();
  const wallet = wallets[0]!;

  await wallet.sendTransaction({
    to: ethers.constants.AddressZero,
    ...(gasPriceOverride ? { gasPrice: gasPriceOverride } : {}),
  });
};

describe(getAirseekerRecommendedGasPrice.name, () => {
  beforeEach(async () => {
    initializeState();
    initializeGasStore(chainId, providerName);
    // Reset the local hardhat network state for each test to prevent issues with other test contracts
    await network.provider.send('hardhat_reset');
  });

  it('gets, sets and returns provider recommended gas prices', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();
    const providerRecommendedGasprice = await provider.getGasPrice();

    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      provider,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(
      multiplyBigNumber(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
    );
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestampMs: timestampMock },
    ]);
  });

  it('clears expired gas prices from the store', async () => {
    const oldGasPriceMock = {
      price: ethers.utils.parseUnits('5', 'gwei'),
      timestampMs: timestampMock - gasSettings.sanitizationSamplingWindow * 1000 - 1,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    await sendTransaction();

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
    });
    const providerRecommendedGasprice = await provider.getGasPrice();

    clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      provider,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(
      multiplyBigNumber(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
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
    });

    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      provider,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(
      multiplyBigNumber(providerRecommendedGasprice, gasSettings.recommendedGasPriceMultiplier)
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
      timestampMs: timestampMock - 0.9 * gasSettings.sanitizationSamplingWindow * 1000 - 1,
    };

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
    });

    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      provider,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(multiplyBigNumber(oldGasPriceValueMock, gasSettings.recommendedGasPriceMultiplier));
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
        timestampMock - gasSettings.scalingWindow * 1000 - 1;
    });
    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      provider,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(multiplyBigNumber(providerRecommendedGasprice, gasSettings.maxScalingMultiplier));
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: providerRecommendedGasprice, timestampMs: timestampMock },
    ]);
  });
});
