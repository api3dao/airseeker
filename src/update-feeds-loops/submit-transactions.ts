import { go, type Address, type Hex } from '@api3/commons';
import type { Api3ServerV1 } from '@api3/contracts';
import { type EthersError, ethers } from 'ethers';

import { getRecommendedGasPrice } from '../gas-price';
import { getKeycardWallet } from '../keycard';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import {
  deriveSponsorAddress,
  deriveSponsorWalletFromSponsorAddress,
  multiplyBigNumber,
  sanitizeEthersError,
  type SponsorAddressDerivationParams,
} from '../utils';

import { getApi3ServerV1BuilderTipExtension, type Api3ServerV1BuilderTipExtension } from './contracts';
import {
  estimateBuilderTipMulticallGasLimit,
  estimateMulticallGasLimit,
  estimateSingleBeaconGasLimit,
} from './gas-estimation';
import type { UpdatableDataFeed } from './get-updatable-feeds';
import { getPendingTransactionsInfo, markPendingTransactionsAsSubmitted } from './pending-transaction-info';

export const createUpdateFeedCalldatas = (api3ServerV1: Api3ServerV1, updatableDataFeed: UpdatableDataFeed) => {
  const { dataFeedInfo, updatableBeacons, shouldUpdateBeaconSet } = updatableDataFeed;
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

  return shouldUpdateBeaconSet
    ? [
        ...beaconUpdateCalls,
        api3ServerV1.interface.encodeFunctionData('updateBeaconSetWithBeacons', [
          allBeacons.map(({ beaconId }) => beaconId),
        ]),
      ]
    : beaconUpdateCalls;
};

export interface BuilderTipParams {
  chainId: string;
  providerName: string;
  extensionAddress: Address;
  multiplier: number;
  maxTip: bigint | undefined;
}

// Determines whether the update transaction should tip the block builder by being submitted through the
// Api3ServerV1BuilderTipExtension contract. Mirroring the gas price scaling, the most stuck data feed of the
// transaction is used to make the decision. Feeds without a submitted transaction are ignored, because a feed can
// remain updatable without anything being stuck in the mempool (e.g. when there is no gas price to use).
export const getBuilderTipParams = (
  chainId: string,
  providerName: string,
  sponsorWalletAddress: Address,
  dataFeedIds: Hex[]
): BuilderTipParams | null => {
  const { contracts, builderTipSettings } = getState().config.chains[chainId]!;
  const extensionAddress = contracts.Api3ServerV1BuilderTipExtension;
  if (!extensionAddress || !builderTipSettings) return null;

  const pendingTransactionsInfo = getPendingTransactionsInfo(chainId, providerName, sponsorWalletAddress, dataFeedIds);
  const consecutivelyUpdatableCount = Math.max(
    0,
    ...pendingTransactionsInfo.map((info) => (info?.hasSubmittedTransaction ? info.consecutivelyUpdatableCount : 0))
  );
  const { consecutivelyUpdatableCountThreshold, multiplier, maxTip } = builderTipSettings;
  if (consecutivelyUpdatableCount <= consecutivelyUpdatableCountThreshold) return null;

  logger.info('Update transaction is pending for too long. Will tip the block builder.', {
    consecutivelyUpdatableCount,
    consecutivelyUpdatableCountThreshold,
  });
  return { chainId, providerName, extensionAddress, multiplier, maxTip };
};

// A misconfigured extension would tip for transactions that update nothing, so verify that it wraps the configured
// Api3ServerV1. The wrapped address is immutable, so the verification is cached per chain and provider. It is not
// shared across providers because it is only as trustworthy as the provider that answered it.
const verifyBuilderTipExtension = async (
  builderTipParams: BuilderTipParams,
  api3ServerV1BuilderTipExtension: Api3ServerV1BuilderTipExtension,
  api3ServerV1: Api3ServerV1
) => {
  const { chainId, providerName } = builderTipParams;
  if (getState().verifiedBuilderTipExtensions?.[chainId]?.[providerName]) return;

  const wrappedApi3ServerV1 = await api3ServerV1BuilderTipExtension.api3ServerV1.staticCall();
  if (wrappedApi3ServerV1 !== (api3ServerV1.target as string)) {
    throw new Error('The Api3ServerV1BuilderTipExtension does not wrap the configured Api3ServerV1 contract.');
  }
  updateState((draft) => {
    draft.verifiedBuilderTipExtensions[chainId] ??= {};
    draft.verifiedBuilderTipExtensions[chainId]![providerName] = true;
  });
};

export const submitUpdate = async (
  api3ServerV1: Api3ServerV1,
  updatableDataFeeds: UpdatableDataFeed[],
  fallbackGasLimit: number | undefined,
  sponsorWallet: ethers.HDNodeWallet | ethers.Wallet,
  gasPrice: bigint,
  nonce: number,
  builderTipParams: BuilderTipParams | null
) => {
  const goSubmitUpdate = await go(async () => {
    const sponsorWalletAddress = sponsorWallet.address as Address;

    // Tipped updates always go through the extension contract, so the single beacon fast path is untipped only.
    const isSingleBeaconUpdate =
      !builderTipParams &&
      updatableDataFeeds.length === 1 &&
      updatableDataFeeds[0]?.dataFeedInfo.beaconsWithData.length === 1;
    if (isSingleBeaconUpdate) {
      const { updatableBeacons } = updatableDataFeeds[0]!;
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
    const dataFeedUpdateCalldatas = updatableDataFeeds.flatMap((updatableDataFeed) =>
      createUpdateFeedCalldatas(api3ServerV1, updatableDataFeed)
    );

    if (builderTipParams) {
      // The extension takes the same calldatas as the Api3ServerV1 multicall functions and transfers the value sent
      // along with the transaction to the block builder as a tip. Tipping is best-effort, so when any part of the
      // tipped flow fails, the update falls through to the untipped submission below instead of being dropped.
      const goSubmitTippedUpdate = await go(async () => {
        const api3ServerV1BuilderTipExtension = getApi3ServerV1BuilderTipExtension(
          builderTipParams.extensionAddress,
          sponsorWallet
        );
        await verifyBuilderTipExtension(builderTipParams, api3ServerV1BuilderTipExtension, api3ServerV1);

        logger.debug('Estimating builder tip multicall update gas limit.');
        const gasLimit = await estimateBuilderTipMulticallGasLimit(
          api3ServerV1BuilderTipExtension,
          dataFeedUpdateCalldatas
        );
        if (!gasLimit) return null;

        // The tip is paid on top of the transaction fee, so the sponsor wallet needs to have enough balance for both.
        let tipAmount = multiplyBigNumber(gasPrice * gasLimit, builderTipParams.multiplier);
        if (builderTipParams.maxTip !== undefined && tipAmount > builderTipParams.maxTip) {
          logger.warn('Sanitizing tip amount.', {
            tipAmount: tipAmount.toString(),
            maxTip: builderTipParams.maxTip.toString(),
          });
          tipAmount = builderTipParams.maxTip;
        }
        logger.info('Updating data feed(s) with a builder tip.', {
          sponsorWalletAddress,
          gasPrice: gasPrice.toString(),
          gasLimit: gasLimit.toString(),
          nonce,
          tipAmount: tipAmount.toString(),
        });
        return api3ServerV1BuilderTipExtension.tryMulticallAndTip.send(dataFeedUpdateCalldatas, {
          value: tipAmount,
          gasPrice,
          gasLimit,
          nonce,
        });
      });
      if (goSubmitTippedUpdate.success && goSubmitTippedUpdate.data) return goSubmitTippedUpdate.data;
      if (goSubmitTippedUpdate.success) {
        logger.info('Failed to estimate the tipped update transaction. Falling back to an untipped update.');
      } else {
        logger.warn(
          'Failed to submit the tipped update transaction. Falling back to an untipped update.',
          sanitizeEthersError(goSubmitTippedUpdate.error)
        );
      }
    }

    logger.debug('Estimating multicall update gas limit.');
    const gasLimit = await estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas, fallbackGasLimit);
    if (!gasLimit) return null;

    logger.info('Updating data feed(s).', {
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
    const ethersError = goSubmitUpdate.error as EthersError;
    if (ethersError.code === 'REPLACEMENT_UNDERPRICED') {
      logger.info(`Failed to submit replacement transaction because it was underpriced.`);
      return null;
    } else if (ethersError.code === 'NONCE_EXPIRED' || ethersError.message.includes('invalid nonce')) {
      logger.info(`Failed to submit the transaction because the nonce was expired.`);
      return null;
    } else if (ethersError.code === 'INSUFFICIENT_FUNDS') {
      // This should never happen and monitoring should warn even before Airseeker comes to this point.
      logger.error(`Failed to submit the transaction because of insufficient funds.`, sanitizeEthersError(ethersError));
      return null;
    } else {
      logger.warn(`Failed to submit the update transaction.`, sanitizeEthersError(ethersError));
      return null;
    }
  }

  if (!goSubmitUpdate.data) return null; // There was a handled error during submission.
  logger.info('Successfully submitted the update transaction.', { txHash: goSubmitUpdate.data.hash });
  return goSubmitUpdate.data;
};

export const submitBatchTransaction = async (
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeeds: UpdatableDataFeed[],
  blockNumber: number
) => {
  const {
    config: { chains, walletDerivationScheme },
  } = getState();

  const decodedDapiNames = updatableDataFeeds.map(({ dataFeedInfo: { decodedDapiName } }) => decodedDapiName);
  const dataFeedIds = updatableDataFeeds.map(({ dataFeedInfo: { dataFeedId } }) => dataFeedId);
  const { dataFeedUpdateInterval, fallbackGasLimit } = chains[chainId]!;
  const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

  return logger.runWithContext({ dapiNames: decodedDapiNames, dataFeedIds, blockNumber }, async () => {
    // NOTE: We use go mainly to set a timeout for the whole update process. We expect the function not to throw and
    // handle errors internally.
    const goUpdate = await go(
      async () => {
        logger.debug('Getting derived sponsor wallet.');
        const sponsorWallet = getDerivedSponsorWallet({
          ...walletDerivationScheme,
          dapiNameOrDataFeedId: '', // Not needed because using fixed sponsor wallet derivation type
          updateParameters: '', // Not needed because using fixed sponsor wallet derivation type
        }).connect(provider);
        const sponsorWalletAddress = sponsorWallet.address as Address;

        logger.debug('Getting nonce.');
        const goNonce = await go(async () => provider.getTransactionCount(sponsorWalletAddress, blockNumber));
        if (!goNonce.success) {
          logger.warn(`Failed to get nonce.`, goNonce.error);
          return null;
        }
        const nonce = goNonce.data;

        logger.debug('Getting recommended gas price.');
        const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, dataFeedIds);
        if (!gasPrice) return null;

        const builderTipParams = getBuilderTipParams(chainId, providerName, sponsorWalletAddress, dataFeedIds);

        const transactionResponse = await submitUpdate(
          api3ServerV1,
          updatableDataFeeds,
          fallbackGasLimit,
          sponsorWallet,
          gasPrice,
          nonce,
          builderTipParams
        );
        if (transactionResponse) {
          markPendingTransactionsAsSubmitted(chainId, providerName, sponsorWalletAddress, dataFeedIds);
        }
        return transactionResponse;
      },
      { totalTimeoutMs: dataFeedUpdateIntervalMs }
    );

    if (!goUpdate.success) {
      logger.error(`Unexpected error during updating data feeds.`, goUpdate.error);
      return null;
    }
    return goUpdate.data;
  });
};

export const submitTransaction = async (
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeed: UpdatableDataFeed,
  blockNumber: number
) => {
  const {
    config: { chains, walletDerivationScheme },
  } = getState();

  const {
    dataFeedInfo: { dapiName, dataFeedId, decodedDapiName, updateParameters },
  } = updatableDataFeed;
  const { dataFeedUpdateInterval, fallbackGasLimit } = chains[chainId]!;
  const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

  return logger.runWithContext({ dapiName: decodedDapiName, dataFeedId, blockNumber }, async () => {
    // NOTE: We use go mainly to set a timeout for the whole update process. We expect the function not to throw and
    // handle errors internally.
    const goUpdate = await go(
      async () => {
        logger.debug('Getting derived sponsor wallet.');
        const sponsorWallet = getDerivedSponsorWallet({
          ...walletDerivationScheme,
          dapiNameOrDataFeedId: dapiName ?? dataFeedId,
          updateParameters,
        }).connect(provider);
        const sponsorWalletAddress = sponsorWallet.address as Address;

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

        const builderTipParams = getBuilderTipParams(chainId, providerName, sponsorWalletAddress, [dataFeedId]);

        const transactionResponse = await submitUpdate(
          api3ServerV1,
          [updatableDataFeed],
          fallbackGasLimit,
          sponsorWallet,
          gasPrice,
          nonce,
          builderTipParams
        );
        if (transactionResponse) {
          markPendingTransactionsAsSubmitted(chainId, providerName, sponsorWalletAddress, [dataFeedId]);
        }
        return transactionResponse;
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
  if (updatableDataFeeds.length === 0) {
    return 0;
  }

  const {
    config: { walletDerivationScheme },
  } = getState();
  if (['fixed', 'keycard'].includes(walletDerivationScheme.type)) {
    const result = await submitBatchTransaction(
      chainId,
      providerName,
      provider,
      api3ServerV1,
      updatableDataFeeds,
      blockNumber
    );
    return result ? updatableDataFeeds.length : 0;
  }

  const result = await Promise.all(
    updatableDataFeeds.map(async (dataFeed) =>
      submitTransaction(chainId, providerName, provider, api3ServerV1, dataFeed, blockNumber)
    )
  );
  return result.filter(Boolean).length;
};

export const getDerivedSponsorWallet = (params: SponsorAddressDerivationParams) => {
  if (params.type === 'keycard') {
    return getKeycardWallet();
  }
  const { derivedSponsorWallets } = getState();
  const sponsorAddress = deriveSponsorAddress(params);
  const privateKey = derivedSponsorWallets?.[sponsorAddress];
  if (privateKey) {
    const sponsorWallet = new ethers.Wallet(privateKey);
    logger.debug('Found derived sponsor wallet.', { sponsorAddress, sponsorWalletAddress: sponsorWallet.address });
    return sponsorWallet;
  }
  const sponsorWallet = deriveSponsorWalletFromSponsorAddress(params.sponsorWalletMnemonic, sponsorAddress);
  logger.debug('Derived new sponsor wallet.', { sponsorAddress, sponsorWalletAddress: sponsorWallet.address });
  updateState((draft) => {
    draft.derivedSponsorWallets[sponsorAddress] = sponsorWallet.privateKey as Hex;
  });
  return sponsorWallet;
};
