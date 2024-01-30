import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { getRecommendedGasPrice, setSponsorLastUpdateTimestamp } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { Api3ServerV1 } from '../typechain-types';
import type { ChainId, DapiNameOrDataFeedId, ProviderName } from '../types';
import { deriveSponsorWallet } from '../utils';

import type { UpdatableDataFeed } from './get-updatable-feeds';

export const createUpdateFeedCalldatas = (api3ServerV1: Api3ServerV1, updatableDataFeed: UpdatableDataFeed) => {
  const { dataFeedInfo, updatableBeacons } = updatableDataFeed;
  const allBeacons = dataFeedInfo.beaconsWithData;

  // Create calldata for beacons that need to be updated.
  const beaconUpdateCalls = updatableBeacons.map(({ signedData }) =>
    api3ServerV1.interface.encodeFunctionData('updateBeaconWithSignedData', [
      signedData.airnode,
      signedData.templateId,
      signedData.timestamp,
      signedData.encodedValue,
      signedData.signature,
    ])
  );

  // If there are multiple beacons in the data feed it's a beacons set which we need to update as well.
  return allBeacons.length > 1
    ? [
        ...beaconUpdateCalls,
        api3ServerV1.interface.encodeFunctionData('updateBeaconSetWithBeacons', [
          allBeacons.map(({ beaconId }) => beaconId),
        ]),
      ]
    : beaconUpdateCalls;
};

export const hasSponsorPendingTransaction = (chainId: string, providerName: string, sponsorWalletAddress: string) => {
  const { sponsorLastUpdateTimestamp } = getState().gasPrices[chainId]![providerName]!;

  return !!sponsorLastUpdateTimestamp[sponsorWalletAddress];
};

export const submitTransaction = async (
  chainId: ChainId,
  providerName: ProviderName,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeed: UpdatableDataFeed,
  blockNumber: number
) => {
  const state = getState();
  const {
    config: { chains, sponsorWalletMnemonic },
  } = state;

  const { dataFeedInfo } = updatableDataFeed;
  const { dapiName, dataFeedId, decodedDapiName } = dataFeedInfo;
  const { dataFeedUpdateInterval, fallbackGasLimit } = chains[chainId]!;
  const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

  return logger.runWithContext({ dapiName: decodedDapiName, dataFeedId, blockNumber }, async () => {
    // NOTE: We use go mainly to set a timeout for the whole update process. We expect the function not to throw and
    // handle errors internally.
    const goUpdate = await go(
      async () => {
        logger.debug('Creating calldatas.');
        const dataFeedUpdateCalldatas = createUpdateFeedCalldatas(api3ServerV1, updatableDataFeed);

        logger.debug('Estimating gas limit.');
        const goEstimateGasLimit = await go(async () =>
          estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas, fallbackGasLimit)
        );
        if (!goEstimateGasLimit.success) {
          logger.error(`Skipping data feed update because estimating gas limit failed.`, goEstimateGasLimit.error);
          return null;
        }
        const gasLimit = goEstimateGasLimit.data;

        logger.debug('Getting derived sponsor wallet.');
        const sponsorWallet = getDerivedSponsorWallet(sponsorWalletMnemonic, dapiName ?? dataFeedId);

        logger.debug('Getting nonce.');
        const nonce = await provider.getTransactionCount(sponsorWallet.address, blockNumber);

        logger.debug('Getting gas price.');
        const gasPrice = await getRecommendedGasPrice(chainId, providerName, provider, sponsorWallet.address);
        if (!gasPrice) return null;

        // We want to set the timestamp of the first update transaction. We can determine if the transaction is the
        // original one and that it isn't a retry of a pending transaction (if there is no timestamp for the
        // particular sponsor wallet). This assumes that a single sponsor updates a single data feed.
        if (!hasSponsorPendingTransaction(chainId, providerName, sponsorWallet.address)) {
          logger.debug('Setting timestamp of the original update transaction.');
          setSponsorLastUpdateTimestamp(chainId, providerName, sponsorWallet.address);
        }

        logger.info('Updating data feed.', {
          sponsorAddress: sponsorWallet.address,
          gasPrice: gasPrice.toString(),
          gasLimit: gasLimit.toString(),
          nonce,
        });
        const goMulticall = await go(async () => {
          return (
            api3ServerV1
              // When we add the sponsor wallet (signer) without connecting it to the provider, the provider of the
              // contract will be set to "null". We need to connect the sponsor wallet to the provider of the contract.
              .connect(sponsorWallet.connect(provider))
              .tryMulticall.send(dataFeedUpdateCalldatas, { gasPrice, gasLimit, nonce })
          );
        });
        if (!goMulticall.success) {
          // It is possible (and sometimes expected) that we try to submit a replacement transaction with insufficient
          // gas price. Because this is intended flow, we catch the transaction error and log an information message
          // instead.
          if ((goMulticall.error as any).code === 'REPLACEMENT_UNDERPRICED') {
            logger.info(`Failed to submit replacement transaction because it was underpriced.`);
            return null;
          }
          logger.info(`Failed to update a data feed.`, goMulticall.error);
          return null;
        }

        logger.info('Successfully updated data feed.');
        return goMulticall.data;
      },
      { totalTimeoutMs: dataFeedUpdateIntervalMs }
    );

    if (!goUpdate.success) {
      logger.error(`Unexpected error during updating data feed.`, goUpdate.error);
      return null;
    }
    return goUpdate.data;
  });
};

export const submitTransactions = async (
  chainId: ChainId,
  providerName: ProviderName,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeeds: UpdatableDataFeed[],
  blockNumber: number
) =>
  Promise.all(
    updatableDataFeeds.map(async (dataFeed) =>
      submitTransaction(chainId, providerName, provider, api3ServerV1, dataFeed, blockNumber)
    )
  );

export const estimateMulticallGasLimit = async (
  api3ServerV1: Api3ServerV1,
  calldatas: string[],
  fallbackGasLimit: number | undefined
) => {
  const goEstimateGas = await go(async () => api3ServerV1.multicall.estimateGas(calldatas));
  if (goEstimateGas.success) {
    // Adding a extra 10% because multicall consumes less gas than tryMulticall
    return (goEstimateGas.data * BigInt(Math.round(1.1 * 100))) / 100n;
  }
  logger.warn(`Unable to estimate gas for multicall using provider.`, goEstimateGas.error);

  if (!fallbackGasLimit) {
    throw new Error('Unable to estimate gas limit');
  }

  return BigInt(fallbackGasLimit);
};

export const getDerivedSponsorWallet = (sponsorWalletMnemonic: string, dapiNameOrDataFeedId: DapiNameOrDataFeedId) => {
  const { derivedSponsorWallets } = getState();

  const privateKey = derivedSponsorWallets?.[dapiNameOrDataFeedId];
  if (privateKey) {
    return new ethers.Wallet(privateKey);
  }

  const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dapiNameOrDataFeedId);
  logger.debug('Derived new sponsor wallet.', { sponsorWalletAddress: sponsorWallet.address });

  updateState((draft) => {
    draft.derivedSponsorWallets[dapiNameOrDataFeedId] = sponsorWallet.privateKey;
  });

  return sponsorWallet;
};
