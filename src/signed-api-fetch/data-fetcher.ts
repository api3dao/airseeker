import { go } from '@api3/promise-utils';
import axios from 'axios';
import { groupBy } from 'lodash';
import { Config } from '../config/schema';
import { logger } from '../logger';
import { AirnodeAddress, DataStore, signedApiResponseSchema, SignedData } from '../types';
import { localDataStore } from '../signed-data-store';

// Express handler/endpoint path: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/server.ts#L33
// Actual handler fn: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L81

type PendingCall = {
  fn: (deferredFunction: () => void) => Promise<void>;
  nextRun: number;
  lastRun: number;
  running: boolean;
  whoAmI: number;
};

const HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT = 10_000;
const HTTP_SIGNED_DATA_API_HEADROOM = 1_000;

export const verifySignedData = (_signedData: SignedData) => {
  // TODO https://github.com/api3dao/airseeker-v2/issues/23
  // https://github.com/api3dao/airnode-protocol-v1/blob/5bf01edcd0fe76b94d3d6d6720b71ec658216436/contracts/api3-server-v1/BeaconUpdatesWithSignedData.sol#L26
  return true;
};

type AirnodesAndSignedDataUrl = { urls: string[]; airnodeAddress: string; templateId: string };

const makeApiCallFn =
  ({
    urls,
    airnodeAddress,
    whoAmI,
    dataStore,
  }: Pick<AirnodesAndSignedDataUrl, 'urls' | 'airnodeAddress'> & {
    whoAmI: number;
    dataStore: DataStore;
  }) =>
  async (deferredFunction: () => void) => {
    logger.debug(`[${whoAmI}] Started API call function`);

    const url = urls[Math.ceil(Math.random() * urls.length) - 1];
    logger.debug(`[${whoAmI}] Calling ${url}/${airnodeAddress}`);

    const result = await go(
      () =>
        axios({
          method: 'get',
          timeout: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT - HTTP_SIGNED_DATA_API_HEADROOM / 2,
          url: `${url}/${airnodeAddress}`,
          headers: {
            Accept: 'application/json',
            // TODO add API key?
          },
        }),
      {
        attemptTimeoutMs: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT,
        totalTimeoutMs: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT + HTTP_SIGNED_DATA_API_HEADROOM / 2,
        retries: 0,
      }
    );

    if (!result.success) {
      logger.debug(`[${whoAmI}] HTTP call failed: ${result.error}`);
      return;
    }

    if (result.data.status !== 200) {
      logger.debug(`[${whoAmI}] HTTP call failed with code ${result.data.status}: ${result.data.statusText}`);
      return;
    }

    const zodResult = signedApiResponseSchema.safeParse(result.data.data);
    if (!zodResult.success) {
      logger.debug(`[${whoAmI}] Schema parse failed with error(s) ${JSON.stringify(zodResult.error, null, 2)}`);
      return;
    }

    const payload = Object.values(zodResult.data.data);

    logger.debug(`[${whoAmI}] Result passed all checks, sending to the store`);
    payload.forEach(dataStore.setStoreDataPoint);

    deferredFunction();
  };

/**
 * Builds API call functions for dispatch
 *
 * @param airnodesAndSignedDataUrls
 */
export const buildApiCalls = (
  airnodesAndSignedDataUrls: Record<AirnodeAddress, { url: string }[]>,
  dataStore: DataStore
): PendingCall[] =>
  Object.entries(airnodesAndSignedDataUrls).map(([airnodeAddress, url], whoAmI) => ({
    fn: makeApiCallFn({ urls: url.map((url) => url.url), airnodeAddress, whoAmI, dataStore }),
    nextRun: 0,
    lastRun: 0,
    running: false,
    whoAmI,
  }));

let mainInterval: NodeJS.Timeout | undefined;

export const stopDataFetcher = () => {
  clearInterval(mainInterval);
};

/*
------------------------------------------------------------------------------------------------------------
|                                        Fetch Interval (eg. 10s)                                          |
------------------------------------------------------------------------------------------------------------
| Call #1 2s         | ------------------- timeout -------------------------------->|
                       Call #2 2s         | ------------------- timeout ---------------------------------->|
-------------------->|                      Call #3 2s         | ------------------- timeout ---------------
----------------------------------------->|                      Call #4 2s         | ----------------------
------------ timeout ----------------------------------------->|                      Call #5 2s           |
-------------------------- timeout ----------------------------------------------------------------------->|
There can be up to [timeout 8s]-[step duration (10s / 5 calls = 2s)] overlap (here it'd be 6 seconds possible overlap,
which extends into the next loop).
 */

export const dataFetcherCoordinator = (config: Config) => {
  const airnodeUrlSets = groupBy(
    Object.values(config.chains).flatMap((chainConfig) =>
      Object.entries(chainConfig.__Temporary__DapiDataRegistry.airnodeToSignedApiUrl).map(([airnodeAddress, url]) => ({
        airnodeAddress,
        url,
      }))
    ),
    (item) => item.airnodeAddress
  );

  const callFunctionSets = buildApiCalls(airnodeUrlSets, localDataStore);

  const fetchIntervalInMs = config.fetchInterval * 1_000;
  const stepDuration = (fetchIntervalInMs * 0.9) / callFunctionSets.length;

  const callsDispatcherFn = () => {
    const now = Date.now();

    // we honour nextRun unless lastRun is outdated, in which case we run any way to deal with a scenario where nextRun
    // wasn't updated for an unknown reason. This may be paranoid.
    callFunctionSets.forEach((pendingCall) => {
      if (
        (pendingCall.nextRun < now && !pendingCall.running) ||
        now - pendingCall.lastRun > (HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT + HTTP_SIGNED_DATA_API_HEADROOM) * 10
      ) {
        logger.debug(`Ran call ${pendingCall.whoAmI}: `, {
          nextRun: pendingCall.nextRun < now && !pendingCall.running,
          failsafe:
            now - pendingCall.lastRun > (HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT + HTTP_SIGNED_DATA_API_HEADROOM) * 10,
        });

        pendingCall.running = true;
        pendingCall.lastRun = Date.now();
        pendingCall.fn(() => {
          pendingCall.running = false;
          pendingCall.nextRun = Date.now() + stepDuration * (pendingCall.whoAmI + 1);
          logger.debug(`Next run is now + ${stepDuration * (pendingCall.whoAmI + 1)}`);
        });
      }
    });
  };

  setInterval(callsDispatcherFn, 100);
  callsDispatcherFn();

  logger.debug('Configured data fetcher / setInterval was configured');
};

const main = async (config: Config) => {
  dataFetcherCoordinator(config);
};

// This is not a secret
// https://pool.nodary.io/0xC04575A2773Da9Cd23853A69694e02111b2c4182
const generateTestConfig = (): Config => ({
  sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
  chains: {
    '31337': {
      contracts: {
        Api3ServerV1: '',
      },
      providers: { hardhat: { url: 'http://127.0.0.1:8545' } },
      __Temporary__DapiDataRegistry: {
        airnodeToSignedApiUrl: {
          '0xC04575A2773Da9Cd23853A69694e02111b2c4182': 'https://pool.nodary.io',
        },
        dataFeedIdToBeacons: {
          '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04': [
            {
              templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
              airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
            },
          ],
          '0xddc6ca9cc6f5768d9bfa8cc59f79bde8cf97a6521d0b95835255951ce06f19e6': [
            {
              templateId: '0x55d08a477d28519c8bc889b0be4f4d08625cfec5369f047258a1a4d7e1e405f3',
              airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
            },
          ],
          '0x5dd8d9e1429f69ba4bd76df5709155110429857d19670cc157632f66a48ee1f7': [
            {
              templateId: '0x96504241fb9ae9a5941f97c9561dcfcd7cee77ee9486a58c8e78551c1268ddec',
              airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
            },
          ],
        },
        activeDapiNames: [],
      },
    },
  },
  fetchInterval: 20,
});

main(generateTestConfig());
