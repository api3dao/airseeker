import { generateTestConfig, initializeState } from '../../test/fixtures/mock-config';
import { type PendingTransactionInfo, getState } from '../state';

import { initializePendingTransactionsInfo, setPendingTransactionInfo } from './pending-transaction-info';

const chainId = '31337';
const providerName = 'localhost';
const dateNowMock = 1_696_930_907_351;
const timestampMock = Math.floor(dateNowMock / 1000);
const sponsorWalletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const dataFeedId = '0x4ad7611218e5e90496ba81a9406eac314e8bc8eed282d4e7c2b61896eaeeaa85';

beforeEach(() => {
  initializeState(generateTestConfig());
  initializePendingTransactionsInfo(chainId, providerName);
});

describe(setPendingTransactionInfo.name, () => {
  it('sets the pending transaction info', () => {
    const pendingTransactionInfo: PendingTransactionInfo = {
      consecutivelyUpdatableCount: 1,
      firstUpdatableTimestamp: timestampMock,
    };

    setPendingTransactionInfo(chainId, providerName, sponsorWalletAddress, dataFeedId, pendingTransactionInfo);

    expect(
      getState().pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress]![dataFeedId]
    ).toStrictEqual(pendingTransactionInfo);
  });

  it('clears the pending transaction info', () => {
    setPendingTransactionInfo(chainId, providerName, sponsorWalletAddress, dataFeedId, null);

    expect(getState().pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress]![dataFeedId]).toBeNull();
  });
});
