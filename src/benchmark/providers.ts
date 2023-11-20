import { ethers } from 'ethers';
import { range, sortBy } from 'lodash';

import { initializeState } from '../../test/fixtures/mock-config';
import type { Chain } from '../config/schema';
import { RPC_PROVIDER_TIMEOUT_MS } from '../constants';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import {
  decodeDapisCountResponse,
  getDapiDataRegistry,
  verifyMulticallResponse,
} from '../update-feeds/dapi-data-registry';

const benchmarkProvider = async (chain: Chain, { url }: { url: string }) => {
  const { contracts } = chain;

  // Create a provider and connect it to the DapiDataRegistry contract.
  const provider = new ethers.providers.StaticJsonRpcProvider({
    url,
    timeout: RPC_PROVIDER_TIMEOUT_MS,
  });
  const dapiDataRegistry = getDapiDataRegistry(contracts.DapiDataRegistry, provider);

  const possibleBatchSizes = [1, 5, 10, 50, 100, 200, 300, 400, 500, 600, 1000]; // 200, 300, 400, 500, 600, 1000

  const results = await Promise.allSettled(
    possibleBatchSizes.map(async (batchSize) => {
      const dapisCountCalldata = dapiDataRegistry.interface.encodeFunctionData('dapisCount');
      const readDapiWithIndexCalldatas = range(0, batchSize).map(() =>
        dapiDataRegistry.interface.encodeFunctionData('readDapiWithIndex', [0])
      );

      const [dapisCountReturndata] = verifyMulticallResponse(
        await dapiDataRegistry.callStatic.tryMulticall([dapisCountCalldata, ...readDapiWithIndexCalldatas])
      );

      decodeDapisCountResponse(dapiDataRegistry, dapisCountReturndata!);

      return batchSize;
    })
  );

  return sortBy(
    results.filter((item) => item.status === 'fulfilled').map((item) => (item as PromiseFulfilledResult<number>).value)
  ).at(-1);
};

export const benchmarkProviders = async () => {
  const { config } = getState();

  const results = await Promise.all(
    Object.entries(config.chains).map(async ([chainId, chainConfig]) => {
      return Promise.all(
        Object.entries(chainConfig.providers).map(async ([providerName, providerConfig]) => {
          return { chainId, providerName, benchmark: await benchmarkProvider(chainConfig, providerConfig) };
        })
      );
    })
  );

  updateState((draft) => {
    const flatResults = results.flat();

    for (const result of flatResults) {
      const chainObject = { ...draft?.config?.chains[result.chainId], dataFeedBatchSize: result.benchmark };

      draft = {
        ...draft,
        // @ts-expect-error contracts will never be undefined
        config: { ...draft.config, chains: { ...draft.config.chains, [result.chainId]: chainObject } },
      };
    }
  });

  const flatResults = results.flat();

  logger.info(flatResults);
};

const testMain = async () => {
  initializeState();
  await benchmarkProviders();
};

void testMain();
