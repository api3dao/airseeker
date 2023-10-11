import { clearInterval } from 'timers';
import { go } from '@api3/promise-utils';
import axios from 'axios';
import { uniq } from 'lodash';
import { ethers } from 'ethers';
import { Config } from '../config/schema';
import { signedApiResponseSchema, SignedData } from '../types';
import { localDataStore } from '../signed-data-store';
import { getState, setState } from '../state';
import { logErrors } from '../logger';
import { HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT, HTTP_SIGNED_DATA_API_HEADROOM } from '../constants';

// Express handler/endpoint path: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/server.ts#L33
// Actual handler fn: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L81

// Useful for tests
let axiosProd = axios;
export const setAxios = (customAxios: any) => {
  axiosProd = customAxios;
};

/**
 * Shuts down intervals
 */
export const stopDataFetcher = () => {
  clearInterval(getState().dataFetcherInterval);
};

/**
 * Calls a remote signed data URL and inserts the result into the datastore
 * @param url
 * @param whoAmI
 */
const callSignedDataApi = async (url: string, whoAmI = 'unset'): Promise<SignedData[]> => {
  const result = await go(
    () =>
      axiosProd({
        method: 'get',
        timeout: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT - HTTP_SIGNED_DATA_API_HEADROOM / 2,
        url: `https://pool.nodary.io/0xC04575A2773Da9Cd23853A69694e02111b2c4182`, // TODO ignore url for testing
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
    throw new Error(`[${whoAmI}] HTTP call failed: ${result.error}`);
  }

  if (result.data.status !== 200) {
    throw new Error(`[${whoAmI}] HTTP call failed with code ${result.data.status}: ${result.data.statusText}`);
  }

  const zodResult = signedApiResponseSchema.safeParse(result.data.data);
  if (!zodResult.success) {
    throw new Error(`[${whoAmI}] Schema parse failed with error(s) ${JSON.stringify(zodResult.error, null, 2)}`);
  }

  const payload = Object.values(zodResult.data.data);

  if (!payload) {
    throw new Error('Empty payload.');
  }

  return payload;
};

export const runDataFetcher = async () => {
  const state = getState();
  const { config } = state!;

  const fetchInterval = config.fetchInterval * 1_000;

  if (!state?.dataFetcherInterval) {
    const dataFetcherInterval = setInterval(runDataFetcher, fetchInterval);
    setState({ ...state, dataFetcherInterval });
  }

  const urls = uniq(
    Object.values(config.chains).flatMap((chain) =>
      Object.entries(chain.__Temporary__DapiDataRegistry.airnodeToSignedApiUrl).flatMap(
        ([airnodeAddress, baseUrl]) => `${baseUrl}/${airnodeAddress}`
      )
    )
  );

  return Promise.allSettled(
    urls.map((url, idx) =>
      go(
        async () => {
          const payload = await callSignedDataApi(url, idx.toString());

          logErrors(await Promise.allSettled(payload.map(localDataStore.setStoreDataPoint)));
        },
        {
          retries: 0,
          totalTimeoutMs: fetchInterval + HTTP_SIGNED_DATA_API_HEADROOM,
          attemptTimeoutMs: fetchInterval + HTTP_SIGNED_DATA_API_HEADROOM - 100,
        }
      )
    )
  );
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
    fetchInterval: 10,
    deviationThresholdCoefficient: 1,
  };
};

// this should probably be moved to test fixtures
export const init = async () => {
  const config = await getConfig();
  setState({
    config,
  });
};

if (require.main === module) {
  init().then(() =>
    runDataFetcher().catch((error) => {
      // eslint-disable-next-line no-console
      console.trace(error);
      process.exit(1);
    })
  );
}
