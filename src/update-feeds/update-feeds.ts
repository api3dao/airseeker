import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { chunk, range, size } from 'lodash';

import type { Chain } from '../config/schema';
import { logger } from '../logger';
import { getState } from '../state';
import { sleep } from '../utils';

import { getDapiDataRegistry, type ReadDapiResponse } from './dapi-data-registry';

export const startUpdateFeedLoops = async () => {
  const state = getState();
  const {
    config: { chains },
  } = state;

  // Start update loops for each chain in parallel.
  await Promise.all(
    Object.entries(chains).map(async ([chainId, chain]) => {
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
    })
  );
};
// https://github.com/api3dao/dapi-management/pull/3/files#diff-b6941851ebc92dc9691bbf0cb701fe9c4595cb78488c3bb92ad6e4b917719f4fR374
// TODO baseLogContext, actually test this against local node, add delay to reduce
export const runUpdateFeed = async (providerName: string, chain: Chain, _chainId: string) => {
  // const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts } = chain;
  const { providers, contracts } = chain;
  // TODO: Consider adding a start timestamp (as ID) to the logs to identify batches from this runUpdateFeed tick.
  // const baseLogContext = { chainId, providerName };

  // Create a provider and connect it to the DapiDataRegistry contract.
  const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);
  const dapiDataRegistry = getDapiDataRegistry(contracts.DapiDataRegistry, provider);
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  // TODO split out batch size to constant
  const dapiTuples = await chunk(range(10_000), 10).reduce<
    Promise<{ responses: ReadDapiResponse[]; endOfBatch: boolean }>
  >(
    async (accu, dapiIndexBatch) => {
      const resolvedAccu = await accu;
      if (resolvedAccu.endOfBatch) {
        return accu;
      }

      const readBatch = dapiIndexBatch.map((index) =>
        dapiDataRegistry.interface.encodeFunctionData('readDapiWithIndex', [index])
      );

      // Read beacon batch onchain values
      const goDatafeedsTryMulticall = await go(
        async () => dapiDataRegistry.connect(voidSigner).callStatic.tryMulticall(readBatch),
        {
          onAttemptError: (goError) =>
            logger.warn(`Failed attempt to read beacon data using multicall.`, { error: goError.error }),
        }
      );

      if (!goDatafeedsTryMulticall.success) {
        logger.warn(`Unable to read beacon data using multicall.`, { error: goDatafeedsTryMulticall.error });
        return { ...resolvedAccu, endOfBatch: true };
      }

      return { responses: [...resolvedAccu.responses], endOfBatch: false };
    },
    Promise.resolve({ responses: [], endOfBatch: false })
  );

  await Promise.allSettled(dapiTuples.responses.map(async (element) => processDApi(element)));
  // Carried over from previous code
  // TODO: Consider returning some information (success/error) and log some statistics (e.g. how many dAPIs were
};

export const processDApi = async (_dAPI: ReadDapiResponse) => {
  // TODO: Implement.
};
