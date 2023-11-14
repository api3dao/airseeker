import { clearInterval } from 'node:timers';

import { go } from '@api3/promise-utils';
import axios, { type AxiosResponse, type AxiosError } from 'axios';
import { pick, uniq } from 'lodash';

import { HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT, HTTP_SIGNED_DATA_API_HEADROOM } from '../constants';
import { logger } from '../logger';
import * as localDataStore from '../signed-data-store';
import { getState, updateState } from '../state';
import { signedApiResponseSchema, type SignedData } from '../types';

// Express handler/endpoint path: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/server.ts#L33
// Actual handler fn: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L81

// Inspired by: https://axios-http.com/docs/handling_errors.
//
// The implementation differs by only picking fields that are important for debugging purposes to avoid cluttering the
// logs.
const parseAxiosError = (error: AxiosError) => {
  const errorContext = pick(error, ['cause', 'code', 'name', 'message', 'stack', 'status']);

  // The request was made and the server responded with a status code that falls out of the range of 2xx.
  if (error.response) {
    return { ...errorContext, response: pick(error.response, ['data', 'status', 'headers']) };
  }

  return errorContext;
};

/**
 * Shuts down intervals
 */
export const stopDataFetcher = () => {
  clearInterval(getState().dataFetcherInterval);
};

/**
 * Calls a remote signed data URL.
 * @param url
 */
export const callSignedDataApi = async (url: string): Promise<SignedData[] | null> => {
  const goAxiosCall = await go<Promise<AxiosResponse>, AxiosError>(
    async () =>
      axios({
        method: 'get',
        timeout: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT - HTTP_SIGNED_DATA_API_HEADROOM / 2,
        url,
        headers: {
          Accept: 'application/json',
        },
      }),
    {
      attemptTimeoutMs: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT,
      totalTimeoutMs: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT + HTTP_SIGNED_DATA_API_HEADROOM / 2,
      retries: 0,
    }
  );

  if (!goAxiosCall.success) {
    logger.warn('Failed to fetch data from signed API', parseAxiosError(goAxiosCall.error));
    return null;
  }

  const { data } = signedApiResponseSchema.parse(goAxiosCall.data?.data);

  return Object.values(data);
};

export const runDataFetcher = async () => {
  return logger.runWithContext({ dataFetcherCoordinatorId: Date.now().toString() }, async () => {
    logger.debug('Running data fetcher');
    const state = getState();
    const {
      config: { signedDataFetchInterval, signedApiUrls },
      signedApiUrlStore,
      dataFetcherInterval,
    } = state;

    const signedDataFetchIntervalMs = signedDataFetchInterval * 1000;

    if (!dataFetcherInterval) {
      const dataFetcherInterval = setInterval(runDataFetcher, signedDataFetchIntervalMs);
      updateState((draft) => {
        draft.dataFetcherInterval = dataFetcherInterval;
      });
    }

    const urls = uniq([
      ...Object.values(signedApiUrlStore)
        .flatMap((urlsPerProvider) => Object.values(urlsPerProvider))
        .flatMap((urlsPerAirnode) => Object.values(urlsPerAirnode))
        .flat(),
      ...signedApiUrls,
    ]);

    logger.debug('Fetching data from signed APIs', { urls });
    return Promise.all(
      urls.map(async (url) =>
        go(
          async () => {
            const signedDataApiResponse = await callSignedDataApi(url);
            if (!signedDataApiResponse) return;

            for (const signedData of signedDataApiResponse) {
              localDataStore.setStoreDataPoint(signedData);
            }
          },
          {
            retries: 0,
            totalTimeoutMs: signedDataFetchIntervalMs + HTTP_SIGNED_DATA_API_HEADROOM,
            attemptTimeoutMs: signedDataFetchIntervalMs + HTTP_SIGNED_DATA_API_HEADROOM - 100,
          }
        )
      )
    );
  });
};
