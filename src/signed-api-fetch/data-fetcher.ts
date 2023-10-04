import { go } from '@api3/promise-utils';
import axios from 'axios';
import { z } from 'zod';
import { groupBy } from 'lodash';
import { Config, EvmAddress, EvmId } from '../config/schema';

// Express handler/endpoint path: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/server.ts#L33
// Actual handler fn: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L81

// Taken from https://github.com/api3dao/signed-api/blob/main/packages/api/src/schema.ts
// TODO should be imported

export const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM address');

export const evmIdSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Must be a valid EVM hash');

export const signedDataSchema = z.object({
  airnode: evmAddressSchema,
  templateId: evmIdSchema,
  // beaconId: evmIdSchema, // it is removed prior to tx to us | https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L94
  timestamp: z.string(),
  encodedValue: z.string(),
  signature: z.string(),
});

export type SignedData = z.infer<typeof signedDataSchema>;

const signedApiResponseSchema = z.object({
  count: z.number().positive(),
  data: signedDataSchema.array(),
});

export type LocalSignedData = Pick<SignedData, 'timestamp' | 'encodedValue' | 'signature'>;

type PendingCall = {
  fn: () => Promise<void>;
  nextRun: Number;
};

type AirnodeAddress = EvmAddress;
type TemplateId = EvmId;

const HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT = 10_000;
const HTTP_SIGNED_DATA_API_HEADROOM = 1_000;

const signedApiStore: Record<AirnodeAddress, Record<TemplateId, LocalSignedData>> = {};

export const verifySignedData = (_signedData: SignedData) => {
  return true;
  // https://github.com/api3dao/airnode-protocol-v1/blob/5bf01edcd0fe76b94d3d6d6720b71ec658216436/contracts/api3-server-v1/BeaconUpdatesWithSignedData.sol#L26
};

export const setStoreDataPoint = ({ airnode, templateId, signature, timestamp, encodedValue }: SignedData) => {
  // we should check the signature at this point... especially if it belongs to the airnode we expect
  // TODO check signature and possibly log failure
  if (!verifySignedData({ airnode, templateId, signature, timestamp, encodedValue })) {
    // TODO log error message
    return;
  }

  if (!signedApiStore[airnode]) {
    signedApiStore[airnode] = {};
  }

  signedApiStore[airnode]![templateId] = { signature, timestamp, encodedValue };
};

export const getStoreDataPoint = (airnode: AirnodeAddress, templateId: TemplateId) => {
  if (!signedApiStore[airnode]) {
    return undefined;
  }

  return signedApiStore[airnode]![templateId];
};

type AirnodesAndSignedDataUrls = { urls: string[]; airnodeAddress: string; templateId: string }[];

/**
 * Builds API call functions for dispatch
 *
 * @param airnodesAndSignedDataUrls
 */
export const buildApiCalls = (airnodesAndSignedDataUrls: AirnodesAndSignedDataUrls): PendingCall[] =>
  airnodesAndSignedDataUrls.map(({ urls, airnodeAddress }) => ({
    fn: async () => {
      const url = urls[Math.round(Math.random() * urls.length - 1)];

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
        // TODO log a go parent failure
        return;
      }

      if (result.data.status !== 200) {
        // TODO log an underlying http failure
        return;
      }

      const zodResult = signedApiResponseSchema.safeParse(result.data.data);
      if (!zodResult.success) {
        // TODO log a Zod failure
        return;
      }

      const payload = zodResult.data.data;

      payload.forEach(setStoreDataPoint);
    },
    nextRun: 0,
  }));

export const expandConfigForFetcher = (config: Config) => {
  const allAirnodeUrlsByAirnode = groupBy(
    Object.values(config.chains).flatMap((chainConfig) =>
      Object.entries(chainConfig.__Temporary__DapiDataRegistry.airnodeToSignedApiUrl).map(([airnodeAddress, url]) => ({
        airnodeAddress,
        url,
      }))
    ),
    (item) => item.airnodeAddress
  );

  const allAirnodesAndTemplates = groupBy(
    Object.values(config.chains).flatMap((chainConfig) =>
      Object.values(chainConfig.__Temporary__DapiDataRegistry.dataFeedIdToBeacons).flat()
    ),
    (item) => item.airnode
  );

  const airnodeUrlSets = Object.entries(allAirnodeUrlsByAirnode).flatMap(([airnodeAddress, urls]) => {
    const airnodeAndTemplate = allAirnodesAndTemplates[airnodeAddress] ?? [];

    return airnodeAndTemplate.flatMap(({ templateId }) => ({
      airnodeAddress,
      urls: urls.map((url) => url.url),
      templateId, // probably initially unnecessary but I suspect useful later
    }));
  });

  return airnodeUrlSets;
};

export const dataFetcherCoordinator = async (config: Config) => {
  const airnodeUrlSets = expandConfigForFetcher(config);

  const _callFunctions = buildApiCalls(airnodeUrlSets);

  // we initialise the nextRuns in the calls
  // and then head into the first loop
};
