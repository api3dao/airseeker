import type { Address, ChainId } from '@api3/commons';

import { logger } from '../logger';
import { type PendingTransactionInfo, updateState, getState } from '../state';

import type { DecodedActiveDataFeedResponse } from './contracts';
import type { UpdatableDataFeed } from './get-updatable-feeds';
import { getDerivedSponsorWallet } from './submit-transactions';

export const initializePendingTransactionsInfo = (chainId: string, providerName: string) =>
  updateState((draft) => {
    if (!draft.pendingTransactionsInfo[chainId]) draft.pendingTransactionsInfo[chainId] = {};
    draft.pendingTransactionsInfo[chainId]![providerName] = {};
  });

export const setPendingTransactionInfo = (
  chainId: string,
  providerName: string,
  sponsorWalletAddress: Address,
  pendingTransactionInfo: PendingTransactionInfo | null
) => {
  updateState((draft) => {
    draft.pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress] = pendingTransactionInfo;
  });
};

export const updatePendingTransactionsInfo = (
  chainId: ChainId,
  providerName: string,
  batch: DecodedActiveDataFeedResponse[],
  feedsToUpdate: UpdatableDataFeed[]
) => {
  const {
    config: { sponsorWalletMnemonic, walletDerivationScheme },
    pendingTransactionsInfo: pendingTransactionsInfo,
  } = getState();

  const currentTimestamp = Math.floor(Date.now() / 1000);
  for (const feed of batch) {
    const { dapiName, dataFeedId, decodedDapiName, updateParameters } = feed;

    const isFeedUpdatable = feedsToUpdate.some(
      (updatableFeed) =>
        updatableFeed.dataFeedInfo.dapiName === dapiName && updatableFeed.dataFeedInfo.dataFeedId === dataFeedId
    );
    const sponsorWalletAddress = getDerivedSponsorWallet(
      sponsorWalletMnemonic,
      dapiName ?? dataFeedId,
      updateParameters,
      walletDerivationScheme
    ).address as Address;
    const pendingTransactionInfo = pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress];

    if (isFeedUpdatable) {
      const consecutivelyUpdatableCount = pendingTransactionInfo
        ? pendingTransactionInfo.consecutivelyUpdatableCount + 1
        : 1;
      const firstUpdatableTimestamp = pendingTransactionInfo?.firstUpdatableTimestamp ?? currentTimestamp;
      const newPendingTransactionInfo = { consecutivelyUpdatableCount, firstUpdatableTimestamp };
      logger.info('Updating pending transaction info.', {
        ...newPendingTransactionInfo,
        dapiName: decodedDapiName,
        dataFeedId,
      });
      setPendingTransactionInfo(chainId, providerName, sponsorWalletAddress, newPendingTransactionInfo);
    }
    if (!isFeedUpdatable && pendingTransactionInfo) {
      // NOTE: A data feed may stop needing an update for two reasons:
      //  1. It has been updated by some other transaction. This could have been done by this Airseeker or some backup.
      //  2. As a natural price shift in signed API data.
      //
      // We can't differentiate between these cases unless we check recent update transactions, which we don't want to
      // do.
      logger.info(`Clearing pending transaction info because it no longer needs an update.`, {
        dapiName: decodedDapiName,
        dataFeedId,
        totalPendingPeriod: currentTimestamp - pendingTransactionInfo.firstUpdatableTimestamp,
      });
      setPendingTransactionInfo(chainId, providerName, sponsorWalletAddress, null);
    }
  }
};
