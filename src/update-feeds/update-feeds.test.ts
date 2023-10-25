import { allowPartial } from '../../test/utils';
import type { Chain } from '../config/schema';
import { logger } from '../logger';
import * as stateModule from '../state';

import * as contractMockModule from './temporary-contract-mock';
import { runUpdateFeed, startUpdateFeedsLoops } from './update-feeds';

describe(startUpdateFeedsLoops.name, () => {
  it('starts staggered update loops for a chain', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '123': {
              dataFeedUpdateInterval: 1, // Have just 1 second update interval to make the test run quicker.
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

    await startUpdateFeedsLoops();

    // Expect the intervals to be called with the correct stagger time.
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(intervalCalls[1]! - intervalCalls[0]!).toBeGreaterThanOrEqual(500);

    // Expect the logs to be called with the correct context.
    expect(logger.debug).toHaveBeenCalledTimes(3);
    expect(logger.debug).toHaveBeenCalledWith('Starting update loops for chain', {
      chainId: '123',
      staggerTime: 500,
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
              dataFeedUpdateInterval: 1,
              providers: {
                'first-provider': { url: 'first-provider-url' },
              },
            },
            '456': {
              dataFeedUpdateInterval: 1,
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

    await startUpdateFeedsLoops();

    // Expect the intervals to be called with the correct stagger time.
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(intervalCalls[1]! - intervalCalls[0]!).toBeLessThan(50); // Ensures that the loops are run in parallel.

    // Expect the logs to be called with the correct context.
    expect(logger.debug).toHaveBeenCalledTimes(4);
    expect(logger.debug).toHaveBeenCalledWith('Starting update loops for chain', {
      chainId: '123',
      staggerTime: 1000,
      providerNames: ['first-provider'],
    });
    expect(logger.debug).toHaveBeenCalledWith('Starting update loops for chain', {
      chainId: '456',
      staggerTime: 1000,
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
    const getStaticActiveDapisCalls = [] as number[];
    // eslint-disable-next-line @typescript-eslint/require-await
    jest.spyOn(contractMockModule, 'getStaticActiveDapis').mockImplementationOnce(async () => {
      getStaticActiveDapisCalls.push(Date.now());
      return firstBatch;
    });
    // eslint-disable-next-line @typescript-eslint/require-await
    jest.spyOn(contractMockModule, 'getStaticActiveDapis').mockImplementationOnce(async () => {
      getStaticActiveDapisCalls.push(Date.now());
      throw new Error('provider-error');
    });
    // eslint-disable-next-line @typescript-eslint/require-await
    jest.spyOn(contractMockModule, 'getStaticActiveDapis').mockImplementationOnce(async () => {
      getStaticActiveDapisCalls.push(Date.now());
      return thirdBatch;
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'error');

    await runUpdateFeed(
      'provider-name',
      allowPartial<Chain>({ dataFeedBatchSize: 1, dataFeedUpdateInterval: 1.5 }),
      '123'
    );

    // Expect the contract to fetch the batches to be called with the correct stagger time.
    expect(getStaticActiveDapisCalls).toHaveLength(3);
    expect(getStaticActiveDapisCalls[1]! - getStaticActiveDapisCalls[0]!).toBeGreaterThanOrEqual(500);
    expect(getStaticActiveDapisCalls[2]! - getStaticActiveDapisCalls[1]!).toBeGreaterThanOrEqual(500);

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
      staggerTime: 500,
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
