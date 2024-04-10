import type { Address } from '@api3/commons';
import type { Api3ServerV1 } from '@api3/contracts';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import type { WalletDerivationScheme } from '../config/schema';
import { getRecommendedGasPrice } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
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

// TODO: Rename
export const hasSponsorPendingTransaction = (chainId: string, providerName: string, sponsorWalletAddress: Address) => {
  const firstExceededDeviationTimestamp =
    getState().firstExceededDeviationTimestamps[chainId]![providerName]![sponsorWalletAddress];

  return !!firstExceededDeviationTimestamp;
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
    config: { chains, sponsorWalletMnemonic, walletDerivationScheme },
  } = state;

  const { dataFeedInfo } = updatableDataFeed;
  const { dapiName, dataFeedId, decodedDapiName, updateParameters } = dataFeedInfo;
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
        const gasLimit = await estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas, fallbackGasLimit);
        if (!gasLimit) return null;

        logger.debug('Getting derived sponsor wallet.');
        const sponsorWallet = getDerivedSponsorWallet(
          sponsorWalletMnemonic,
          dapiName ?? dataFeedId,
          updateParameters,
          walletDerivationScheme
        );
        const sponsorWalletAddress = sponsorWallet.address as Address;

        logger.debug('Getting nonce.');
        const goNonce = await go(async () => provider.getTransactionCount(sponsorWallet.address, blockNumber));
        if (!goNonce.success) {
          logger.warn(`Failed to get nonce.`, goNonce.error);
          return null;
        }
        const nonce = goNonce.data;

        logger.debug('Getting recommended gas price.');
        const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress);
        if (!gasPrice) return null;

        logger.info('Updating data feed.', {
          sponsorAddress: sponsorWalletAddress,
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
          // It seems that in practice, this code is widely used. We can do a best-effort attempt to determine the error
          // reason. Many times, the error is acceptable and results from the way Airseeker is designed. We can use
          // different log levels and messages and have better alerts.
          const errorCode = (goMulticall.error as any).code;
          switch (errorCode) {
            case 'REPLACEMENT_UNDERPRICED': {
              logger.info(`Failed to submit replacement transaction because it was underpriced.`);
              return null;
            }
            case 'NONCE_EXPIRED': {
              logger.info(`Failed to submit the transaction because the nonce was expired.`);
              return null;
            }
            case 'INSUFFICIENT_FUNDS': {
              // This should never happen and monitoring should warn even before Airseeker comes to this point.
              logger.error(`Failed to submit the transaction because of insufficient funds.`, goMulticall.error);
              return null;
            }
            default: {
              logger.warn(`Failed to submit the multicall transaction.`, goMulticall.error);
              return null;
            }
          }
        }

        logger.info('Successfully submitted the multicall transaction.');
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
  const errorMessage = goEstimateGas.error.message;
  // It is possible that the gas estimation failed because of a contract revert due to timestamp check, because the feed
  // was updated by other provider in the meantime. Try to detect this expected case and log INFO instead.
  if (errorMessage.includes('Does not update timestamp')) {
    logger.info(`Gas estimation failed because of a contract revert.`, { errorMessage });
  } else {
    logger.warn(`Unable to estimate gas for multicall using provider.`, { errorMessage });
  }

  if (!fallbackGasLimit) {
    // Logging it as an INFO because in practice this would result in double logging of the same issue. If there is no
    // fallback gas limit specified it's expected that the update transcation will be skipped in case of gas limit
    // estimation failure.
    logger.info('No fallback gas limit provided. No gas limit to use.');
    return null;
  }

  return BigInt(fallbackGasLimit);
};

export const getDerivedSponsorWallet = (
  sponsorWalletMnemonic: string,
  dapiNameOrDataFeedId: DapiNameOrDataFeedId,
  updateParameters: string,
  walletDerivationScheme: WalletDerivationScheme
) => {
  const { derivedSponsorWallets } = getState();

  const privateKey = derivedSponsorWallets?.[dapiNameOrDataFeedId];
  if (privateKey) {
    return new ethers.Wallet(privateKey);
  }

  const sponsorWallet = deriveSponsorWallet(
    sponsorWalletMnemonic,
    dapiNameOrDataFeedId,
    updateParameters,
    walletDerivationScheme
  );
  logger.debug('Derived new sponsor wallet.', { sponsorWalletAddress: sponsorWallet.address });

  updateState((draft) => {
    draft.derivedSponsorWallets[dapiNameOrDataFeedId] = sponsorWallet.privateKey;
  });

  return sponsorWallet;
};
