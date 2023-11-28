import type { Api3ServerV1 } from '@api3/airnode-protocol-v1';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { getAirseekerRecommendedGasPrice, hasPendingTransaction, setSponsorLastUpdateTimestampMs } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { SignedData, ChainId, ProviderName } from '../types';
import { deriveSponsorWallet } from '../utils';

import type { DecodedReadDapiWithIndexResponse } from './dapi-data-registry';

export interface UpdatableBeacon {
  beaconId: string;
  signedData: SignedData;
}

export interface UpdatableDapi {
  dapiInfo: DecodedReadDapiWithIndexResponse;
  updatableBeacons: UpdatableBeacon[];
}

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

export const updateFeeds = async (
  chainId: ChainId,
  providerName: ProviderName,
  provider: ethers.providers.StaticJsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDapis: UpdatableDapi[]
) => {
  const state = getState();
  const {
    config: { chains, sponsorWalletMnemonic },
  } = state;

  // Update all of the dAPIs in parallel.
  return Promise.all(
    updatableDapis.map(async (dapi) => {
      const { dapiInfo } = dapi;
      const {
        dapiName,
        decodedDataFeed: { dataFeedId },
      } = dapiInfo;
      const { dataFeedUpdateInterval, fallbackGasLimit } = chains[chainId]!;
      const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

      return logger.runWithContext({ dapiName, dataFeedId }, async () => {
        const goUpdate = await go(
          async () => {
            logger.debug('Creating calldatas');
            const dataFeedUpdateCalldatas = createUpdateFeedCalldatas(api3ServerV1, dapi);

            logger.debug('Estimating gas limit');
            const goEstimateGasLimit = await go(async () =>
              estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas, fallbackGasLimit)
            );
            if (!goEstimateGasLimit.success) {
              logger.error(`Skipping dAPI update because estimating gas limit failed`, goEstimateGasLimit.error);
              return;
            }
            const gasLimit = goEstimateGasLimit.data;

            logger.debug('Getting derived sponsor wallet');
            const sponsorWallet = getDerivedSponsorWallet(sponsorWalletMnemonic, dapiName);

            const goGasPrice = await go(
              async () =>
                getAirseekerRecommendedGasPrice(
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
              return;
            }
            const gasPrice = goGasPrice.data;

            // We want to set the timestamp of the first update transaction. We can determine if the transaction is the
            // original one if it is't not a retry of a pending transaction. That is, iff there is no timestamp for the
            // particular sponsor wallet. This assumes that a single sponsor updates a single dAPI.
            if (!hasPendingTransaction(chainId, providerName, sponsorWallet.address)) {
              logger.debug('Setting timestamp of the original update transaction');
              setSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWallet.address);
            }

            logger.debug('Updating dAPI', { gasPrice: goGasPrice.data, gasLimit });
            return (
              api3ServerV1
                // When we add the sponsor wallet (signer) without connecting it to the provider, the provider of the
                // contract will be set to "null". We need to connect the sponsor wallet to the provider of the contract.
                .connect(sponsorWallet.connect(api3ServerV1.provider))
                .tryMulticall(dataFeedUpdateCalldatas, { gasPrice, gasLimit })
            );
          },
          { totalTimeoutMs: dataFeedUpdateIntervalMs }
        );

        if (!goUpdate.success) {
          logger.error(`Failed to update a dAPI`, goUpdate.error);
          return null;
        }

        return goUpdate.data;
      });
    })
  );
};

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

  return fallbackGasLimit;
};

export const getDerivedSponsorWallet = (sponsorWalletMnemonic: string, dapiName: string) => {
  const { derivedSponsorWallets } = getState();

  const privateKey = derivedSponsorWallets?.[dapiName];
  if (privateKey) {
    return new ethers.Wallet(privateKey);
  }

  const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dapiName);
  logger.debug('Derived new sponsor wallet', { dapiName, sponsorWalletAddress: sponsorWallet.address });

  updateState((draft) => {
    draft.derivedSponsorWallets = {
      ...draft.derivedSponsorWallets,
      [dapiName]: sponsorWallet.privateKey,
    };
  });

  return sponsorWallet;
};
