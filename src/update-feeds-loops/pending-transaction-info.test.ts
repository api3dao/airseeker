import type { ethers } from 'ethers';

import { generateTestConfig, initializeState } from '../../test/fixtures/mock-config';
import { allowPartial } from '../../test/utils';
import { logger } from '../logger';
import * as stateModule from '../state';

import type { DecodedActiveDataFeedResponse } from './contracts';
import type { UpdatableDataFeed } from './get-updatable-feeds';
import {
  initializePendingTransactionsInfo,
  setPendingTransactionInfo,
  updatePendingTransactionsInfo,
} from './pending-transaction-info';
import * as submitTransactionsModule from './submit-transactions';

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
    const pendingTransactionInfo: stateModule.PendingTransactionInfo = {
      consecutivelyUpdatableCount: 1,
      firstUpdatableTimestamp: timestampMock,
      onChainTimestamp: 1_696_930_907n,
    };

    setPendingTransactionInfo(chainId, providerName, sponsorWalletAddress, dataFeedId, pendingTransactionInfo);

    expect(
      stateModule.getState().pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress]![dataFeedId]
    ).toStrictEqual(pendingTransactionInfo);
  });

  it('clears the pending transaction info', () => {
    setPendingTransactionInfo(chainId, providerName, sponsorWalletAddress, dataFeedId, null);

    expect(
      stateModule.getState().pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress]![dataFeedId]
    ).toBeNull();
  });
});

describe(updatePendingTransactionsInfo.name, () => {
  it('resets the pending transaction info if the on-chain timestamp is different', () => {
    jest.spyOn(logger, 'info');
    jest.spyOn(stateModule, 'getState').mockReturnValueOnce(
      allowPartial<stateModule.State>({
        config: {},
        pendingTransactionsInfo: {
          [chainId]: {
            [providerName]: {
              [sponsorWalletAddress]: {
                [dataFeedId]: {
                  consecutivelyUpdatableCount: 2,
                  firstUpdatableTimestamp: timestampMock,
                  onChainTimestamp: 1_696_930_906n,
                },
              },
            },
          },
        },
      })
    );
    jest
      .spyOn(submitTransactionsModule, 'getDerivedSponsorWallet')
      .mockReturnValue({ address: sponsorWalletAddress } as ethers.Wallet);
    const now = Date.now();
    jest.useFakeTimers().setSystemTime(now);

    updatePendingTransactionsInfo(
      chainId,
      providerName,
      allowPartial<DecodedActiveDataFeedResponse[]>([
        {
          dapiName: '0xDapiName',
          dataFeedId,
          decodedDapiName: 'decodedDapiName',
          updateParameters: '0xUpdateParameters',
          dataFeedTimestamp: 1_696_930_907n, // The current data feed on-chain timestamp is different.
        },
      ]),
      allowPartial<UpdatableDataFeed[]>([
        {
          dataFeedInfo: {
            dapiName: '0xDapiName',
            dataFeedId,
          },
        },
      ])
    );

    // We expect the pending transaction info to be reset.
    expect(
      stateModule.getState().pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress]![dataFeedId]
    ).toStrictEqual({
      consecutivelyUpdatableCount: 1,
      firstUpdatableTimestamp: Math.floor(now / 1000),
      onChainTimestamp: 1_696_930_907n,
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Updating pending transaction info.', {
      dapiName: 'decodedDapiName',
      dataFeedId,
      sponsorWalletAddress,
      consecutivelyUpdatableCount: 1,
      firstUpdatableTimestamp: Math.floor(now / 1000),
      onChainTimestamp: 1_696_930_907n,
    });
  });
});
