import { clearInterval } from 'timers';
import { go } from '@api3/promise-utils';
import axios from 'axios';
import { uniq } from 'lodash';
import { ethers } from 'ethers';
import { Config } from '../config/schema';
import { logger } from '../logger';
import { signedApiResponseSchema } from '../types';
import { localDataStore } from '../signed-data-store';

// Express handler/endpoint path: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/server.ts#L33
// Actual handler fn: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L81

const HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT = 10_000;
const HTTP_SIGNED_DATA_API_HEADROOM = 1_000;

let dataFetcherInterval: NodeJS.Timeout | undefined;

// Useful for tests
let axiosProd = axios;
export const setAxios = (customAxios: any) => {
  axiosProd = customAxios;
};

/**
 * Shuts down the intervals
 */
export const stopDataFetcher = () => {
  clearInterval(dataFetcherInterval);
};

const callSignedDataApi = async (url: string, whoAmI = 'unset') => {
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

  payload.forEach(localDataStore.setStoreDataPoint);
};

export const runDataFetcher = async () => {
  const config = await getConfig();

  const fetchInterval = config.fetchInterval * 1_000;

  if (!dataFetcherInterval) {
    dataFetcherInterval = setInterval(runDataFetcher, fetchInterval);
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
      go(() => callSignedDataApi(url, idx.toString()), {
        retries: 0,
        totalTimeoutMs: fetchInterval + HTTP_SIGNED_DATA_API_HEADROOM,
        attemptTimeoutMs: fetchInterval + HTTP_SIGNED_DATA_API_HEADROOM - 100,
      })
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
  };
};

if (require.main === module) {
  runDataFetcher().catch((error) => {
    // eslint-disable-next-line no-console
    console.trace(error);
    process.exit(1);
  });
}
