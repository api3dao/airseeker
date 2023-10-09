import { clearInterval } from 'timers';
import { go } from '@api3/promise-utils';
import axios from 'axios';
import { groupBy } from 'lodash';
import { ethers } from 'ethers';
import { Config } from '../config/schema';
import { logger } from '../logger';
import { DataStore, signedApiResponseSchema, SignedData } from '../types';
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

type AirnodesAndSignedDataUrl = { urls: string[]; airnodeAddress: string; templateId: string };

const HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT = 10_000;
const HTTP_SIGNED_DATA_API_HEADROOM = 1_000;

let mainInterval: NodeJS.Timeout | undefined;
let configRefresherInterval: NodeJS.Timeout | undefined;
let dataFetcherInterval: NodeJS.Timeout | undefined;
let config: Config | undefined;

export const verifySignedData = (_signedData: SignedData) => {
  // TODO https://github.com/api3dao/airseeker-v2/issues/23
  // https://github.com/api3dao/airnode-protocol-v1/blob/5bf01edcd0fe76b94d3d6d6720b71ec658216436/contracts/api3-server-v1/BeaconUpdatesWithSignedData.sol#L26
  return true;
};

// Useful for tests
let axiosProd = axios;
export const setAxios = (customAxios: any) => {
  axiosProd = customAxios;
};

/**
 * A function factory that outputs functions that call a remote signed data API.
 *
 * @param urls
 * @param airnodeAddress
 * @param whoAmI an identifier for this function so we can match up log entries
 * @param dataStore the data store this function should call to store data
 */
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
        axiosProd({
          method: 'get',
          timeout: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT - HTTP_SIGNED_DATA_API_HEADROOM / 2,
          //url: `${url}/${airnodeAddress}`,
          url: `${url}/0xC04575A2773Da9Cd23853A69694e02111b2c4182`, // TODO override here so we can better simulate many apis
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
 * @param config
 * @param dataStore
 */
export const buildApiCalls = (config: Config, dataStore: DataStore): PendingCall[] => {
  const airnodeUrlSets = groupBy(
    Object.values(config.chains).flatMap((chainConfig) =>
      Object.entries(chainConfig.__Temporary__DapiDataRegistry.airnodeToSignedApiUrl).map(([airnodeAddress, url]) => ({
        airnodeAddress,
        url,
      }))
    ),
    (item) => item.airnodeAddress
  );

  return Object.entries(airnodeUrlSets).map(([airnodeAddress, url], whoAmI) => ({
    fn: makeApiCallFn({ urls: url.map((url) => url.url), airnodeAddress, whoAmI, dataStore }),
    nextRun: 0,
    lastRun: 0,
    running: false,
    whoAmI,
  }));
};

/**
 * Shuts down the intervals
 */
export const stopDataFetcher = () => {
  clearInterval(mainInterval);
  clearInterval(dataFetcherInterval);
  clearInterval(configRefresherInterval);
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

const dataFetcherInitialiser = async () => {
  const newConfig = await getConfig();

  // TODO of course the config hasn't changed... so let's change it to simulate the real scenario
  // @ts-ignore
  newConfig.chains['31337'].__Temporary__DapiDataRegistry.dataFeedIdToBeacons[
    ethers.BigNumber.from(ethers.utils.randomBytes(64)).toHexString()
  ].push({
    templateId: '0x96504241fb9ae9a5941f97c9561dcfcd7cee77ee9486a58c8e78551c1268ddec',
    airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c418A',
  });

  if (newConfig === config) {
    return;
  }

  // The config has changed, so replace old with new
  config = newConfig;

  // Clear the existing data fetcher interval
  clearInterval(dataFetcherInterval);

  // rebuild the API calls
  const callFunctionSets = buildApiCalls(config, localDataStore);

  // Set up the intervals
  const fetchIntervalInMs = config.fetchInterval * 1_000;
  const stepDuration = (fetchIntervalInMs * 0.9) / callFunctionSets.length;

  // and start the timed loop
  dataFetcherInterval = setInterval(callsDispatcherFn, 100, callFunctionSets, stepDuration);

  // Don't reconfigure the refresher if it's already configured
  if (configRefresherInterval) {
    return;
  }

  // Run the config refresher on an interval
  configRefresherInterval = setInterval(() => go(() => dataFetcherInitialiser(), { retries: 0 }), 180_000);
};

const callsDispatcherFn = (callFunctionSets: PendingCall[], stepDuration: number) => {
  const now = Date.now();

  // we honour nextRun unless lastRun is outdated, in which case we run any way to deal with a scenario where nextRun
  // wasn't updated for an unknown reason. This may be paranoid.
  callFunctionSets?.forEach((pendingCall) => {
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

// Everything from this point won't be needed in production.

/**
 * A stub to retrieve the latest config
 */
const getConfig = async () => {
  return generateTestConfig();
};

// This is not a secret
// https://pool.nodary.io/0xC04575A2773Da9Cd23853A69694e02111b2c4182
export const generateTestConfig = (): Config => {
  const airnodeToSignedApiUrl = {
    '0xC04575A2773Da9Cd23853A69694e02111b2c4182': 'https://pool.nodary.io',
    '0xC04575A2773Da9Cd23853A69694e02111b2c4183': 'https://pool.nodary.io',
    '0xC04575A2773Da9Cd23853A69694e02111b2c4184': 'https://pool.nodary.io',
    '0xC04575A2773Da9Cd23853A69694e02111b2c4185': 'https://pool.nodary.io',
    '0xC04575A2773Da9Cd23853A69694e02111b2c4186': 'https://pool.nodary.io',
    '0xC04575A2773Da9Cd23853A69694e02111b2c4187': 'https://pool.nodary.io',
    '0xC04575A2773Da9Cd23853A69694e02111b2c4188': 'https://pool.nodary.io',
    '0xC04575A2773Da9Cd23853A69694e02111b2c4189': 'https://pool.nodary.io',
    '0xC04575A2773Da9Cd23853A69694e02111b2c418A': 'https://pool.nodary.io',
  };

  const dataFeedIdToBeacons = Object.fromEntries(
    Object.keys(airnodeToSignedApiUrl)
      .map((airnode) => {
        return Object.entries({
          [ethers.BigNumber.from(ethers.utils.randomBytes(64)).toHexString()]: [
            {
              templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
              airnode,
            },
          ],
          [ethers.BigNumber.from(ethers.utils.randomBytes(64)).toHexString()]: [
            {
              templateId: '0x55d08a477d28519c8bc889b0be4f4d08625cfec5369f047258a1a4d7e1e405f3',
              airnode,
            },
          ],
          [ethers.BigNumber.from(ethers.utils.randomBytes(64)).toHexString()]: [
            {
              templateId: '0x96504241fb9ae9a5941f97c9561dcfcd7cee77ee9486a58c8e78551c1268ddec',
              airnode,
            },
          ],
        });
      })
      .flat(1)
  );

  return {
    sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
    chains: {
      '31337': {
        contracts: {
          Api3ServerV1: '',
        },
        providers: { hardhat: { url: 'http://127.0.0.1:8545' } },
        __Temporary__DapiDataRegistry: {
          airnodeToSignedApiUrl,
          dataFeedIdToBeacons,
          activeDapiNames: [],
        },
      },
    },
    fetchInterval: 20,
  };
};

if (require.main === module) {
  dataFetcherInitialiser().catch((error) => {
    // eslint-disable-next-line no-console
    console.trace(error);
    process.exit(1);
  });
}
