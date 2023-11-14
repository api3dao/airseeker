import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { getState, updateState } from '../state';
import { multiplyBigNumber } from '../utils';

import {
  getAirseekerRecommendedGasPrice,
  setSponsorLastUpdateTimestampMs,
  setStoreGasPrices,
  updateGasPriceStore,
  clearSponsorLastUpdateTimestampMs,
  clearExpiredStoreGasPrices,
  initializeGasStore,
  calculateScalingMultiplier,
} from './gas-price';

const chainId = '31337';
const providerName = 'localhost';
const rpcUrl = 'http://127.0.0.1:8545/';
const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
  chainId: Number.parseInt(chainId, 10),
  name: chainId,
});
const gasSettings = {
  recommendedGasPriceMultiplier: 1.5,
  sanitizationSamplingWindow: 15,
  sanitizationPercentile: 80,
  scalingWindow: 2,
  maxScalingMultiplier: 2,
};
const timestampMock = 1_696_930_907_351;
const gasPriceMock = ethers.utils.parseUnits('10', 'gwei');
const sponsorWalletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

beforeEach(() => {
  initializeState();
  initializeGasStore(chainId, providerName);
});

describe(calculateScalingMultiplier.name, () => {
  it('calculates scaling multiplier', () => {
    const multiplier = calculateScalingMultiplier(1.5, 2, 1, 5);

    expect(multiplier).toBe(1.6);
  });

  it('calculates maximum scaling multiplier', () => {
    const multiplier = calculateScalingMultiplier(1.5, 2, 5, 5);

    expect(multiplier).toBe(2);
  });
});

describe(clearExpiredStoreGasPrices.name, () => {
  it('clears expired gas prices from the store', () => {
    const oldGasPriceMock = {
      price: ethers.utils.parseUnits('5', 'gwei'),
      timestampMs: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
    });
    clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
    setStoreGasPrices(chainId, providerName, gasPriceMock);

    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: gasPriceMock, timestampMs: timestampMock },
    ]);
  });
});

describe(setStoreGasPrices.name, () => {
  it('updates store with price data', () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

    setStoreGasPrices(chainId, providerName, gasPriceMock);

    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: gasPriceMock, timestampMs: timestampMock },
    ]);
  });
});

describe(updateGasPriceStore.name, () => {
  it('returns and updates store with price data', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

    const gasPrice = await updateGasPriceStore(chainId, providerName, provider);

    expect(gasPrice).toStrictEqual(gasPriceMock);
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: gasPriceMock, timestampMs: timestampMock },
    ]);
  });

  it('clears expired gas prices from the store', async () => {
    const oldGasPriceMock = {
      price: ethers.utils.parseUnits('5', 'gwei'),
      timestampMs: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
    });
    clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
    const gasPrice = await updateGasPriceStore(chainId, providerName, provider);

    expect(gasPrice).toStrictEqual(gasPriceMock);
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: gasPriceMock, timestampMs: timestampMock },
    ]);
  });
});

describe(setSponsorLastUpdateTimestampMs.name, () => {
  it('sets last datafeed values details', () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    setSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWalletAddress);

    expect(
      getState().gasPriceStore[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress]
    ).toStrictEqual(timestampMock);
  });
});

describe(clearSponsorLastUpdateTimestampMs.name, () => {
  it('clears last datafeed value details', () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    setSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWalletAddress);
    clearSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWalletAddress);

    expect(
      getState().gasPriceStore[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress]
    ).toBeUndefined();
  });
});

describe(getAirseekerRecommendedGasPrice.name, () => {
  it('gets, sets and returns provider recommended gas prices', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      provider,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(multiplyBigNumber(gasPriceMock, gasSettings.recommendedGasPriceMultiplier));
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: gasPriceMock, timestampMs: timestampMock },
    ]);
  });

  it('gets and uses the percentile price from the store', async () => {
    const gasPricesMock = Array.from(Array.from({ length: 10 }), (_, i) => ({
      price: ethers.utils.parseUnits(`${i + 1}`, 'gwei'),
      timestampMs: timestampMock - 0.9 * gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
    }));
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices = gasPricesMock;
    });
    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      provider,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(
      multiplyBigNumber(ethers.utils.parseUnits('8', 'gwei'), gasSettings.recommendedGasPriceMultiplier)
    );
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: gasPriceMock, timestampMs: timestampMock },
      ...gasPricesMock,
    ]);
  });

  it('returns new price if it is within the percentile', async () => {
    const oldGasPriceValueMock = ethers.utils.parseUnits('11', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestampMs: timestampMock,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

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

    expect(gasPrice).toStrictEqual(multiplyBigNumber(gasPriceMock, gasSettings.recommendedGasPriceMultiplier));
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: gasPriceMock, timestampMs: timestampMock },
      oldGasPriceMock,
    ]);
  });

  it('returns sanitized price if new price is above the percentile', async () => {
    const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestampMs: timestampMock - 0.9 * gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

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
      { price: gasPriceMock, timestampMs: timestampMock },
      oldGasPriceMock,
    ]);
  });

  it('applies scaling if last update timestamp is past the scaling window', async () => {
    const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestampMs: timestampMock,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
    jest
      .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
      .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

    updateState((draft) => {
      draft.gasPriceStore[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
      draft.gasPriceStore[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress] =
        timestampMock - gasSettings.scalingWindow * 60 * 1000 - 1;
    });
    const gasPrice = await getAirseekerRecommendedGasPrice(
      chainId,
      providerName,
      provider,
      gasSettings,
      sponsorWalletAddress
    );

    expect(gasPrice).toStrictEqual(multiplyBigNumber(gasPriceMock, gasSettings.maxScalingMultiplier));
    expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: gasPriceMock, timestampMs: timestampMock },
      oldGasPriceMock,
    ]);
  });
});
