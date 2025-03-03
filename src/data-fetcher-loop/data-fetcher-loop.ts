import { type Hex, executeRequest } from '@api3/commons';
import { minBy, meanBy, maxBy, uniq } from 'lodash';

import { logger } from '../logger';
import { getState } from '../state';
import { type SignedDataRecord, signedApiResponseSchema, type SignedDataRecordEntry } from '../types';
import { generateRandomId, sleep } from '../utils';

import { purgeOldSignedData, saveSignedData } from './signed-data-state';

interface SignedApiUrlStats {
  url: string;
  count: number;
  duration: number;
}

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
export const callSignedApi = async (url: string, timeout: number): Promise<SignedDataRecord | null> => {
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
    logger.warn('Failed to parse signed API response.', {
      url,
      errors: JSON.stringify(parseResult.error.errors).slice(0, 1000),
    });
    return null;
  }

  return parseResult.data.data;
};

export const runDataFetcher = async () => {
  return logger.runWithContext({ dataFetcherCoordinatorId: generateRandomId() }, async () => {
    const state = getState();
    const {
      config: { signedDataFetchInterval, useSignedApiUrlsFromContract },
      signedApiUrlsFromConfig,
      signedApiUrlsFromContract,
      activeDataFeedBeaconIds,
    } = state;
    const signedDataFetchIntervalMs = signedDataFetchInterval * 1000;

    // Compute all the unique active beacon IDs reported across all data providers. Only signed data for these beacons
    // will be saved by Airseeker.
    const activeBeaconIds = new Set(
      Object.values(activeDataFeedBeaconIds)
        .map((beaconIdsPerProvider) => Object.values(beaconIdsPerProvider))
        .flat(2) // eslint-disable-line unicorn/no-magic-array-flat-depth
    );

    // Compute the set of URLs coming from the config. These are trusted and don't need to be verified.
    const trustedUrls = new Set(
      Object.values(signedApiUrlsFromConfig)
        .map((urlsPerProvider) => Object.values(urlsPerProvider))
        .flat(2) // eslint-disable-line unicorn/no-magic-array-flat-depth
    );

    // Better to log the non-decomposed object to see which URL comes from which chain-provider group.
    logger.debug('Signed API URLs.', {
      signedApiUrlsFromConfig,
      signedApiUrlsFromContract,
      useSignedApiUrlsFromContract,
    });
    const urls = uniq(
      (useSignedApiUrlsFromContract
        ? [...Object.values(signedApiUrlsFromConfig), ...Object.values(signedApiUrlsFromContract)]
        : Object.values(signedApiUrlsFromConfig)
      )
        .map((urlsPerProvider) => Object.values(urlsPerProvider))
        .flat(2) // eslint-disable-line unicorn/no-magic-array-flat-depth
    );

    const urlCount = urls.length;
    const staggerTimeMs = signedDataFetchIntervalMs / urlCount;

    // Store durations and relevant URLs for statistics
    const fetchDurations: SignedApiUrlStats[] = [];
    const saveDurations: SignedApiUrlStats[] = [];

    const loopStartedAt = new Date().toISOString();
    logger.info('Started data fetcher loop.', { loopStartedAt, urlCount, staggerTimeMs });
    const fetchResults = await Promise.all(
      urls.map(async (url, index) => {
        await sleep(staggerTimeMs * index);

        // NOTE: We allow each Signed API call to take full signedDataFetchIntervalMs. Because these calls are
        // staggered, it means that there can be pending requests from different data fetcher loops happening at the
        // same time. This does not matter much, because we only save the freshest signed data.
        const fetchStart = Date.now();
        const signedDataBatch = await callSignedApi(url, signedDataFetchIntervalMs);
        if (!signedDataBatch) return;
        const fetchDuration = Date.now() - fetchStart;
        fetchDurations.push({ url, count: Object.keys(signedDataBatch).length, duration: fetchDuration });

        // Save only the signed data that is relevant to the active data feeds.
        const saveStart = Date.now();
        const signedDataForActiveBeacons = Object.entries(signedDataBatch).filter(([beaconId]) =>
          activeBeaconIds.has(beaconId as Hex)
        );
        const signedDataCount = await saveSignedData(
          signedDataForActiveBeacons as SignedDataRecordEntry[],
          trustedUrls.has(url)
        );
        const saveDuration = Date.now() - saveStart;
        saveDurations.push({ url, count: signedDataCount ?? 0, duration: saveDuration });
      })
    );

    // Log the statistics for the data fetcher loop.
    logger.info('Finished data fetcher loop.', {
      loopDuration: Date.now() - new Date(loopStartedAt).getTime(),
      averageFetchDuration: fetchDurations.length === 0 ? undefined : meanBy(fetchDurations, 'duration'),
      averageSaveDuration: saveDurations.length === 0 ? undefined : meanBy(saveDurations, 'duration'),
      fastestFetch: minBy(fetchDurations, 'duration'),
      slowestFetch: maxBy(fetchDurations, 'duration'),
      fastestSave: minBy(saveDurations, 'duration'),
      slowestSave: maxBy(saveDurations, 'duration'),
    });

    // Remove old signed data to keep the state clean.
    purgeOldSignedData();

    return fetchResults;
  });
};
