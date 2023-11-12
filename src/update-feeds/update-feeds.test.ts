import { ethers } from 'ethers';
import { omit } from 'lodash';

import { generateTestConfig } from '../../test/fixtures/mock-config';
import { generateMockDapiDataRegistry, generateReadDapiWithIndexResponse } from '../../test/fixtures/mock-contract';
import { allowPartial } from '../../test/utils';
import type { Chain } from '../config/schema';
import { logger } from '../logger';
import * as stateModule from '../state';
import type { DapiDataRegistry } from '../typechain-types';
import * as utilsModule from '../utils';

import * as dapiDataRegistryModule from './dapi-data-registry';
import * as updateFeedsModule from './update-feeds';
import * as updateTransactionModule from './update-transactions';

jest.mock('../state');

describe(updateFeedsModule.startUpdateFeedLoops.name, () => {
  it('starts staggered update loops for a chain', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '123': {
              dataFeedUpdateInterval: 0.1, // Have just 100 ms update interval to make the test run quicker.
              providers: {
                'first-provider': { url: 'first-provider-url' },
                'second-provider': { url: 'second-provider-url' },
              },
            },
          },
        },
      })
    );
    jest.spyOn(updateFeedsModule, 'runUpdateFeed').mockImplementation();
    const intervalCalls = [] as number[];
    jest.spyOn(global, 'setInterval').mockImplementation((() => {
      intervalCalls.push(Date.now());
    }) as any);
    jest.spyOn(logger, 'debug');

    await updateFeedsModule.startUpdateFeedLoops();

    // Expect the intervals to be called with the correct stagger time.
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(intervalCalls[1]! - intervalCalls[0]!).toBeGreaterThanOrEqual(40); // Reserving 10ms as the buffer for computing stagger time.

    // Expect the logs to be called with the correct context.
    expect(logger.debug).toHaveBeenCalledTimes(3);
    expect(logger.debug).toHaveBeenCalledWith('Starting update loops for chain', {
      chainId: '123',
      staggerTime: 50,
      providerNames: ['first-provider', 'second-provider'],
    });
    expect(logger.debug).toHaveBeenCalledWith('Starting update feed loop', {
      chainId: '123',
      providerName: 'first-provider',
    });
    expect(logger.debug).toHaveBeenCalledWith('Starting update feed loop', {
      chainId: '123',
      providerName: 'second-provider',
    });
  });

  it('starts the update loops in parallel for each chain', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '123': {
              dataFeedUpdateInterval: 0.1,
              providers: {
                'first-provider': { url: 'first-provider-url' },
              },
            },
            '456': {
              dataFeedUpdateInterval: 0.1,
              providers: {
                'another-provider': { url: 'another-provider-url' },
              },
            },
          },
        },
      })
    );
    jest.spyOn(updateFeedsModule, 'runUpdateFeed').mockImplementation();
    const intervalCalls = [] as number[];
    jest.spyOn(global, 'setInterval').mockImplementation((() => {
      intervalCalls.push(Date.now());
    }) as any);
    jest.spyOn(logger, 'debug');

    await updateFeedsModule.startUpdateFeedLoops();

    // Expect the intervals to be called with the correct stagger time.
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(intervalCalls[1]! - intervalCalls[0]!).toBeLessThan(50); // Ensures that the loops are run in parallel.

    // Expect the logs to be called with the correct context.
    expect(logger.debug).toHaveBeenCalledTimes(4);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Starting update loops for chain', {
      chainId: '123',
      staggerTime: 100,
      providerNames: ['first-provider'],
    });
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Starting update feed loop', {
      chainId: '123',
      providerName: 'first-provider',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Starting update loops for chain', {
      chainId: '456',
      staggerTime: 100,
      providerNames: ['another-provider'],
    });
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Starting update feed loop', {
      chainId: '456',
      providerName: 'another-provider',
    });
  });
});

describe(updateFeedsModule.runUpdateFeed.name, () => {
  it('aborts when fetching first dAPIs batch fails', async () => {
    const dapiDataRegistry = generateMockDapiDataRegistry();
    jest
      .spyOn(dapiDataRegistryModule, 'getDapiDataRegistry')
      .mockReturnValue(dapiDataRegistry as unknown as DapiDataRegistry);
    dapiDataRegistry.callStatic.tryMulticall.mockRejectedValueOnce(new Error('provider-error'));
    jest.spyOn(logger, 'error');

    await updateFeedsModule.runUpdateFeed(
      'provider-name',
      allowPartial<Chain>({
        dataFeedBatchSize: 2,
        dataFeedUpdateInterval: 10,
        providers: { ['provider-name']: { url: 'provider-url' } },
        contracts: {
          DapiDataRegistry: '0xDD78254f864F97f65e2d86541BdaEf88A504D2B2',
        },
      }),
      '123'
    );

    // Expect the logs to be called with the correct context.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Failed to get first active dAPIs batch', new Error('provider-error'));
  });

  it('fetches other batches in a staggered way and logs errors', async () => {
    // Prepare the mocked contract so it returns three batches (of size 1) of dAPIs and the second batch fails to load.
    const firstDapi = generateReadDapiWithIndexResponse();
    const thirdDapi = generateReadDapiWithIndexResponse();
    const dapiDataRegistry = generateMockDapiDataRegistry();
    jest
      .spyOn(dapiDataRegistryModule, 'getDapiDataRegistry')
      .mockReturnValue(dapiDataRegistry as unknown as DapiDataRegistry);
    dapiDataRegistry.interface.decodeFunctionResult.mockImplementation((_fn, value) => value);
    dapiDataRegistry.callStatic.tryMulticall.mockResolvedValueOnce({
      successes: [true, true],
      returndata: [[ethers.BigNumber.from(3)], firstDapi],
    });
    dapiDataRegistry.callStatic.tryMulticall.mockResolvedValueOnce({ successes: [false], returndata: [] });
    dapiDataRegistry.callStatic.tryMulticall.mockResolvedValueOnce({ successes: [true], returndata: [thirdDapi] });
    const sleepCalls = [] as number[];
    const originalSleep = utilsModule.sleep;
    jest.spyOn(utilsModule, 'sleep').mockImplementation(async (ms) => {
      sleepCalls.push(ms);
      return originalSleep(ms);
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'error');

    const testConfig = generateTestConfig();
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: testConfig,
        signedApiUrlStore: {
          '31337': { 'some-test-provider': { '0xC04575A2773Da9Cd23853A69694e02111b2c4182': 'url-one' } },
        },
        signedApiStore: {},
        gasPriceStore: {
          '31337': {
            'some-test-provider': {
              gasPrices: [],
              sponsorLastUpdateTimestampMs: {
                '0xdatafeedId': 100,
              },
            },
          },
        },
      })
    );
    jest
      .spyOn(updateFeedsModule, 'getFeedsToUpdate')
      .mockImplementation(() => [
        allowPartial<updateTransactionModule.UpdateableDapi>({ dapiInfo: firstDapi }),
        allowPartial<updateTransactionModule.UpdateableDapi>({ dapiInfo: thirdDapi }),
      ]);
    jest.spyOn(updateTransactionModule, 'updateFeeds').mockResolvedValue([null, null]);

    await updateFeedsModule.runUpdateFeed(
      'provider-name',
      allowPartial<Chain>({
        dataFeedBatchSize: 1,
        dataFeedUpdateInterval: 0.15,
        providers: { ['provider-name']: { url: 'provider-url' } },
        contracts: {
          DapiDataRegistry: '0xDD78254f864F97f65e2d86541BdaEf88A504D2B2',
        },
      }),
      '31337'
    );

    // Expect the contract to fetch the batches to be called with the correct stagger time.
    expect(utilsModule.sleep).toHaveBeenCalledTimes(3);
    expect(sleepCalls[0]).toBeGreaterThan(0); // The first stagger time is computed dynamically (the execution time is subtracted from the interval time) which is slow on CI, so we just check it's non-zero.
    expect(sleepCalls[1]).toBe(0);
    expect(sleepCalls[2]).toBe(49.999_999_999_999_99); // Stagger time is actually 150 / 3 = 50, but there is a rounding error.

    // Expect the logs to be called with the correct context.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to get active dAPIs batch',
      new Error('One of the multicalls failed')
    );
    expect(logger.debug).toHaveBeenCalledTimes(7);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching first batch of dAPIs batches');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Processing batch of active dAPIs', expect.anything());
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Fetching batches of active dAPIs', {
      batchesCount: 3,
      staggerTime: 49.999_999_999_999_99,
    });
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Fetching batch of active dAPIs', {
      batchIndex: 1,
    });
    expect(logger.debug).toHaveBeenNthCalledWith(5, 'Fetching batch of active dAPIs', {
      batchIndex: 2,
    });
    expect(logger.debug).toHaveBeenNthCalledWith(6, 'Processing batch of active dAPIs', expect.anything());
    expect(logger.debug).toHaveBeenNthCalledWith(7, 'Finished processing batches of active dAPIs', {
      batchesCount: 3,
      errorCount: 4,
      successCount: 0,
    });
  });
});

describe(updateFeedsModule.getFeedsToUpdate.name, () => {
  it('applies deviationThresholdCoefficient from config', () => {
    const dapi = generateReadDapiWithIndexResponse();
    const decodedDataFeed = dapiDataRegistryModule.decodeDataFeed(dapi.dataFeed);
    const decodedDapi = { ...omit(dapi, ['dataFeed']), decodedDataFeed };
    jest.spyOn(Date, 'now').mockReturnValue(dapi.dataFeedValue.timestamp);
    const testConfig = generateTestConfig();
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: testConfig,
        signedApiUrlStore: { '31337': { 'some-test-provider': ['url-one'] } },
        signedApiStore: {
          '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6': {
            airnode: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
            templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
            encodedValue: ethers.utils.defaultAbiCoder.encode(
              ['int256'],
              [
                ethers.BigNumber.from(
                  dapi.dataFeedValue.value
                    // Multiply the new value by the on chain deviationThresholdInPercentage
                    .mul(dapi.updateParameters.deviationThresholdInPercentage.add(1 * 1e8))
                    .div(1e8)
                ),
              ]
            ),
            signature:
              '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
            timestamp: (dapi.dataFeedValue.timestamp + 1).toString(),
          },
        },
        gasPriceStore: {
          '31337': {
            'some-test-provider': {
              gasPrices: [],
              sponsorLastUpdateTimestampMs: {
                '0xdatafeedId': 100,
              },
            },
          },
        },
      })
    );
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'info');

    const feeds = updateFeedsModule.getFeedsToUpdate([decodedDapi], 2);

    expect(logger.warn).not.toHaveBeenCalledWith(`Off-chain sample's timestamp is older than on-chain timestamp.`);
    expect(logger.warn).not.toHaveBeenCalledWith(`On-chain timestamp is older than the heartbeat interval.`);
    expect(logger.info).not.toHaveBeenCalledWith(`Deviation exceeded.`);
    expect(feeds).toStrictEqual([]);
  });
});
