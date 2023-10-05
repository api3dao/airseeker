import { go } from '@api3/promise-utils';
import axios from 'axios';
import { z } from 'zod';
import { groupBy } from 'lodash';
import { BigNumber } from 'ethers';
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
  data: z.record(signedDataSchema),
});

export type LocalSignedData = Pick<SignedData, 'timestamp' | 'encodedValue' | 'signature'>;

type PendingCall = {
  fn: (deferredFunction: () => void) => Promise<void>;
  nextRun: number;
  lastRun: number;
  running: boolean;
  whoAmI: number;
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
  // eslint-disable-next-line no-console
  console.log(
    `Storing sample for (Airnode ${airnode}) (Template ID ${templateId}) (Timestamp ${new Date(
      parseInt(timestamp) * 1_000
    ).toLocaleDateString()}), ${BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8}`
  );
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
  airnodesAndSignedDataUrls.map(({ urls, airnodeAddress }, whoAmI) => ({
    fn: async (deferredFunction: () => void) => {
      // eslint-disable-next-line no-console
      console.log(`Started API call ${whoAmI}`);

      const url = urls[Math.ceil(Math.random() * urls.length) - 1];
      // eslint-disable-next-line no-console
      console.log(`Calling (${whoAmI}): ${url}/${airnodeAddress}`);

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
        // eslint-disable-next-line no-console
        console.log(`Call failed for ${whoAmI}: ${result.error}`);
        return;
      }

      if (result.data.status !== 200) {
        // TODO log an underlying http failure
        // eslint-disable-next-line no-console
        console.log(`HTTP call failed for ${whoAmI} with code ${result.data.status}: ${result.data.statusText}`);
        return;
      }

      const zodResult = signedApiResponseSchema.safeParse(result.data.data);
      if (!zodResult.success) {
        // TODO log a Zod failure
        // eslint-disable-next-line no-console
        console.log(`Schema parse failed for ${whoAmI} with error(s) ${JSON.stringify(zodResult.error, null, 2)}`);
        return;
      }

      const payload = Object.values(zodResult.data.data);

      // eslint-disable-next-line no-console
      console.log(`Result passed all checks, sending to the store ${whoAmI}`);
      payload.forEach(setStoreDataPoint);

      deferredFunction();
    },
    nextRun: 0,
    lastRun: 0,
    running: false,
    whoAmI,
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
  const airnodeUrlSets = expandConfigForFetcher(config);

  const callFunctionSets = buildApiCalls(airnodeUrlSets);

  const fetchIntervalInMs = config.fetchInterval * 1_000;
  const stepDuration = (fetchIntervalInMs * 0.9) / callFunctionSets.length;

  setInterval(() => {
    // eslint-disable-next-line no-console
    console.log('Interval started');
    const now = Date.now();

    // we honour nextRun unless lastRun is outdated, in which case we run any way to deal with a scenario where nextRun wasn't updated for an unknown reason
    callFunctionSets.forEach((pendingCall) => {
      if (
        (pendingCall.nextRun < now && !pendingCall.running) ||
        now - pendingCall.lastRun > HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT + HTTP_SIGNED_DATA_API_HEADROOM
      ) {
        pendingCall.running = true;
        pendingCall.lastRun = Date.now();
        pendingCall.fn(() => {
          pendingCall.running = false;
          pendingCall.nextRun = Date.now() + stepDuration;
        });
      }
    });
    // eslint-disable-next-line no-console
    console.log('interval ended');
  }, fetchIntervalInMs);
  // eslint-disable-next-line no-console
  console.log('Configured data fetcher / set up interval');
};

const main = async () => {
  // This is not a secret
  // https://pool.nodary.io/0xC04575A2773Da9Cd23853A69694e02111b2c4182

  const config: Config = {
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
    fetchInterval: 10,
  };

  dataFetcherCoordinator(config);
};

main();
