import * as commonsModule from '@api3/commons';
import type { Hex } from '@api3/commons';
import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { createMockSignedDataVerifier, generateRandomBytes, generateSignedData } from '../../test/utils';
import { logger } from '../logger';
import { updateState } from '../state';
import { sleep } from '../utils';

import * as dataFetcherLoopModule from './data-fetcher-loop';
import * as signedDataStateModule from './signed-data-state';
import * as signedDataVerifierPoolModule from './signed-data-verifier-pool';

jest.setTimeout(10_000); // Default Jest timeout is 5s which is not enough for staggering two Signed API calls with signedDataFetchInterval 10s

describe(dataFetcherLoopModule.startDataFetcherLoop.name, () => {
  it('logs an unexpected error of the data fetcher', async () => {
    initializeState();
    jest.spyOn(dataFetcherLoopModule, 'runDataFetcher').mockImplementation(async () => {
      await sleep(0);
      throw new Error('unexpected-unhandled-error');
    });
    jest.spyOn(globalThis, 'setInterval').mockImplementation();
    jest.spyOn(logger, 'error');

    dataFetcherLoopModule.startDataFetcherLoop();
    await (jest.mocked(setInterval).mock.calls[0]![0] as () => Promise<void>)();

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      'Unexpected error when fetching signed data.',
      new Error('unexpected-unhandled-error')
    );
    expect(logger.error).toHaveBeenNthCalledWith(
      2,
      'Unexpected error when fetching signed data.',
      new Error('unexpected-unhandled-error')
    );
  });
});

describe(dataFetcherLoopModule.runDataFetcher.name, () => {
  beforeEach(() => {
    initializeState();
    updateState((draft) => {
      draft.signedApiUrlsFromConfig = {
        '31337': { hardhat: ['http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182'] },
      };
      draft.signedApiUrlsFromContract = {
        '31337': { hardhat: [] },
      };
      draft.activeDataFeedBeaconIds = {
        '31337': {
          hardhat: [
            '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04',
            '0xddc6ca9cc6f5768d9bfa8cc59f79bde8cf97a6521d0b95835255951ce06f19e6',
          ],
        },
      };
    });
  });

  it('saves signed data for active data feeds', async () => {
    jest.spyOn(commonsModule, 'executeRequest').mockResolvedValue({
      success: true,
      errorData: undefined,
      statusCode: 200,
      data: {
        count: 3,
        data: {
          '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04': {
            signature:
              '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
            timestamp: '1687850583',
            templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
            encodedValue: '0x000000000000000000000000000000000000000000000065954b143faff77440',
            airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
          },
          '0xddc6ca9cc6f5768d9bfa8cc59f79bde8cf97a6521d0b95835255951ce06f19e6': {
            signature:
              '0x1f8993bae330ff73f050aeb8221207f80d22c43174e56079663d520fd2ccaec52b87f56d2fb2184f99d0c37dabd78cf7ff4f2cd27f7fd337d06ebfe590e09a7d1c',
            timestamp: '1687850583',
            templateId: '0x55d08a477d28519c8bc889b0be4f4d08625cfec5369f047258a1a4d7e1e405f3',
            encodedValue: '0x00000000000000000000000000000000000000000000066e419d6bdc61e19680',
            airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
          },
          '0x5dd8d9e1429f69ba4bd76df5709155110429857d19670cc157632f66a48ee1f7': {
            signature:
              '0x48c9c53645b5e69c986ab02fcae88ddd5247ce000bf1fddb2cd83ac6af8553e554164d3f6d5906fa8d24ce9224484a2664a70bb75893e9cf18bcffadee4345bc1c',
            timestamp: '1687850583',
            templateId: '0x96504241fb9ae9a5941f97c9561dcfcd7cee77ee9486a58c8e78551c1268ddec',
            encodedValue: '0x0000000000000000000000000000000000000000000000000e461510ad9d8678',
            airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
          },
        },
      },
    });
    jest.spyOn(dataFetcherLoopModule, 'callSignedApi');
    jest.spyOn(signedDataStateModule, 'isSignedDataFresh').mockReturnValue(true);
    jest.spyOn(signedDataVerifierPoolModule, 'getVerifier').mockResolvedValue(createMockSignedDataVerifier());
    jest.spyOn(logger, 'info');
    jest.spyOn(signedDataStateModule, 'saveSignedData');

    await expect(dataFetcherLoopModule.runDataFetcher()).resolves.toBeDefined();

    expect(commonsModule.executeRequest).toHaveBeenCalledTimes(1);
    expect(signedDataStateModule.saveSignedData).toHaveBeenCalledTimes(1);
    expect(dataFetcherLoopModule.callSignedApi).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182',
      10_000
    );
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      'Started data fetcher loop.',
      expect.objectContaining({ urlCount: 1, staggerTimeMs: 10_000 })
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      'Finished data fetcher loop.',
      expect.objectContaining({
        loopDuration: expect.any(Number),
        averageFetchDuration: expect.any(Number),
        averageSaveDuration: expect.any(Number),
        fastestFetch: expect.objectContaining({
          url: 'http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182',
          count: 3,
          duration: expect.any(Number),
        }),
        slowestFetch: expect.objectContaining({
          url: 'http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182',
          count: 3,
          duration: expect.any(Number),
        }),
        fastestSave: expect.objectContaining({
          url: 'http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182',
          count: 2,
          duration: expect.any(Number),
        }),
        slowestSave: expect.objectContaining({
          url: 'http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182',
          count: 2,
          duration: expect.any(Number),
        }),
      })
    );
  });

  it('saves signed data for active data feeds when other signed data has a zero timestamp', async () => {
    const airnodeWallet = ethers.Wallet.fromPhrase('test test test test test test test test test test test junk');
    const airnode = airnodeWallet.address as Hex;
    const templateId = generateRandomBytes(32);
    const otherTemplateId = generateRandomBytes(32);
    const beaconId = commonsModule.deriveBeaconId(airnode, templateId) as Hex;
    const signedData = await generateSignedData(airnodeWallet, templateId, Math.floor(Date.now() / 1000).toString());
    // Airnode feed signs the timestamp returned by the OIS post-processing, which can be 0.
    const otherSignedData = await generateSignedData(airnodeWallet, otherTemplateId, '0');
    updateState((draft) => {
      draft.signedApiUrlsFromConfig = {
        '31337': { hardhat: [`http://127.0.0.1:8090/${airnode}`] },
      };
      draft.activeDataFeedBeaconIds = { '31337': { hardhat: [beaconId] } };
    });
    jest.spyOn(commonsModule, 'executeRequest').mockResolvedValue({
      success: true,
      errorData: undefined,
      statusCode: 200,
      data: {
        count: 2,
        data: {
          [beaconId]: signedData,
          [commonsModule.deriveBeaconId(airnode, otherTemplateId)]: otherSignedData,
        },
      },
    });

    await expect(dataFetcherLoopModule.runDataFetcher()).resolves.toBeDefined();

    expect(signedDataStateModule.getSignedData(beaconId)).toStrictEqual(signedData);
  });

  it('respects useSignedApiUrlsFromContract flag when set to false', async () => {
    updateState((draft) => {
      draft.config.useSignedApiUrlsFromContract = false;
      draft.signedApiUrlsFromContract = {
        '31337': { hardhat: ['http://127.0.0.1:8091/0xContractProvidedAirnode'] },
      };
    });

    const callSignedApiSpy = jest.spyOn(dataFetcherLoopModule, 'callSignedApi').mockResolvedValue(null);
    jest.spyOn(signedDataStateModule, 'isSignedDataFresh').mockReturnValue(true);
    jest.spyOn(signedDataStateModule, 'saveSignedData').mockResolvedValue(0);
    jest.spyOn(signedDataStateModule, 'purgeOldSignedData').mockImplementation();
    jest.spyOn(signedDataVerifierPoolModule, 'getVerifier').mockResolvedValue(createMockSignedDataVerifier());
    jest.spyOn(logger, 'info');
    jest.spyOn(logger, 'debug');

    await expect(dataFetcherLoopModule.runDataFetcher()).resolves.toBeDefined();

    expect(callSignedApiSpy).toHaveBeenCalledTimes(1);
    expect(callSignedApiSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182',
      10_000
    );
    expect(callSignedApiSpy).not.toHaveBeenCalledWith('http://127.0.0.1:8091/0xContractProvidedAirnode', 10_000);

    expect(logger.debug).toHaveBeenCalledWith(
      'Signed API URLs.',
      expect.objectContaining({
        useSignedApiUrlsFromContract: false,
      })
    );

    expect(logger.info).toHaveBeenCalledWith('Started data fetcher loop.', expect.objectContaining({ urlCount: 1 }));
  });

  it('respects useSignedApiUrlsFromContract flag when set to true', async () => {
    updateState((draft) => {
      draft.config.useSignedApiUrlsFromContract = true;
      draft.signedApiUrlsFromContract = {
        '31337': { hardhat: ['http://127.0.0.1:8091/0xContractProvidedAirnode'] },
      };
    });

    const callSignedApiSpy = jest.spyOn(dataFetcherLoopModule, 'callSignedApi').mockResolvedValue(null);
    jest.spyOn(signedDataStateModule, 'isSignedDataFresh').mockReturnValue(true);
    jest.spyOn(signedDataStateModule, 'saveSignedData').mockResolvedValue(0);
    jest.spyOn(signedDataStateModule, 'purgeOldSignedData').mockImplementation();
    jest.spyOn(signedDataVerifierPoolModule, 'getVerifier').mockResolvedValue(createMockSignedDataVerifier());
    jest.spyOn(logger, 'info');
    jest.spyOn(logger, 'debug');

    await expect(dataFetcherLoopModule.runDataFetcher()).resolves.toBeDefined();

    expect(callSignedApiSpy).toHaveBeenCalledTimes(2);
    expect(callSignedApiSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182',
      10_000
    );
    expect(callSignedApiSpy).toHaveBeenCalledWith('http://127.0.0.1:8091/0xContractProvidedAirnode', 10_000);

    expect(logger.debug).toHaveBeenCalledWith(
      'Signed API URLs.',
      expect.objectContaining({
        useSignedApiUrlsFromContract: true,
      })
    );

    expect(logger.info).toHaveBeenCalledWith('Started data fetcher loop.', expect.objectContaining({ urlCount: 2 }));
  });

  it('logs an unexpected error when calling Signed API and finishes the loop', async () => {
    jest.spyOn(dataFetcherLoopModule, 'callSignedApi').mockRejectedValue(new Error('unexpected-unhandled-error'));
    jest.spyOn(signedDataStateModule, 'purgeOldSignedData').mockImplementation();
    jest.spyOn(signedDataStateModule, 'saveSignedData');
    jest.spyOn(logger, 'info');
    jest.spyOn(logger, 'error');

    await expect(dataFetcherLoopModule.runDataFetcher()).resolves.toBeDefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Unexpected error when calling Signed API.',
      new Error('unexpected-unhandled-error'),
      { url: 'http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182' }
    );
    expect(signedDataStateModule.saveSignedData).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Finished data fetcher loop.',
      expect.objectContaining({ loopDuration: expect.any(Number) })
    );
    expect(signedDataStateModule.purgeOldSignedData).toHaveBeenCalledTimes(1);
  });
});

describe(dataFetcherLoopModule.callSignedApi.name, () => {
  it('handles parsing error from Signed API', async () => {
    jest.spyOn(commonsModule, 'executeRequest').mockResolvedValue({
      success: true,
      errorData: undefined,
      statusCode: 200,
      data: {
        count: 1,
        data: {
          '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04': {
            // Missing many properties that should be present
            signature:
              '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
          },
        },
      },
    });
    jest.spyOn(logger, 'warn');

    await expect(dataFetcherLoopModule.callSignedApi('some-url', 10_000)).resolves.toBeNull();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Failed to parse Signed API response.', {
      url: 'some-url',
      errors: JSON.stringify([
        {
          expected: 'string',
          code: 'invalid_type',
          path: ['data', '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04', 'airnode'],
          message: 'Invalid input: expected string, received undefined',
        },
        {
          expected: 'string',
          code: 'invalid_type',
          path: ['data', '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04', 'templateId'],
          message: 'Invalid input: expected string, received undefined',
        },
        {
          expected: 'string',
          code: 'invalid_type',
          path: ['data', '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04', 'timestamp'],
          message: 'Invalid input: expected string, received undefined',
        },
        {
          expected: 'string',
          code: 'invalid_type',
          path: ['data', '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04', 'encodedValue'],
          message: 'Invalid input: expected string, received undefined',
        },
      ]),
    });
  });

  it('rejects signed data with a non-decimal timestamp', async () => {
    jest.spyOn(logger, 'warn');

    for (const timestamp of ['-0x0', '1e9']) {
      jest.spyOn(commonsModule, 'executeRequest').mockResolvedValue({
        success: true,
        errorData: undefined,
        statusCode: 200,
        data: {
          count: 1,
          data: {
            '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04': {
              signature:
                '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
              timestamp,
              templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
              encodedValue: '0x000000000000000000000000000000000000000000000065954b143faff77440',
              airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
            },
          },
        },
      });

      await expect(dataFetcherLoopModule.callSignedApi('some-url', 10_000)).resolves.toBeNull();

      expect(logger.warn).toHaveBeenLastCalledWith('Failed to parse Signed API response.', {
        url: 'some-url',
        errors: expect.stringContaining('Must be a non-negative integer timestamp'),
      });
    }

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
