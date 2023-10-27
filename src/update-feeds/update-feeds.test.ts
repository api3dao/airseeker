import { allowPartial } from '../../test/utils';
import type { Chain } from '../config/schema';
import { logger } from '../logger';
import * as stateModule from '../state';
import * as utilsModule from '../utils';

import * as contractMockModule from './temporary-contract-mock';
import { runUpdateFeed, startUpdateFeedLoops } from './update-feeds';

describe(startUpdateFeedLoops.name, () => {
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
    const intervalCalls = [] as number[];
    jest.spyOn(global, 'setInterval').mockImplementation((() => {
      intervalCalls.push(Date.now());
    }) as any);
    jest.spyOn(logger, 'debug');

    await startUpdateFeedLoops();

    // Expect the intervals to be called with the correct stagger time.
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(intervalCalls[1]! - intervalCalls[0]!).toBeGreaterThanOrEqual(50);

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
    const intervalCalls = [] as number[];
    jest.spyOn(global, 'setInterval').mockImplementation((() => {
      intervalCalls.push(Date.now());
    }) as any);
    jest.spyOn(logger, 'debug');

    await startUpdateFeedLoops();

    // Expect the intervals to be called with the correct stagger time.
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(intervalCalls[1]! - intervalCalls[0]!).toBeLessThan(50); // Ensures that the loops are run in parallel.

    // Expect the logs to be called with the correct context.
    expect(logger.debug).toHaveBeenCalledTimes(4);
    expect(logger.debug).toHaveBeenCalledWith('Starting update loops for chain', {
      chainId: '123',
      staggerTime: 100,
      providerNames: ['first-provider'],
    });
    expect(logger.debug).toHaveBeenCalledWith('Starting update loops for chain', {
      chainId: '456',
      staggerTime: 100,
      providerNames: ['another-provider'],
    });
    expect(logger.debug).toHaveBeenCalledWith('Starting update feed loop', {
      chainId: '123',
      providerName: 'first-provider',
    });
    expect(logger.debug).toHaveBeenCalledWith('Starting update feed loop', {
      chainId: '456',
      providerName: 'another-provider',
    });
  });
});

describe(runUpdateFeed.name, () => {
  it('aborts when fetching first dAPIs batch fails', async () => {
    jest.spyOn(contractMockModule, 'getStaticActiveDapis').mockRejectedValue(new Error('provider-error'));
    jest.spyOn(logger, 'error');

    await runUpdateFeed(
      'provider-name',
      allowPartial<Chain>({ dataFeedBatchSize: 2, dataFeedUpdateInterval: 10 }),
      '123'
    );

    // Expect the logs to be called with the correct context.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Failed to get first active dAPIs batch', new Error('provider-error'), {
      chainId: '123',
      providerName: 'provider-name',
    });
  });

  it('fetches other batches in a staggered way and logs errors', async () => {
    // Prepare the mocked contract so it returns three batches (of size 1) of dAPIs and the second batch fails to load.
    const mockedFeed = await contractMockModule.getStaticActiveDapis(0, 0);
    const firstBatch = { ...mockedFeed, totalCount: 3 };
    const thirdBatch = { ...mockedFeed, totalCount: 3 };
    const sleepCalls = [] as number[];
    const originalSleep = utilsModule.sleep;
    jest.spyOn(utilsModule, 'sleep').mockImplementation(async (ms) => {
      sleepCalls.push(ms);
      return originalSleep(ms);
    });
    jest.spyOn(contractMockModule, 'getStaticActiveDapis').mockResolvedValueOnce(firstBatch);
    jest.spyOn(contractMockModule, 'getStaticActiveDapis').mockRejectedValueOnce(new Error('provider-error'));
    jest.spyOn(contractMockModule, 'getStaticActiveDapis').mockResolvedValueOnce(thirdBatch);
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'error');

    await runUpdateFeed(
      'provider-name',
      allowPartial<Chain>({ dataFeedBatchSize: 1, dataFeedUpdateInterval: 0.15 }),
      '123'
    );

    // Expect the contract to fetch the batches to be called with the correct stagger time.
    expect(utilsModule.sleep).toHaveBeenCalledTimes(3);
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(40); // Reserving 10s as the buffer for computing stagger time.
    expect(sleepCalls[1]).toBeGreaterThanOrEqual(0);
    expect(sleepCalls[2]).toBe(49.999_999_999_999_99); // Stagger time is actually 150 / 3 = 50, but there is an rounding error.

    // Expect the logs to be called with the correct context.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Failed to get active dAPIs batch', new Error('provider-error'), {
      chainId: '123',
      providerName: 'provider-name',
    });
    expect(logger.debug).toHaveBeenCalledTimes(4);
    expect(logger.debug).toHaveBeenCalledWith('Fetching first batch of dAPIs batches', {
      chainId: '123',
      providerName: 'provider-name',
    });
    expect(logger.debug).toHaveBeenCalledWith('Fetching batches of active dAPIs', {
      batchesCount: 3,
      staggerTime: 49.999_999_999_999_99,
      chainId: '123',
      providerName: 'provider-name',
    });
    expect(logger.debug).toHaveBeenCalledWith('Fetching batch of active dAPIs', {
      batchIndex: 1,
      chainId: '123',
      providerName: 'provider-name',
    });
    expect(logger.debug).toHaveBeenCalledWith('Fetching batch of active dAPIs', {
      batchIndex: 2,
      chainId: '123',
      providerName: 'provider-name',
    });
  });
});
