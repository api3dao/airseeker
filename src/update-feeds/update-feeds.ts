import { range, size } from 'lodash';
import { go, goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { getState } from '../state';
import { isFulfilled, sleep } from '../utils';
import { logger } from '../logger';
import type { LogContext } from '@api3/commons';
import type { Chain } from '../config/schema';

export const startUpdateFeedsLoops = () => {
  const state = getState();
  const {
    config: { chains },
  } = state;

  // Start update loops for each chain in parallel.
  // eslint-disable-next-line unicorn/no-array-for-each
  Object.entries(chains).forEach(async ([chainId, chain]) => {
    const { dataFeedUpdateInterval, providers } = chain;

    // Calculate the stagger time for each provider on the same chain to maximize transaction throughput and update
    // frequency.
    const staggerTime = (dataFeedUpdateInterval / size(providers)) * 1000;
    logger.debug(`Starting update loops for chain`, { chainId, staggerTime, providerNames: Object.keys(providers) });

    for (const providerName of Object.keys(providers)) {
      logger.debug(`Starting update feed loop`, { chainId, providerName });
      setInterval(async () => runUpdateFeed(providerName, chain, chainId), dataFeedUpdateInterval * 1000);

      await sleep(staggerTime);
    }
  });
};

export const runUpdateFeed = async (providerName: string, chain: Chain, chainId: string) => {
  const { dataFeedBatchSize, dataFeedUpdateInterval } = chain;
  const baseLogContext = { chainId, providerName };

  logger.debug(`Fetching first batch of dAPIs batches`, baseLogContext);
  const goFirstBatch = await go(async () => getActiveDapiBatch(chain));
  if (!goFirstBatch.success) {
    logger.error(`Failed to get active dAPIs batch`, goFirstBatch.error, baseLogContext);
    return;
  }

  // Fetch the rest of the batches in parallel in a staggered way.
  const batchesCount = goFirstBatch.data.totalCount / dataFeedBatchSize;
  // TODO: It's not a good idea to have this run periodically in a setInterval because the update feed loops will
  // overlap. And just this data fetching part will take up all of the interval time.
  const staggerTime = batchesCount <= 2 ? 0 : (dataFeedUpdateInterval / (batchesCount - 1)) * 1000;
  logger.debug('Fetching batches of active dAPIs', { batchesCount, staggerTime, ...baseLogContext });
  const otherBatches = await Promise.allSettled(
    range(1, batchesCount).map(async (batchIndex) => {
      await sleep(batchIndex * staggerTime);

      return getActiveDapiBatch(chain, batchIndex * dataFeedBatchSize);
    })
  );
  for (const batch of otherBatches.filter((batch) => !isFulfilled(batch))) {
    logger.error(`Failed to get active dAPIs batch`, (batch as PromiseRejectedResult).reason, baseLogContext);
  }
  const batches = [
    goFirstBatch.data,
    ...otherBatches
      .filter((batch) => isFulfilled(batch))
      .map((batch) => (batch as PromiseFulfilledResult<ActiveDapisBatch>).value),
  ];

  // Verify the batches returned by the contract.
  const _validBatches = batches.filter((batch, batchIndex) =>
    verifyBatch(batch, { chainId, providerName, batchIndex })
  );
};

export const getActiveDapiBatch = async (chain: Chain, offset = 0) => {
  const { dataFeedBatchSize } = chain;

  return getStaticActiveDapis(offset, dataFeedBatchSize);
};

// NOTE: Temporary type of the data returned by the contract.
type ActiveDapisBatch = Awaited<ReturnType<typeof getStaticActiveDapis>>;

// NOTE: The function is currently returning static data, because the contract is not yet finalized.
// eslint-disable-next-line @typescript-eslint/require-await
export const getStaticActiveDapis = async (_offset: number, _limit: number) => {
  return {
    totalCount: 1,
    dapiNames: ['MOCK_FEED'],
    dataFeedIds: ['0xebba8507d616ed80766292d200a3598fdba656d9938cecc392765d4a284a69a4'],
    updateParameters: [{ deviationThresholdInPercentage: 0.5, deviationReference: 0.5, heartbeatInterval: 100 }],
    // NOTE: We will need to decode this from the contract, because it will store the template IDs as encoded bytes.
    dataFeedTemplateIds: [['0xcc35bd1800c06c12856a87311dd95bfcbb3add875844021d59a929d79f3c99bd']],
    signedApiUrls: [['http://localhost:8080']],
    airnodeAddresses: ['0xbF3137b0a7574563a23a8fC8badC6537F98197CC'],
  };
};

export function deriveBeaconId(airnodeAddress: string, templateId: string) {
  return goSync(() => ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnodeAddress, templateId])).data;
}

export function deriveBeaconSetId(beaconIds: string[]) {
  return goSync(() => ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds]))).data;
}

export const verifyBatch = (batch: ActiveDapisBatch, logContext: LogContext) => {
  const { dapiNames, dataFeedIds, updateParameters, dataFeedTemplateIds, signedApiUrls, airnodeAddresses } = batch;
  if (
    dapiNames.length !== dataFeedIds.length ||
    dapiNames.length !== updateParameters.length ||
    dapiNames.length !== dataFeedTemplateIds.length ||
    dapiNames.length !== signedApiUrls.length ||
    dapiNames.length !== airnodeAddresses.length
  ) {
    logger.error(`Invalid active dAPIs batch length`, logContext);
    return false;
  }

  for (const [index, dataFeedId] of dataFeedIds.entries()) {
    const templateIds = dataFeedTemplateIds[index]!;
    const airnodeAddress = airnodeAddresses[index]!;

    if (templateIds.length === 1) {
      const derivedDataFeedId = deriveBeaconId(airnodeAddress, templateIds[0]!);
      if (dataFeedId !== derivedDataFeedId) {
        logger.error(`Invalid beacon ID`, { dataFeedId, derivedDataFeedId, ...logContext });
        return false;
      }
    } else {
      const derivedBeaconSetId = deriveBeaconSetId(templateIds);
      if (dataFeedId !== derivedBeaconSetId) {
        logger.error(`Invalid beacon set ID`, { dataFeedId, derivedBeaconSetId, ...logContext });
        return false;
      }
    }
  }

  return true;
};
