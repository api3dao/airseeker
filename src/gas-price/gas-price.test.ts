import { ethers } from 'ethers';

import { generateTestConfig, initializeState } from '../../test/fixtures/mock-config';
import { logger } from '../logger';
import { getState, updateState } from '../state';

import {
  getRecommendedGasPrice,
  setSponsorLastUpdateTimestamp,
  saveGasPrice,
  clearSponsorLastUpdateTimestamp,
  purgeOldGasPrices,
  initializeGasState,
  calculateScalingMultiplier,
  getPercentile,
} from './gas-price';

const chainId = '31337';
const providerName = 'localhost';
const rpcUrl = 'http://127.0.0.1:8545/';
const provider = new ethers.JsonRpcProvider(
  rpcUrl,
  {
    chainId: Number.parseInt(chainId, 10),
    name: chainId,
  },
  { staticNetwork: true }
);
const dateNowMock = 1_696_930_907_351;
const timestampMock = Math.floor(dateNowMock / 1000);
const sponsorWalletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const testConfig = generateTestConfig();
testConfig.chains[chainId]!.gasSettings.scalingWindow = 120;
const { gasSettings } = testConfig.chains[chainId]!;

beforeEach(() => {
  initializeState(testConfig);
  initializeGasState(chainId, providerName);
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
  it('clears expired gas prices from the state', () => {
    const oldGasPriceMock = {
      price: ethers.parseUnits('5', 'gwei'),
      timestamp: timestampMock - gasSettings.sanitizationSamplingWindow - 1,
    };
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
    });

    purgeOldGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);

    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([]);
  });
});

describe(saveGasPrice.name, () => {
  it('updates state with price data', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);

    saveGasPrice(chainId, providerName, ethers.parseUnits('10', 'gwei'));

    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.parseUnits('10', 'gwei'), timestamp: timestampMock },
    ]);
  });
});

describe(setSponsorLastUpdateTimestamp.name, () => {
  it('sets the last update timestamp for the sponsor', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);

    setSponsorLastUpdateTimestamp(chainId, providerName, sponsorWalletAddress);

    expect(
      getState().gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestamp[sponsorWalletAddress]
    ).toStrictEqual(timestampMock);
  });
});

describe(clearSponsorLastUpdateTimestamp.name, () => {
  it('clears the last update timestamp for the sponsor', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    setSponsorLastUpdateTimestamp(chainId, providerName, sponsorWalletAddress);

    clearSponsorLastUpdateTimestamp(chainId, providerName, sponsorWalletAddress);

    expect(
      getState().gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestamp[sponsorWalletAddress]
    ).toBeUndefined();
  });
});

describe(getPercentile.name, () => {
  it('returns correct percentile', () => {
    const percentile = getPercentile(80, [
      BigInt('1'),
      BigInt('2'),
      BigInt('3'),
      BigInt('4'),
      BigInt('5'),
      BigInt('6'),
      BigInt('7'),
      BigInt('8'),
      BigInt('9'),
      BigInt('10'),
    ]);

    expect(percentile).toStrictEqual(BigInt('8'));
  });

  it('returns correct percentile for empty array', () => {
    const percentile = getPercentile(80, []);

    expect(percentile).toBeUndefined();
  });

  it('edge cases', () => {
    expect(getPercentile(100, [BigInt('10'), BigInt('20'), BigInt('30')])).toStrictEqual(BigInt('30'));

    expect(getPercentile(0, [BigInt('10'), BigInt('20')])).toStrictEqual(BigInt('10'));

    expect(getPercentile(50, [BigInt('10')])).toStrictEqual(BigInt('10'));
  });
});

describe(getRecommendedGasPrice.name, () => {
  it('uses provider recommended gas price when there are no historical prices', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.parseUnits('10', 'gwei'));
    jest.spyOn(logger, 'debug');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('15', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.parseUnits('10', 'gwei'), timestamp: timestampMock },
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(3);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices.');
    expect(logger.debug).toHaveBeenNthCalledWith(
      3,
      'No historical gas prices to compute the percentile. Using the provider recommended gas price.'
    );
  });

  it('uses the sanitized percentile price from the state if the new price is above the percentile', async () => {
    const gasPricesMock = Array.from(Array.from({ length: 10 }), (_, i) => ({
      price: ethers.parseUnits(`${i + 1}`, 'gwei'),
      timestamp: timestampMock - 0.9 * gasSettings.sanitizationSamplingWindow - 1,
    }));
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.parseUnits('10', 'gwei'));
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices = gasPricesMock;
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('12', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.parseUnits('10', 'gwei'), timestamp: timestampMock },
      ...gasPricesMock,
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices.');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Sanitizing gas price.', {
      gasPrice: '10000000000',
      percentileGasPrice: '8000000000',
    });
  });

  it('uses provider recommended gas if it is within the percentile', async () => {
    const oldGasPriceValueMock = ethers.parseUnits('11', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestamp: timestampMock,
    };
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.parseUnits('10', 'gwei'));
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
    });
    jest.spyOn(logger, 'debug');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('15', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.parseUnits('10', 'gwei'), timestamp: timestampMock },
      oldGasPriceMock,
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices.');
  });

  it('applies scaling if last update timestamp is past the scaling window', async () => {
    const oldGasPriceValueMock = ethers.parseUnits('5', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestamp: timestampMock,
    };
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.parseUnits('10', 'gwei'));
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
      draft.gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestamp[sponsorWalletAddress] =
        timestampMock - gasSettings.scalingWindow - 1;
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('20', 'gwei')); // The price is multiplied by the scaling multiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.parseUnits('10', 'gwei'), timestamp: timestampMock },
      oldGasPriceMock,
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices.');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Scaling gas price.', { gasPrice: '10000000000', multiplier: 2 });
  });

  it('does not apply scaling if the lag is not sufficient', async () => {
    const oldGasPriceValueMock = ethers.parseUnits('5', 'gwei');
    const oldGasPriceMock = {
      price: oldGasPriceValueMock,
      timestamp: timestampMock,
    };
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    jest.spyOn(provider, 'getGasPrice').mockResolvedValueOnce(ethers.parseUnits('10', 'gwei'));
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName]!.gasPrices.unshift(oldGasPriceMock);
      draft.gasPrices[chainId]![providerName]!.sponsorLastUpdateTimestamp[sponsorWalletAddress] =
        timestampMock - gasSettings.scalingWindow + 1000;
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, sponsorWalletAddress);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('15', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(getState().gasPrices[chainId]![providerName]!.gasPrices).toStrictEqual([
      { price: ethers.parseUnits('10', 'gwei'), timestamp: timestampMock },
      oldGasPriceMock,
    ]);

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Purging old gas prices.');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      'Gas price could be sanitized but there is not enough historical data.',
      { gasPrice: '10000000000', percentileGasPrice: '5000000000' }
    );
  });

  it('throws and error when getting gas price from RPC provider fails', async () => {
    jest.spyOn(provider, 'getGasPrice').mockRejectedValueOnce(new Error('Provider error'));
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, sponsorWalletAddress);

    expect(gasPrice).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state.');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'There is no gas price to use. Skipping update.');
  });
});
