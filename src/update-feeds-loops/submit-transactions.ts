import type { Api3ServerV1 } from '@api3/airnode-protocol-v1';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { getRecommendedGasPrice, setSponsorLastUpdateTimestampMs } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { ChainId, ProviderName } from '../types';
import { deriveSponsorWallet } from '../utils';

import type { UpdatableDapi } from './get-updatable-feeds';

export const createUpdateFeedCalldatas = (api3ServerV1: Api3ServerV1, updatableDapi: UpdatableDapi) => {
  const { dapiInfo, updatableBeacons } = updatableDapi;
  const allBeacons = dapiInfo.decodedDataFeed.beacons;

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

export const sponsorHasPendingTransaction = (chainId: string, providerName: string, sponsorWalletAddress: string) => {
  const { sponsorLastUpdateTimestampMs } = getState().gasPrices[chainId]![providerName]!;

  return !!sponsorLastUpdateTimestampMs[sponsorWalletAddress];
};

export const submitTransaction = async (
  chainId: ChainId,
  providerName: ProviderName,
  provider: ethers.providers.StaticJsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDapi: UpdatableDapi
) => {
  const state = getState();
  const {
    config: { chains, sponsorWalletMnemonic },
  } = state;

  const { dapiInfo } = updatableDapi;
  const {
    dapiName,
    decodedDapiName,
    decodedDataFeed: { dataFeedId },
  } = dapiInfo;
  const { dataFeedUpdateInterval, fallbackGasLimit } = chains[chainId]!;
  const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

  return logger.runWithContext({ dapiName: decodedDapiName, dataFeedId }, async () => {
    // NOTE: We use go mainly to set a timeout for the whole update process. We expect the function not to throw and
    // handle errors internally.
    const goUpdate = await go(
      async () => {
        logger.debug('Creating calldatas');
        const dataFeedUpdateCalldatas = createUpdateFeedCalldatas(api3ServerV1, updatableDapi);

        logger.debug('Estimating gas limit');
        const goEstimateGasLimit = await go(async () =>
          estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas, fallbackGasLimit)
        );
        if (!goEstimateGasLimit.success) {
          logger.error(`Skipping dAPI update because estimating gas limit failed`, goEstimateGasLimit.error);
          return null;
        }
        const gasLimit = goEstimateGasLimit.data;

        logger.debug('Getting derived sponsor wallet');
        const sponsorWallet = getDerivedSponsorWallet(sponsorWalletMnemonic, dapiName);

        logger.debug('Getting gas price');
        const goGasPrice = await go(
          async () =>
            getRecommendedGasPrice(
              chainId,
              providerName,
              provider,
              chains[chainId]!.gasSettings,
              sponsorWallet.address
            ),
          { totalTimeoutMs: dataFeedUpdateIntervalMs }
        );
        if (!goGasPrice.success) {
          logger.error(`Failed to get gas price`, goGasPrice.error);
          return null;
        }
        const gasPrice = goGasPrice.data;

        // We want to set the timestamp of the first update transaction. We can determine if the transaction is the
        // original one and that it isn't a retry of a pending transaction (if there is no timestamp for the
        // particular sponsor wallet). This assumes that a single sponsor updates a single dAPI.
        if (!sponsorHasPendingTransaction(chainId, providerName, sponsorWallet.address)) {
          logger.debug('Setting timestamp of the original update transaction');
          setSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWallet.address);
        }

        logger.debug('Updating dAPI', { gasPrice: goGasPrice.data.toString(), gasLimit: gasLimit.toString() });
        const goMulticall = await go(async () => {
          return (
            api3ServerV1
              // When we add the sponsor wallet (signer) without connecting it to the provider, the provider of the
              // contract will be set to "null". We need to connect the sponsor wallet to the provider of the contract.
              .connect(sponsorWallet.connect(api3ServerV1.provider))
              .tryMulticall(dataFeedUpdateCalldatas, { gasPrice, gasLimit })
          );
        });
        if (!goMulticall.success) {
          logger.error(`Failed to update a dAPI`, goMulticall.error);
          return null;
        }

        logger.info('Successfully updated dAPI');
        return goMulticall.data;
      },
      { totalTimeoutMs: dataFeedUpdateIntervalMs }
    );

    if (!goUpdate.success) {
      logger.error(`Unexpected error during updating dAPI`, goUpdate.error);
      return null;
    }
    return goUpdate.data;
  });
};

export const submitTransactions = async (
  chainId: ChainId,
  providerName: ProviderName,
  provider: ethers.providers.StaticJsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDapis: UpdatableDapi[]
) =>
  Promise.all(
    updatableDapis.map(async (dapi) => submitTransaction(chainId, providerName, provider, api3ServerV1, dapi))
  );

export const estimateMulticallGasLimit = async (
  api3ServerV1: Api3ServerV1,
  calldatas: string[],
  fallbackGasLimit: number | undefined
) => {
  const goEstimateGas = await go(async () => api3ServerV1.estimateGas.multicall(calldatas));
  if (goEstimateGas.success) {
    // Adding a extra 10% because multicall consumes less gas than tryMulticall
    return goEstimateGas.data.mul(ethers.BigNumber.from(Math.round(1.1 * 100))).div(ethers.BigNumber.from(100));
  }
  logger.warn(`Unable to estimate gas for multicall using provider`, goEstimateGas.error);

  if (!fallbackGasLimit) {
    throw new Error('Unable to estimate gas limit');
  }

  return ethers.BigNumber.from(fallbackGasLimit);
};

export const getDerivedSponsorWallet = (sponsorWalletMnemonic: string, dapiName: string) => {
  const { derivedSponsorWallets } = getState();

  const privateKey = derivedSponsorWallets?.[dapiName];
  if (privateKey) {
    return new ethers.Wallet(privateKey);
  }

  const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dapiName);
  logger.debug('Derived new sponsor wallet', { sponsorWalletAddress: sponsorWallet.address });

  updateState((draft) => {
    draft.derivedSponsorWallets = {
      ...draft.derivedSponsorWallets,
      [dapiName]: sponsorWallet.privateKey,
    };
  });

  return sponsorWallet;
};
