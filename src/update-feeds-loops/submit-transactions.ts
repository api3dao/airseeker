import type { Address, Hex } from '@api3/commons';
import type { Api3ServerV1 } from '@api3/contracts';
import { go } from '@api3/promise-utils';
import { ethers, type EthersError } from 'ethers';
import { isEmpty } from 'lodash';

import type { WalletDerivationScheme } from '../config/schema';
import { getRecommendedGasPrice } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import { deriveSponsorWallet, sanitizeEthersError } from '../utils';

import { estimateMulticallGasLimit, estimateSingleBeaconGasLimit } from './gas-estimation';
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

export const submitUpdate = async (
  api3ServerV1: Api3ServerV1,
  updatableDataFeed: UpdatableDataFeed,
  fallbackGasLimit: number | undefined,
  sponsorWallet: ethers.HDNodeWallet | ethers.Wallet,
  gasPrice: bigint,
  nonce: number
) => {
  const {
    updatableBeacons,
    dataFeedInfo: { beaconsWithData },
  } = updatableDataFeed;
  const sponsorWalletAddress = (await sponsorWallet.getAddress()) as Address;
  const isSingleBeaconUpdate = beaconsWithData.length === 1;

  if (isSingleBeaconUpdate) {
    const beacon = updatableBeacons[0]!;

    logger.debug('Estimating single beacon update gas limit.');
    const gasLimit = await estimateSingleBeaconGasLimit(api3ServerV1, beacon, fallbackGasLimit);
    if (!gasLimit) return null;

    logger.info('Updating single beacon.', {
      sponsorWalletAddress,
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      nonce,
    });
    const {
      signedData: { airnode, templateId, timestamp, encodedValue, signature },
    } = beacon;
    return api3ServerV1
      .connect(sponsorWallet)
      .updateBeaconWithSignedData.send(airnode, templateId, timestamp, encodedValue, signature, {
        gasPrice,
        gasLimit,
        nonce,
      });
  }

  logger.debug('Creating calldatas.');
  const dataFeedUpdateCalldatas = createUpdateFeedCalldatas(api3ServerV1, updatableDataFeed);

  logger.debug('Estimating beacon set update gas limit.');
  const gasLimit = await estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas, fallbackGasLimit);
  if (!gasLimit) return null;

  logger.info('Updating data feed.', {
    sponsorWalletAddress,
    gasPrice: gasPrice.toString(),
    gasLimit: gasLimit.toString(),
    nonce,
  });
  return api3ServerV1.connect(sponsorWallet).tryMulticall.send(dataFeedUpdateCalldatas, { gasPrice, gasLimit, nonce });
};

async function submitBatchTransaction(
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeeds: UpdatableDataFeed[],
  blockNumber: number
) {
  const {
    config: { chains, sponsorWalletMnemonic, walletDerivationScheme },
  } = getState();

  const [decodedDapiNames, dataFeedIds] = updatableDataFeeds.reduce(
    (acc: [(string | null)[], Hex[]], { dataFeedInfo: { decodedDapiName, dataFeedId } }) => {
      const [decodedDapiNames, dataFeedIds] = acc;
      return [
        [...(decodedDapiNames ?? []), decodedDapiName],
        [...dataFeedIds, dataFeedId],
      ];
    },
    [[], []]
  );

  const dataFeedUpdateCalldatas = updatableDataFeeds.flatMap((updatableDataFeed) =>
    createUpdateFeedCalldatas(api3ServerV1, updatableDataFeed)
  );

  const { dataFeedUpdateInterval, fallbackGasLimit } = chains[chainId]!;
  const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

  return logger.runWithContext({ dapiNames: decodedDapiNames, dataFeedIds, blockNumber }, async () => {
    // NOTE: We use go mainly to set a timeout for the whole update process. We expect the function not to throw and
    // handle errors internally.
    const goUpdate = await go(
      async () => {
        logger.debug('Getting derived sponsor wallet.');
        const sponsorWallet = getDerivedSponsorWallet(
          sponsorWalletMnemonic,
          ethers.ZeroHash as Hex,
          '',
          walletDerivationScheme
        ).connect(provider);
        const sponsorWalletAddress = (await sponsorWallet.getAddress()) as Address;

        logger.debug('Getting nonce.');
        const goNonce = await go(async () => provider.getTransactionCount(sponsorWalletAddress, 'latest'));
        if (!goNonce.success) {
          logger.warn(`Failed to get nonce.`, goNonce.error);
          return null;
        }
        const nonce = goNonce.data;

        logger.debug('Getting recommended gas price.');
        const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, dataFeedIds);
        if (!gasPrice) return null;

        logger.debug('Estimating beacon set update gas limit.');
        const gasLimit = await estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas, fallbackGasLimit);
        if (!gasLimit) return null;

        const goSubmitUpdate = await go(async () => {
          logger.info('Updating data feeds in batch.', {
            sponsorWalletAddress,
            gasPrice: gasPrice.toString(),
            gasLimit: gasLimit.toString(),
            nonce,
          });
          return api3ServerV1
            .connect(sponsorWallet)
            .tryMulticall.send(dataFeedUpdateCalldatas, { gasPrice, gasLimit, nonce });
        });
        if (!goSubmitUpdate.success) {
          // It seems that in practice, this code is widely used. We can do a best-effort attempt to determine the error
          // reason. Many times, the error is acceptable and results from the way Airseeker is designed. We can use
          // different log levels and messages and have better alerts.
          const errorCode = (goSubmitUpdate.error as any).code;
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
              logger.error(`Failed to submit the transaction because of insufficient funds.`, goSubmitUpdate.error);
              return null;
            }
            default: {
              logger.warn(`Failed to submit the update transaction.`, goSubmitUpdate.error);
              return null;
            }
          }
        }

        if (!goSubmitUpdate.data) return null; // There was a handled error during submission.
        logger.info('Successfully submitted the update transaction.', { txHash: goSubmitUpdate.data.hash });
        return goSubmitUpdate.data;
      },
      { totalTimeoutMs: dataFeedUpdateIntervalMs }
    );

    if (!goUpdate.success) {
      logger.error(`Unexpected error during updating data feeds.`, goUpdate.error);
      return null;
    }
    return goUpdate.data;
  });
}

export const submitTransaction = async (
  chainId: string,
  providerName: string,
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
        logger.debug('Getting derived sponsor wallet.');
        const sponsorWallet = getDerivedSponsorWallet(
          sponsorWalletMnemonic,
          dapiName ?? dataFeedId,
          updateParameters,
          walletDerivationScheme
        ).connect(provider);
        const sponsorWalletAddress = (await sponsorWallet.getAddress()) as Address;

        logger.debug('Getting nonce.');
        const goNonce = await go(async () => provider.getTransactionCount(sponsorWalletAddress, blockNumber));
        if (!goNonce.success) {
          logger.warn(`Failed to get nonce.`, sanitizeEthersError(goNonce.error));
          return null;
        }
        const nonce = goNonce.data;

        logger.debug('Getting recommended gas price.');
        const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);
        if (!gasPrice) return null;

        const goSubmitUpdate = await go(async () => {
          return submitUpdate(api3ServerV1, updatableDataFeed, fallbackGasLimit, sponsorWallet, gasPrice, nonce);
        });
        if (!goSubmitUpdate.success) {
          // It seems that in practice, this code is widely used. We can do a best-effort attempt to determine the error
          // reason. Many times, the error is acceptable and results from the way Airseeker is designed. We can use
          // different log levels and messages and have better alerts.
          const ethersError = goSubmitUpdate.error as EthersError;
          if (ethersError.code === 'REPLACEMENT_UNDERPRICED') {
            logger.info(`Failed to submit replacement transaction because it was underpriced.`);
            return null;
          } else if (ethersError.code === 'NONCE_EXPIRED' || ethersError.message.includes('invalid nonce')) {
            logger.info(`Failed to submit the transaction because the nonce was expired.`);
            return null;
          } else if (ethersError.code === 'INSUFFICIENT_FUNDS') {
            // This should never happen and monitoring should warn even before Airseeker comes to this point.
            logger.error(`Failed to submit the transaction because of insufficient funds.`, ethersError);
            return null;
          } else {
            logger.warn(`Failed to submit the update transaction.`, ethersError);
            return null;
          }
        }

        if (!goSubmitUpdate.data) return null; // There was a handled error during submission.
        logger.info('Successfully submitted the update transaction.', { txHash: goSubmitUpdate.data.hash });
        return goSubmitUpdate.data;
      },
      { totalTimeoutMs: dataFeedUpdateIntervalMs }
    );

    if (!goUpdate.success) {
      logger.error(`Unexpected error during updating data feed.`, sanitizeEthersError(goUpdate.error));
      return null;
    }
    return goUpdate.data;
  });
};

export const submitTransactions = async (
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeeds: UpdatableDataFeed[],
  blockNumber: number
) => {
  const {
    config: { walletDerivationScheme },
  } = getState();
  if (walletDerivationScheme.type === 'fixed') {
    if (isEmpty(updatableDataFeeds)) {
      return [];
    }
    return Array.from({ length: updatableDataFeeds.length }).fill(
      await submitBatchTransaction(chainId, providerName, provider, api3ServerV1, updatableDataFeeds, blockNumber)
    );
  } else {
    return Promise.all(
      updatableDataFeeds.map(async (dataFeed) =>
        submitTransaction(chainId, providerName, provider, api3ServerV1, dataFeed, blockNumber)
      )
    );
  }
};

export const getDerivedSponsorWallet = (
  sponsorWalletMnemonic: string,
  dapiNameOrDataFeedId: Hex,
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
    draft.derivedSponsorWallets[dapiNameOrDataFeedId] = sponsorWallet.privateKey as Hex;
  });

  return sponsorWallet;
};
