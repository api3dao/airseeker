import { go } from '@api3/promise-utils';
import axios, { type AxiosResponse, type AxiosError } from 'axios';
import { pick, uniq } from 'lodash';

import { logger } from '../logger';
import { getState } from '../state';
import { signedApiResponseSchema, type SignedData } from '../types';
import { sleep } from '../utils';

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
    logger.warn('Failed to fetch data from signed API.', { url, ...parseAxiosError(goAxiosCall.error) });
    return null;
  }

  const parseResult = signedApiResponseSchema.safeParse(goAxiosCall.data?.data);
  if (!parseResult.success) {
    logger.warn('Failed to parse signed API response.', { url });
    return null;
  }

  return Object.values(parseResult.data.data);
};

export const runDataFetcher = async () => {
  return logger.runWithContext({ dataFetcherCoordinatorId: Date.now().toString() }, async () => {
    const state = getState();
    const {
      config: { signedDataFetchInterval },
      signedApiUrls,
    } = state;
    const signedDataFetchIntervalMs = signedDataFetchInterval * 1000;

    // Better to log the non-decomposed object to see which URL comes from which chain-provider group.
    logger.debug('Signed API URLs.', { signedApiUrls });
    const urls = uniq(
      Object.values(signedApiUrls)
        .map((urlsPerProvider) => Object.values(urlsPerProvider))
        .flat(2)
    );

    const urlCount = urls.length;
    const staggerTimeMs = signedDataFetchIntervalMs / urlCount;
    logger.info('Fetching signed data', { urlCount, staggerTimeMs });
    const fetchResults = await Promise.all(
      urls.map(async (url, index) => {
        await sleep(staggerTimeMs * index);

        // NOTE: We allow each Signed API call to take full signedDataFetchIntervalMs. Because these calls are
        // staggered, it means that there can be pending requests from different data fetcher loops happening at the
        // same time. This does not matter much, because we only save the freshest signed data.
        const signedDataApiResponse = await callSignedApi(url, signedDataFetchIntervalMs);
        if (!signedDataApiResponse) return;

        for (const signedData of signedDataApiResponse) {
          saveSignedData(signedData);
        }
      })
    );

    // Remove old signed data to keep the state clean.
    purgeOldSignedData();

    return fetchResults;
  });
};
