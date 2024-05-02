import { executeRequest } from '@api3/commons';
import { uniq } from 'lodash';

import { logger } from '../logger';
import { getState } from '../state';
import { signedApiResponseSchema, type SignedData } from '../types';
import { sleep } from '../utils';

import { purgeOldSignedData, saveSignedData } from './signed-data-state';

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
  const executionResult = await executeRequest({
    method: 'get',
    timeout,
    url,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!executionResult.success) {
    logger.warn('Failed to fetch data from signed API.', {
      url,
      ...executionResult.errorData,
      statusCode: executionResult.statusCode,
    });
    return null;
  }

  const parseResult = signedApiResponseSchema.safeParse(executionResult.data);
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

        const now = Date.now();
        // NOTE: We allow each Signed API call to take full signedDataFetchIntervalMs. Because these calls are
        // staggered, it means that there can be pending requests from different data fetcher loops happening at the
        // same time. This does not matter much, because we only save the freshest signed data.
        const signedDataBatch = await callSignedApi(url, signedDataFetchIntervalMs);
        if (!signedDataBatch) return;
        logger.info('Fetched signed data from Signed API.', { url, duration: Date.now() - now });

        await saveSignedData(signedDataBatch);
        logger.info('Saved all signed data from Signed API using a worker.', { url, duration: Date.now() - now });
      })
    );

    // Remove old signed data to keep the state clean.
    purgeOldSignedData();

    return fetchResults;
  });
};
