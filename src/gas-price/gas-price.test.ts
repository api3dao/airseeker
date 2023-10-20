import { ethers } from 'ethers';

import {
  airseekerV2ProviderRecommendedGasPrice,
  multiplyGasPrice,
  setLastOnChainDatafeedValues,
  setStoreGasPrices,
  updateGasPriceStore,
  gasPriceStore,
  clearExpiredStoreGasPrices,
  initializeGasStore,
} from './gas-price';

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
const timestampMock = 1_696_930_907_351;
const gasPriceMock = ethers.utils.parseUnits('10', 'gwei');

describe('gas price', () => {
  describe('clearExpiredStoreGasPrices', () => {
    beforeEach(() => {
      initializeGasStore(chainId, providerName);
      // Reset the gasPriceStore
      gasPriceStore[chainId]![providerName] = { gasPrices: [], lastOnChainDataFeedValues: {} };
    });

    it('clears expired gas prices from the store', () => {
      const oldGasPriceMock = {
        price: ethers.utils.parseUnits('5', 'gwei'),
        timestamp: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];
      clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
      setStoreGasPrices(chainId, providerName, gasPriceMock);

      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
      ]);
    });
  });

  describe('setStoreGasPrices', () => {
    beforeEach(() => {
      // Reset the gasPriceStore
      gasPriceStore[chainId]![providerName] = { gasPrices: [], lastOnChainDataFeedValues: {} };
    });

    it('updates store with price data', () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      setStoreGasPrices(chainId, providerName, gasPriceMock);

      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
      ]);
    });
  });

  describe('updateGasPriceStore', () => {
    beforeEach(() => {
      // Reset the gasPriceStore
      gasPriceStore[chainId]![providerName] = { gasPrices: [], lastOnChainDataFeedValues: {} };
    });

    it('returns and updates store with price data', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      const gasPrice = await updateGasPriceStore(chainId, providerName, rpcUrl);

      expect(gasPrice).toStrictEqual(gasPriceMock);
      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
      ]);
    });

    it('clears expired gas prices from the store', async () => {
      const oldGasPriceMock = {
        price: ethers.utils.parseUnits('5', 'gwei'),
        timestamp: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];
      clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
      const gasPrice = await updateGasPriceStore(chainId, providerName, rpcUrl);

      expect(gasPrice).toStrictEqual(gasPriceMock);
      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
      ]);
    });
  });

  describe('setLastTransactionDetails', () => {
    it('sets last datafeed values details', () => {
      const dataFeedId = '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04';
      const dataFeedValue = {
        value: ethers.BigNumber.from(1),
        timestamp: 1_697_546_898_352,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      setLastOnChainDatafeedValues(chainId, providerName, dataFeedId, dataFeedValue);

      expect(gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues[dataFeedId]).toStrictEqual(dataFeedValue);
    });
  });

  describe('airseekerV2ProviderRecommendedGasPrice', () => {
    beforeEach(() => {
      // Reset the gasPriceStore
      gasPriceStore[chainId]![providerName] = { gasPrices: [], lastOnChainDataFeedValues: {} };
    });

    it('gets, sets and returns provider recommended gas prices', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.recommendedGasPriceMultiplier));
      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
      ]);
    });

    it('gets and uses the percentile price from the store', async () => {
      const gasPricesMock = Array.from(Array.from({ length: 10 }), (_, i) => ({
        price: ethers.utils.parseUnits(`${i + 1}`, 'gwei'),
        timestamp: timestampMock,
      }));
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]![providerName]!.gasPrices = gasPricesMock;
      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(
        multiplyGasPrice(ethers.utils.parseUnits('8', 'gwei'), gasSettings.recommendedGasPriceMultiplier)
      );
      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
        ...gasPricesMock,
      ]);
    });

    it('clears expired gas prices from the store', async () => {
      const oldGasPriceMock = {
        price: ethers.utils.parseUnits('5', 'gwei'),
        timestamp: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];
      await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
      ]);
    });

    it('returns new price if it is within the percentile', async () => {
      const oldGasPriceValueMock = ethers.utils.parseUnits('11', 'gwei');
      const oldGasPriceMock = {
        price: oldGasPriceValueMock,
        timestamp: timestampMock,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];
      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.recommendedGasPriceMultiplier));
      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
        oldGasPriceMock,
      ]);
    });

    it('returns sanitized price if new price is above the percentile', async () => {
      const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
      const oldGasPriceMock = {
        price: oldGasPriceValueMock,
        timestamp: timestampMock,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];
      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(oldGasPriceValueMock, gasSettings.recommendedGasPriceMultiplier));
      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
        oldGasPriceMock,
      ]);
    });

    it('applies scaling if past the scaling window and same nonce', async () => {
      const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
      const oldGasPriceMock = {
        price: oldGasPriceValueMock,
        timestamp: timestampMock,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]![providerName]!.gasPrices = [oldGasPriceMock];
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

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.scalingMultiplier));
      expect(gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
        oldGasPriceMock,
      ]);
    });
  });
});
