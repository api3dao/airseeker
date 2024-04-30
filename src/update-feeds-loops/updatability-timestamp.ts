import type { Address } from '@api3/commons';

import { type PendingTransactionInfo, updateState } from '../state';

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
