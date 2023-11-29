import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { logger } from '../logger';
import { getState, updateState } from '../state';

import {
  getRecommendedGasPrice,
  setSponsorLastUpdateTimestampMs,
  saveGasPrice,
  clearSponsorLastUpdateTimestampMs,
  purgeOldGasPrices,
  initializeGasStore,
  calculateScalingMultiplier,
  getPercentile,
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
  sanitizationSamplingWindow: 900,
  sanitizationPercentile: 80,
  scalingWindow: 120,
  maxScalingMultiplier: 2,
};
const timestampMsMock = 1_696_930_907_351;
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

describe(purgeOldGasPrices.name, () => {
  it('clears expired gas prices from the store', () => {
    const oldGasPriceMock = {
      price: ethers.utils.parseUnits('5', 'gwei'),
      timestampMs: timestampMsMock - gasSettings.sanitizationSamplingWindow * 1000 - 1,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
    });

    purgeOldGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);

    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([]);
  });
});

describe(saveGasPrice.name, () => {
  it('updates store with price data', () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);

    saveGasPrice(chainId, providerName, ethers.utils.parseUnits('10', 'gwei'));

    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.utils.parseUnits('10', 'gwei'), timestampMs: timestampMsMock },
    ]);
  });
});

describe(setSponsorLastUpdateTimestampMs.name, () => {
  it('sets the last update timestamp for the sponsor', () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);

    setSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWalletAddress);

    expect(
      getState().gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress]
    ).toStrictEqual(timestampMsMock);
  });
});

describe(clearSponsorLastUpdateTimestampMs.name, () => {
  it('clears the last update timestamp for the sponsor', () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);
    setSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWalletAddress);

    clearSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWalletAddress);

    expect(
      getState().gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress]
    ).toBeUndefined();
  });
});

describe(getPercentile.name, () => {
  it('returns correct percentile', () => {
    const percentile = getPercentile(80, [
      ethers.BigNumber.from('1'),
      ethers.BigNumber.from('2'),
      ethers.BigNumber.from('3'),
      ethers.BigNumber.from('4'),
      ethers.BigNumber.from('5'),
      ethers.BigNumber.from('6'),
      ethers.BigNumber.from('7'),
      ethers.BigNumber.from('8'),
      ethers.BigNumber.from('9'),
      ethers.BigNumber.from('10'),
    ]);

    expect(percentile).toStrictEqual(ethers.BigNumber.from('8'));
  });

  it('returns correct percentile for empty array', () => {
    const percentile = getPercentile(80, []);

    expect(percentile).toBeUndefined();
  });

  it('edge cases', () => {
    expect(
      getPercentile(100, [ethers.BigNumber.from('10'), ethers.BigNumber.from('20'), ethers.BigNumber.from('30')])
    ).toStrictEqual(ethers.BigNumber.from('30'));

    expect(getPercentile(0, [ethers.BigNumber.from('10'), ethers.BigNumber.from('20')])).toStrictEqual(
      ethers.BigNumber.from('10')
    );

    expect(getPercentile(50, [ethers.BigNumber.from('10')])).toStrictEqual(ethers.BigNumber.from('10'));
  });
});

describe(getRecommendedGasPrice.name, () => {
  it('uses provider recommended gas price when there are no historical prices', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.utils.parseUnits('10', 'gwei'));
    jest.spyOn(logger, 'debug');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, gasSettings, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.utils.parseUnits('15', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.utils.parseUnits('10', 'gwei'), timestampMs: timestampMsMock },
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(3);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices');
    expect(logger.debug).toHaveBeenNthCalledWith(
      3,
      'No historical gas prices to compute the percentile. Using the provider recommended gas price'
    );
  });

  it('uses the sanitized percentile price from the store if the new price is above the percentile', async () => {
    const gasPricesMock = Array.from(Array.from({ length: 10 }), (_, i) => ({
      price: ethers.utils.parseUnits(`${i + 1}`, 'gwei'),
      timestampMs: timestampMsMock - 0.9 * gasSettings.sanitizationSamplingWindow * 1000 - 1,
    }));
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.utils.parseUnits('10', 'gwei'));
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices = gasPricesMock;
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, gasSettings, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.utils.parseUnits('12', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.utils.parseUnits('10', 'gwei'), timestampMs: timestampMsMock },
      ...gasPricesMock,
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Sanitizing gas price', {
      gasPrice: '10000000000',
      percentileGasPrice: '8000000000',
    });
  });

  it('uses provider recommended gas if it is within the percentile', async () => {
    const oldGasPriceValueMock = ethers.utils.parseUnits('11', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestampMs: timestampMsMock,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.utils.parseUnits('10', 'gwei'));
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
    });
    jest.spyOn(logger, 'debug');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, gasSettings, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.utils.parseUnits('15', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.utils.parseUnits('10', 'gwei'), timestampMs: timestampMsMock },
      oldGasPriceMock,
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices');
  });

  it('applies scaling if last update timestamp is past the scaling window', async () => {
    const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestampMs: timestampMsMock,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.utils.parseUnits('10', 'gwei'));
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
      draft.gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress] =
        timestampMsMock - gasSettings.scalingWindow * 1000 - 1;
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, gasSettings, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.utils.parseUnits('20', 'gwei')); // The price is multiplied by the scaling multiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.utils.parseUnits('10', 'gwei'), timestampMs: timestampMsMock },
      oldGasPriceMock,
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Scaling gas price', { gasPrice: '10000000000', multiplier: 2 });
  });

  it('does not apply scaling if the lag is not sufficient', async () => {
    const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestampMs: timestampMsMock,
    };
    jest.spyOn(Date, 'now').mockReturnValue(timestampMsMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.utils.parseUnits('10', 'gwei'));
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
      draft.gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestampMs[sponsorWalletAddress] =
        timestampMsMock - gasSettings.scalingWindow * 1000 + 1000;
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, gasSettings, sponsorWalletAddress);
    expect(gasPrice).toStrictEqual(ethers.utils.parseUnits('15', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.utils.parseUnits('10', 'gwei'), timestampMs: timestampMsMock },
      oldGasPriceMock,
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      'Gas price could be sanitized but there is not enough historical data',
      { gasPrice: '10000000000', percentileGasPrice: '5000000000' }
    );
  });

  it('throws and error when getting gas price from RPC provider fails', async () => {
    jest.spyOn(provider, 'getGasPrice').mockRejectedValueOnce(new Error('Provider error'));
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    await expect(async () =>
      getRecommendedGasPrice(chainId, providerName, provider, gasSettings, sponsorWalletAddress)
    ).rejects.toThrow('Provider error');

    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state');
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });
});
