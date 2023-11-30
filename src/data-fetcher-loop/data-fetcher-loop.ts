import { go } from '@api3/promise-utils';
import axios, { type AxiosResponse, type AxiosError } from 'axios';
import { pick, uniq } from 'lodash';

import { HTTP_SIGNED_DATA_API_TIMEOUT_MULTIPLIER } from '../constants';
import { logger } from '../logger';
import { getState } from '../state';
import { signedApiResponseSchema, type SignedData } from '../types';

import { purgeOldSignedData, saveSignedData } from './signed-data-state';

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

export const startDataFetcherLoop = () => {
  const state = getState();
  const {
    config: { signedDataFetchInterval },
  } = state;

  // Run the data fetcher loop manually for the first time, because setInterval first waits for the given period of
  // time before calling the callback function.
  void runDataFetcher();
  setInterval(runDataFetcher, signedDataFetchInterval * 1000);
};

/**
 * Calls a remote signed data URL.
 * - Express handler/endpoint path:
 *    https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/server.ts#L33
 * - Actual handler fn:
 *   https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L81
 */
export const callSignedApi = async (url: string, timeout: number): Promise<SignedData[] | null> => {
  const goAxiosCall = await go<Promise<AxiosResponse>, AxiosError>(async () =>
    axios({
      method: 'get',
      timeout,
      url,
      headers: {
        Accept: 'application/json',
      },
    })
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
      signedApiUrls: signedApiUrlState,
    } = state;

    const signedDataFetchIntervalMs = signedDataFetchInterval * 1000;

    const urls = uniq([
      ...Object.values(signedApiUrlState)
        .flatMap((urlsPerProvider) => Object.values(urlsPerProvider))
        .flatMap((urlsPerAirnode) => Object.values(urlsPerAirnode))
        .flat(),
      ...signedApiUrls,
    ]);

    logger.debug('Fetching data from signed APIs', { urls });
    const fetchResults = await Promise.all(
      urls.map(async (url) =>
        go(
          async () => {
            const signedDataApiResponse = await callSignedApi(
              url,
              Math.ceil(signedDataFetchIntervalMs * HTTP_SIGNED_DATA_API_TIMEOUT_MULTIPLIER)
            );
            if (!signedDataApiResponse) return;

            for (const signedData of signedDataApiResponse) {
              saveSignedData(signedData);
            }
          },
          { totalTimeoutMs: signedDataFetchIntervalMs }
        )
      )
    );

    purgeOldSignedData();

    return fetchResults;
  });
};
