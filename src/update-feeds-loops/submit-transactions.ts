import type { Address, Hex } from '@api3/commons';
import type { Api3ServerV1 } from '@api3/contracts';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import type { WalletDerivationScheme } from '../config/schema';
import { getRecommendedGasPrice } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import { deriveSponsorWallet } from '../utils';

import type { UpdatableBeacon, UpdatableDataFeed } from './get-updatable-feeds';

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
  connectedSponsorWallet: ethers.HDNodeWallet | ethers.Wallet,
  gasPrice: bigint,
  nonce: number
) => {
  const {
    updatableBeacons,
    dataFeedInfo: { beaconsWithData },
  } = updatableDataFeed;
  const sponsorWalletAddress = connectedSponsorWallet.address as Address;
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
      .connect(connectedSponsorWallet)
      .updateBeaconWithSignedData(airnode, templateId, timestamp, encodedValue, signature, {
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
  return api3ServerV1
    .connect(connectedSponsorWallet)
    .tryMulticall.send(dataFeedUpdateCalldatas, { gasPrice, gasLimit, nonce });
};

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
        );
        const sponsorWalletAddress = sponsorWallet.address as Address;

        logger.debug('Getting nonce.');
        const goNonce = await go(async () => provider.getTransactionCount(sponsorWalletAddress, blockNumber));
        if (!goNonce.success) {
          logger.warn(`Failed to get nonce.`, goNonce.error);
          return null;
        }
        const nonce = goNonce.data;

        logger.debug('Getting recommended gas price.');
        const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress);
        if (!gasPrice) return null;

        const goSubmitUpdate = await go(async () => {
          // When we add the sponsor wallet (signer) without connecting it to the provider, the provider of the
          // contract will be set to "null". We need to connect the sponsor wallet to the provider of the contract.
          const connectedSponsorWallet = sponsorWallet.connect(provider);
          return submitUpdate(
            api3ServerV1,
            updatableDataFeed,
            fallbackGasLimit,
            connectedSponsorWallet,
            gasPrice,
            nonce
          );
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
      logger.error(`Unexpected error during updating data feed.`, goUpdate.error);
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
) =>
  Promise.all(
    updatableDataFeeds.map(async (dataFeed) =>
      submitTransaction(chainId, providerName, provider, api3ServerV1, dataFeed, blockNumber)
    )
  );

export const handleRpcGasLimitFailure = (error: Error, fallbackGasLimit: number | undefined) => {
  const errorMessage = error.message;
  // It is possible that the gas estimation failed because of a contract revert due to timestamp check, because the feed
  // was updated by other provider in the meantime. Try to detect this expected case and log INFO instead.
  if (errorMessage.includes('Does not update timestamp')) {
    logger.info(`Gas estimation failed because of a contract revert.`, { errorMessage });
  } else {
    logger.warn(`Unable to estimate gas for single beacon using provider.`, { errorMessage });
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

export const estimateSingleBeaconGasLimit = async (
  api3ServerV1: Api3ServerV1,
  beacon: UpdatableBeacon,
  fallbackGasLimit: number | undefined
) => {
  const { signedData } = beacon;

  const goEstimateGas = await go(async () =>
    api3ServerV1.updateBeaconWithSignedData.estimateGas(
      signedData.airnode,
      signedData.templateId,
      signedData.timestamp,
      signedData.encodedValue,
      signedData.signature
    )
  );
  if (goEstimateGas.success) return BigInt(goEstimateGas.data);
  return handleRpcGasLimitFailure(goEstimateGas.error, fallbackGasLimit);
};

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
  return handleRpcGasLimitFailure(goEstimateGas.error, fallbackGasLimit);
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
