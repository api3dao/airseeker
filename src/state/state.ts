import type { Address, ChainId, Hex } from '@api3/commons';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type { SignedDataRecord } from '../types';

interface GasPriceInfo {
  price: bigint;
  timestamp: number;
}

export interface PendingTransactionInfo {
  // The timestamp of when we last detected that the feed requires an update. Note, that if the feed requires an update
  // consecutively, the timestamp is not updated until the feed stops being updatable again.
  firstUpdatableTimestamp: number;
  // The count of how many consecutive updates are required for this data feed. This is used to determine if the
  // transaction is a retry or not.
  consecutivelyUpdatableCount: number;
  // Whether an update transaction has actually been submitted (accepted by the RPC provider) during the current
  // pending period. The feed can remain updatable without any submission (e.g. when there is no gas price or the RPC
  // fails), and such iterations must not count as a stuck transaction for the builder tip.
  hasSubmittedTransaction: boolean;
  // The on-chain timestamp of the last pending transaction. As a note, in a volatile market it is possible that we
  // submit an update transaction and in the next run we detect that feed needs an update again, even though the feed
  // was updated during this time (either by the previous transaction or by other Airseeker). The on-chain timestamp
  // aims to detect this case, so that we avoid scaling the gas price for this subsequent update.
  onChainTimestamp: bigint;
}

export interface State {
  config: Config;
  gasPrices: Record<ChainId, Record<string /* Provider name */, GasPriceInfo[]>>;
  // This is used to keep track of the first time Airseeker detects that a data feed requires an update.
  // The object with the update information is grouped by sponsor wallet and data feed ID. This is because Airseeker uses different schemes to derive sponsor wallets:
  // `managed`: The sponsor wallet is derived from the dAPI name resulting in a single sponsor wallet per data feed.
  // `self-funded`: The sponsor wallet is derived from the dAPI name (or data feed ID) and update parameters resulting in multiple sponsor wallets per data feed.
  // `fixed`: The sponsor wallet is derived from a pre-defined sponsor address resulting in a single sponsor wallet for all data feeds.
  pendingTransactionsInfo: Record<
    ChainId,
    Record<
      string /* Provider name */,
      Record<Address /* Sponsor wallet */, Record<Hex /* Data Feed ID */, PendingTransactionInfo | null>>
    >
  >;
  derivedSponsorWallets: Record<Address /* Sponsor */, Hex /* Private key */>;
  signedDatas: SignedDataRecord;
  signedApiUrlsFromConfig: Record<ChainId, Record<string /* Provider name */, string[]>>;
  signedApiUrlsFromContract: Record<ChainId, Record<string /* Provider name */, string[]>>;
  // The timestamp of when the service was initialized. This can be treated as a "deployment" timestamp.
  deploymentTimestamp: string;
  activeDataFeedBeaconIds: Record<ChainId, Record<string /* Provider name */, Hex[]>>;
  // Whether the Api3ServerV1BuilderTipExtension contract configured for the chain has been verified to wrap the
  // configured Api3ServerV1 contract. The wrapped address is immutable, so the verification only needs to be done
  // once, but it is done for each provider separately because it is only as trustworthy as the provider that answered
  // it.
  verifiedBuilderTipExtensions: Record<ChainId, Record<string /* Provider name */, boolean>>;
}

let state: State | undefined;

export const getState = (): State => {
  if (!state) {
    throw new Error('State is undefined.');
  }

  return state;
};

export const setInitialState = (config: Config) => {
  state = {
    activeDataFeedBeaconIds: {},
    config,
    deploymentTimestamp: Math.floor(Date.now() / 1000).toString(),
    derivedSponsorWallets: {},
    gasPrices: {},
    pendingTransactionsInfo: {},
    signedApiUrlsFromConfig: {},
    signedApiUrlsFromContract: {},
    signedDatas: {},
    verifiedBuilderTipExtensions: {},
  };
};

export const updateState = (updater: (draft: Draft<State>) => void) => {
  state = produce(getState(), updater);
};
