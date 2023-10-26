import { ethers } from 'ethers';

import { init } from '../../test/fixtures/mock-config';
import { getState, setState } from '../state';

import {
  getAirseekerRecommendedGasPrice,
  multiplyGasPrice,
  setLastOnChainDatafeedValues,
  setStoreGasPrices,
  updateGasPriceStore,
  clearLastOnChainDatafeedValue,
  clearExpiredStoreGasPrices,
  initializeGasStore,
  gasPriceCollector,
  calculateScalingMultiplier,
} from './gas-price';

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
const timestampMock = 1_696_930_907_351;
const gasPriceMock = ethers.utils.parseUnits('10', 'gwei');

describe('gas price', () => {
  beforeAll(() => {
    init();
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
    beforeEach(() => {
      initializeGasStore(chainId, providerName);
      // Reset the gasPriceStore
      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: { gasPrices: [], lastOnChainDataFeedValues: {} },
          },
        },
      });
    });

    it('clears expired gas prices from the store', () => {
      const oldGasPriceMock = {
        price: ethers.utils.parseUnits('5', 'gwei'),
        timestampMs: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: {
              ...state.gasPriceStore[chainId]![providerName]!,
              gasPrices: [oldGasPriceMock, ...state.gasPriceStore[chainId]![providerName]!.gasPrices],
            },
          },
        },
      });
      clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
      setStoreGasPrices(chainId, providerName, gasPriceMock);

      expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestampMs: timestampMock },
      ]);
    });
  });

  describe(setStoreGasPrices.name, () => {
    beforeEach(() => {
      initializeGasStore(chainId, providerName);
      // Reset the gasPriceStore
      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: { gasPrices: [], lastOnChainDataFeedValues: {} },
          },
        },
      });
    });

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
    beforeEach(() => {
      initializeGasStore(chainId, providerName);
      // Reset the gasPriceStore
      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: { gasPrices: [], lastOnChainDataFeedValues: {} },
          },
        },
      });
    });

    it('returns and updates store with price data', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      const gasPrice = await updateGasPriceStore(chainId, providerName, rpcUrl);

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

      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: {
              ...state.gasPriceStore[chainId]![providerName]!,
              gasPrices: [oldGasPriceMock, ...state.gasPriceStore[chainId]![providerName]!.gasPrices],
            },
          },
        },
      });
      clearExpiredStoreGasPrices(chainId, providerName, gasSettings.sanitizationSamplingWindow);
      const gasPrice = await updateGasPriceStore(chainId, providerName, rpcUrl);

      expect(gasPrice).toStrictEqual(gasPriceMock);
      expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestampMs: timestampMock },
      ]);
    });
  });

  describe(setLastOnChainDatafeedValues.name, () => {
    it('sets last datafeed values details', () => {
      const dataFeedId = '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04';
      const dataFeedValue = {
        value: ethers.BigNumber.from(1),
        timestampMs: 1_697_546_898_352,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      setLastOnChainDatafeedValues(chainId, providerName, dataFeedId, dataFeedValue);

      expect(getState().gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues[dataFeedId]).toStrictEqual(
        dataFeedValue
      );
    });
  });

  describe(clearLastOnChainDatafeedValue.name, () => {
    it('clears last datafeed value details', () => {
      const dataFeedId = '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04';
      const dataFeedValue = {
        value: ethers.BigNumber.from(1),
        timestampMs: 1_697_546_898_352,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      setLastOnChainDatafeedValues(chainId, providerName, dataFeedId, dataFeedValue);
      clearLastOnChainDatafeedValue(chainId, providerName, dataFeedId);

      expect(getState().gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues[dataFeedId]).toBeUndefined();
    });
  });

  describe(gasPriceCollector.name, () => {
    beforeEach(() => {
      initializeGasStore(chainId, providerName);
      // Reset the gasPriceStore
      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: { gasPrices: [], lastOnChainDataFeedValues: {} },
          },
        },
      });
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

      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: {
              ...state.gasPriceStore[chainId]![providerName]!,
              gasPrices: [oldGasPriceMock, ...state.gasPriceStore[chainId]![providerName]!.gasPrices],
            },
          },
        },
      });
      await gasPriceCollector(chainId, providerName, rpcUrl, gasSettings.sanitizationSamplingWindow);

      expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestampMs: timestampMock },
      ]);
    });
  });

  describe(getAirseekerRecommendedGasPrice.name, () => {
    beforeEach(() => {
      initializeGasStore(chainId, providerName);
      // Reset the gasPriceStore
      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: { gasPrices: [], lastOnChainDataFeedValues: {} },
          },
        },
      });
    });

    it('gets, sets and returns provider recommended gas prices', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      const gasPrice = await getAirseekerRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.recommendedGasPriceMultiplier));
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

      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: {
              ...state.gasPriceStore[chainId]![providerName]!,
              gasPrices: gasPricesMock,
            },
          },
        },
      });
      const gasPrice = await getAirseekerRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(
        multiplyGasPrice(ethers.utils.parseUnits('8', 'gwei'), gasSettings.recommendedGasPriceMultiplier)
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

      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: {
              ...state.gasPriceStore[chainId]![providerName]!,
              gasPrices: [oldGasPriceMock, ...state.gasPriceStore[chainId]![providerName]!.gasPrices],
            },
          },
        },
      });
      const gasPrice = await getAirseekerRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.recommendedGasPriceMultiplier));
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

      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: {
              ...state.gasPriceStore[chainId]![providerName]!,
              gasPrices: [oldGasPriceMock, ...state.gasPriceStore[chainId]![providerName]!.gasPrices],
            },
          },
        },
      });
      const gasPrice = await getAirseekerRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(oldGasPriceValueMock, gasSettings.recommendedGasPriceMultiplier));
      expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestampMs: timestampMock },
        oldGasPriceMock,
      ]);
    });

    it('applies scaling if past the scaling window and same nonce', async () => {
      const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
      const oldGasPriceMock = {
        price: oldGasPriceValueMock,
        timestampMs: timestampMock,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      const dataFeedId = '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04';
      const dataFeedValue = {
        value: ethers.BigNumber.from(1),
        // This sets the timestamp to be 1ms past the scalingWindow
        timestampMs: timestampMock - gasSettings.scalingWindow * 60 * 1000 - 1,
      };
      const state = getState();
      setState({
        ...state,
        gasPriceStore: {
          ...state.gasPriceStore,
          [chainId]: {
            ...state.gasPriceStore[chainId],
            [providerName]: {
              ...state.gasPriceStore[chainId]![providerName]!,
              gasPrices: [oldGasPriceMock, ...state.gasPriceStore[chainId]![providerName]!.gasPrices],
              lastOnChainDataFeedValues: {
                ...state.gasPriceStore[chainId]![providerName]!.lastOnChainDataFeedValues,
                [dataFeedId]: dataFeedValue,
              },
            },
          },
        },
      });
      const gasPrice = await getAirseekerRecommendedGasPrice(chainId, providerName, rpcUrl, gasSettings, {
        dataFeedId,
        newDataFeedValue: dataFeedValue,
      });

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.maxScalingMultiplier));
      expect(getState().gasPriceStore[chainId]![providerName]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestampMs: timestampMock },
        oldGasPriceMock,
      ]);
    });
  });
});
