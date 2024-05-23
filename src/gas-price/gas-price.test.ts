import type { Hex } from '@api3/commons';
import { ethers } from 'ethers';
import { range } from 'lodash';

import { generateTestConfig, initializeState } from '../../test/fixtures/mock-config';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import { initializePendingTransactionsInfo } from '../update-feeds-loops/pending-transaction-info';

import {
  getRecommendedGasPrice,
  saveGasPrice,
  purgeOldGasPrices,
  initializeGasState,
  calculateScalingMultiplier,
  getPercentile,
  fetchAndStoreGasPrice,
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
const dataFeedId = '0x46943ffe87750e941b301d2a141d53106df392bcc6e65a3b07354fdd6f1f45fc';
const testConfig = generateTestConfig();
testConfig.chains[chainId]!.gasSettings.scalingWindow = 120;
const { gasSettings } = testConfig.chains[chainId]!;

beforeEach(() => {
  initializeState(testConfig);
  initializeGasState(chainId, providerName);
  initializePendingTransactionsInfo(chainId, providerName);
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
      draft.gasPrices[chainId]![providerName] = [oldGasPriceMock];
    });

    purgeOldGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);

    expect(getState().gasPrices[chainId]![providerName]!).toStrictEqual([]);
  });
});

describe(saveGasPrice.name, () => {
  it('updates state with price data', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);

    saveGasPrice(chainId, providerName, ethers.parseUnits('10', 'gwei'));

    expect(getState().gasPrices[chainId]![providerName]!).toStrictEqual([
      { price: ethers.parseUnits('10', 'gwei'), timestamp: timestampMock },
    ]);
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
  it('returns null when there is no gas price to use', () => {
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'warn');

    const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);

    expect(gasPrice).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'There is no gas price stored.');
  });

  it('caps the gas price if it is above the sanitization treshold', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    // Make sure there are enough historical gas prices to sanitize.
    const gasPrices = range(30).map((_, i) => ({
      price: ethers.parseUnits(`10`, 'gwei') - BigInt(i) * 100_000_000n,
      timestamp: timestampMock - 30 * (i + 1),
    }));
    // Add a huge latest gas price.
    gasPrices.push({
      price: ethers.parseUnits('100', 'gwei'),
      timestamp: timestampMock,
    });
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName] = gasPrices;
    });
    jest.spyOn(logger, 'warn');

    const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('17.2', 'gwei'));
    const percentile = getPercentile(
      testConfig.chains[chainId]!.gasSettings.sanitizationPercentile,
      gasPrices.map((x) => x.price)
    );
    const expectedGasPrice = BigInt(
      Number(percentile) * testConfig.chains[chainId]!.gasSettings.sanitizationMultiplier
    );
    expect(gasPrice).toStrictEqual(expectedGasPrice);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Sanitizing gas price.', {
      gasPrice: '120000000000',
      ratio: '6.98',
      sanitizationGasPriceCap: '17200000000',
    });
  });

  it('logs a warning when there is not enough data for sanitization', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    const gasPrices = range(10).map((_, i) => ({
      price: ethers.parseUnits(`10`, 'gwei') - BigInt(i) * 100_000_000n,
      timestamp: timestampMock - 30 * (i + 1),
    }));
    // Add a huge latest gas price.
    gasPrices.push({
      price: ethers.parseUnits('100', 'gwei'),
      timestamp: timestampMock,
    });
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName] = gasPrices;
    });
    jest.spyOn(logger, 'warn');

    const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('120', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      'Gas price could be sanitized but there is not enough historical data.',
      {
        gasPrice: '120000000000',
        sanitizationGasPriceCap: '19200000000',
      }
    );
  });

  it('uses last stored gas price if it is within the percentile', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName] = [];
      for (let i = 0; i < 20; i++) {
        draft.gasPrices[chainId]![providerName].unshift({
          price: ethers.parseUnits('9', 'gwei') + BigInt(-i) * 100_000_000n, // Let the gas price deviate up and down, such that the the last price is within the percentile.
          timestamp: timestampMock - (20 - i) * 30,
        });
      }
    });
    const latestStoredGasPrice = getState().gasPrices[chainId]![providerName]![0]!.price;
    jest.spyOn(logger, 'warn');

    const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);

    expect(latestStoredGasPrice).toStrictEqual(ethers.parseUnits('7.1', 'gwei'));
    expect(gasPrice).toStrictEqual(ethers.parseUnits('8.52', 'gwei')); // The price is multiplied by the recommendedGasPriceMultiplier.
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });

  it('applies scaling if the transaction is a retry of a pending transaction', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName] = [];
      draft.pendingTransactionsInfo[chainId]![providerName] = {
        [sponsorWalletAddress]: {
          [dataFeedId]: {
            consecutivelyUpdatableCount: 2,
            firstUpdatableTimestamp: timestampMock - 60, // The feed requires update for 1 minute.
            onChainTimestamp: BigInt(timestampMock - 65),
          },
        },
      };
      for (let i = 0; i < 20; i++) {
        draft.gasPrices[chainId]![providerName].unshift({
          price: ethers.parseUnits('9', 'gwei') + BigInt(i) * 100_000_000n,
          timestamp: timestampMock - (20 - i) * 30,
        });
      }
    });
    jest.spyOn(logger, 'warn');

    const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('17.44', 'gwei')); // The price is multiplied by the scaling multiplier.

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Scaling gas price.', {
      gasPrice: '10900000000',
      multiplier: 1.6,
      pendingPeriod: 60,
    });
  });

  it('scales up to a maximum scaling multiplier', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName] = [];
      draft.pendingTransactionsInfo[chainId]![providerName] = {
        [sponsorWalletAddress]: {
          [dataFeedId]: {
            consecutivelyUpdatableCount: 12,
            firstUpdatableTimestamp: timestampMock - 60 * 60, // The feed requires update for 1 hour.
            onChainTimestamp: BigInt(timestampMock - 60 * 60 + 5),
          },
        },
      };
      for (let i = 0; i < 20; i++) {
        draft.gasPrices[chainId]![providerName].unshift({
          price: ethers.parseUnits('9', 'gwei') + BigInt(i) * 50_000_000n,
          timestamp: timestampMock - (20 - i) * 30,
        });
      }
      // Make the most up to date gas price too little.
      draft.gasPrices[chainId]![providerName].push({
        price: ethers.parseUnits('5', 'gwei'),
        timestamp: timestampMock,
      });
    });
    jest.spyOn(logger, 'warn');

    const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('10', 'gwei'));

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Scaling gas price.', {
      gasPrice: '5000000000',
      multiplier: 2,
      pendingPeriod: 3600,
    });
  });

  it('can sanitize and scale at the same time', () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName] = [];
      draft.pendingTransactionsInfo[chainId]![providerName] = {
        [sponsorWalletAddress]: {
          [dataFeedId]: {
            consecutivelyUpdatableCount: 12,
            firstUpdatableTimestamp: timestampMock - 60 * 60, // The feed requires update for 1 hour.
            onChainTimestamp: BigInt(timestampMock - 60 * 60 + 5),
          },
        },
      };
      for (let i = 0; i < 30; i++) {
        draft.gasPrices[chainId]![providerName].unshift({
          price: ethers.parseUnits('9', 'gwei') + BigInt(i) * 50_000_000n,
          timestamp: timestampMock - (30 - i) * 30,
        });
      }
    });
    jest.spyOn(logger, 'warn');

    const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('19.4', 'gwei'));

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Scaling gas price.', {
      gasPrice: '10450000000',
      multiplier: 2,
      pendingPeriod: 3600,
    });
    expect(logger.warn).toHaveBeenNthCalledWith(2, 'Sanitizing gas price.', {
      gasPrice: '20900000000',
      ratio: '1.08',
      sanitizationGasPriceCap: '19400000000',
    });
  });

  it('applies scaling based on oldest non-null pending data feed when multiple data feed IDs are passed', () => {
    const anotherDataFeedId = ethers.hexlify(ethers.randomBytes(32)) as Hex;
    const yetAnotherDataFeedId = ethers.hexlify(ethers.randomBytes(32)) as Hex;

    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    updateState((draft) => {
      draft.gasPrices[chainId]![providerName] = [];
      draft.pendingTransactionsInfo[chainId]![providerName] = {
        [sponsorWalletAddress]: {
          [dataFeedId]: {
            consecutivelyUpdatableCount: 2,
            firstUpdatableTimestamp: timestampMock - 59,
            onChainTimestamp: BigInt(timestampMock - 65),
          },
          [anotherDataFeedId]: {
            consecutivelyUpdatableCount: 2,
            firstUpdatableTimestamp: timestampMock - 60,
            onChainTimestamp: BigInt(timestampMock - 65),
          },
          [yetAnotherDataFeedId]: null,
        },
      };
      for (let i = 0; i < 20; i++) {
        draft.gasPrices[chainId]![providerName].unshift({
          price: ethers.parseUnits('9', 'gwei') + BigInt(i) * 100_000_000n,
          timestamp: timestampMock - (20 - i) * 30,
        });
      }
    });
    jest.spyOn(logger, 'warn');

    const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [
      dataFeedId,
      anotherDataFeedId,
      yetAnotherDataFeedId,
    ]);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('17.44', 'gwei')); // The price is multiplied by the scaling multiplier.

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Scaling gas price.', {
      gasPrice: '10900000000',
      multiplier: 1.6,
      pendingPeriod: 60,
    });
  });
});

describe(fetchAndStoreGasPrice.name, () => {
  it('fetches and stores the gas price from RPC provider', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(dateNowMock);
    jest.spyOn(provider, 'getFeeData').mockResolvedValueOnce({ gasPrice: ethers.parseUnits('10', 'gwei') } as any);

    const gasPrice = await fetchAndStoreGasPrice(chainId, providerName, provider);

    expect(gasPrice).toStrictEqual(ethers.parseUnits('10', 'gwei'));
    expect(getState().gasPrices[chainId]![providerName]!).toStrictEqual([
      { price: ethers.parseUnits('10', 'gwei'), timestamp: timestampMock },
    ]);
  });

  it('logs an error when fetching gas price from RPC provider fails', async () => {
    jest.spyOn(provider, 'getFeeData').mockRejectedValueOnce(new Error('Provider error'));
    jest.spyOn(logger, 'error');

    const gasPrice = await fetchAndStoreGasPrice(chainId, providerName, provider);

    expect(gasPrice).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      'Failed to fetch gas price from RPC provider.',
      new Error('Provider error')
    );
  });

  it('logs an error when RPC provider does not return the gas price', async () => {
    jest.spyOn(provider, 'getFeeData').mockResolvedValueOnce({} as any);
    jest.spyOn(logger, 'error');

    const gasPrice = await fetchAndStoreGasPrice(chainId, providerName, provider);

    expect(gasPrice).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenNthCalledWith(1, 'No gas price returned from RPC provider.');
  });
});
