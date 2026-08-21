import type { Address } from '@api3/commons';
import type { Api3ServerV1 } from '@api3/contracts';
import { ethers } from 'ethers';

import { generateTestConfig, initializeState } from '../../test/fixtures/mock-config';
import {
  generateMockApi3ServerV1,
  generateMockApi3ServerV1BuilderTipExtension,
} from '../../test/fixtures/mock-contract';
import { allowPartial } from '../../test/utils';
import * as gasPriceModule from '../gas-price';
import { logger } from '../logger';
import * as stateModule from '../state';
import * as utilsModule from '../utils';

import * as contractsModule from './contracts';
import * as gasEstimationModule from './gas-estimation';
import type { UpdatableDataFeed } from './get-updatable-feeds';
import * as submitTransactionsModule from './submit-transactions';

describe(submitTransactionsModule.createUpdateFeedCalldatas.name, () => {
  it('creates beacon update calldata', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    submitTransactionsModule.createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: '0xAirnode',
              signature: '0xsome-signature',
              templateId: '0xTemplate',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          },
        ],
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            },
          ],
        },
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(1);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledWith('updateBeaconWithSignedData', [
      '0xAirnode',
      '0xTemplate',
      '200',
      '0x0000000000000000000000000000000000000000000000000000000000000190',
      '0xsome-signature',
    ]);
  });

  it('creates beacon set update calldata with all beacons updatable', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    submitTransactionsModule.createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            signedData: {
              airnode: '0xAirnode-1',
              signature: '0xsome-signature-1',
              templateId: '0xTemplate-1',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          },
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            signedData: {
              airnode: '0xAirnode-2',
              signature: '0xsome-signature-2',
              templateId: '0xTemplate-2',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000350',
              timestamp: '300',
            },
          },
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: '0xAirnode-3',
              signature: '0xsome-signature-3',
              templateId: '0xTemplate-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            },
          ],
        },
        shouldUpdateBeaconSet: true,
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(4);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(1, 'updateBeaconWithSignedData', [
      '0xAirnode-1',
      '0xTemplate-1',
      '200',
      '0x0000000000000000000000000000000000000000000000000000000000000190',
      '0xsome-signature-1',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(2, 'updateBeaconWithSignedData', [
      '0xAirnode-2',
      '0xTemplate-2',
      '300',
      '0x0000000000000000000000000000000000000000000000000000000000000350',
      '0xsome-signature-2',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(3, 'updateBeaconWithSignedData', [
      '0xAirnode-3',
      '0xTemplate-3',
      '400',
      '0x0000000000000000000000000000000000000000000000000000000000000270',
      '0xsome-signature-3',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(4, 'updateBeaconSetWithBeacons', [
      [
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
      ],
    ]);
  });

  it('updates beacon set update calldata with some beacons updatable', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    submitTransactionsModule.createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: '0xAirnode-3',
              signature: '0xsome-signature-3',
              templateId: '0xTemplate-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            },
          ],
        },
        shouldUpdateBeaconSet: true,
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(2);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(1, 'updateBeaconWithSignedData', [
      '0xAirnode-3',
      '0xTemplate-3',
      '400',
      '0x0000000000000000000000000000000000000000000000000000000000000270',
      '0xsome-signature-3',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(2, 'updateBeaconSetWithBeacons', [
      [
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
      ],
    ]);
  });

  it('only creates calldata for some beacons updatable', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    submitTransactionsModule.createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: '0xAirnode-3',
              signature: '0xsome-signature-3',
              templateId: '0xTemplate-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            },
          ],
        },
        shouldUpdateBeaconSet: false,
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(1);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledWith('updateBeaconWithSignedData', [
      '0xAirnode-3',
      '0xTemplate-3',
      '400',
      '0x0000000000000000000000000000000000000000000000000000000000000270',
      '0xsome-signature-3',
    ]);
  });
});

describe(submitTransactionsModule.getBuilderTipParams.name, () => {
  const sponsorWalletAddress = '0xA772F7b103BBecA3Bb6C74Be41fCc2c192C8146c' as Address;
  const extensionAddress = '0x1F585372F13b8d1A1b8d0F4918f6c979a71353c6' as Address;

  it('returns null when the builder tip extension is not configured', () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: { chains: { '31337': { contracts: {} } } },
      })
    );

    const builderTipParams = submitTransactionsModule.getBuilderTipParams('31337', 'evm-local', sponsorWalletAddress, [
      '0xBeaconSetId',
    ]);

    expect(builderTipParams).toBeNull();
  });

  it('returns null when the update is not pending for long enough', () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              contracts: { Api3ServerV1BuilderTipExtension: extensionAddress },
              builderTipSettings: { consecutivelyUpdatableCountThreshold: 3, multiplier: 1.5 },
            },
          },
        },
        pendingTransactionsInfo: {
          '31337': {
            'evm-local': {
              [sponsorWalletAddress]: {
                '0xBeaconSetId': { consecutivelyUpdatableCount: 3, hasSubmittedTransaction: true },
              },
            },
          },
        },
      })
    );

    const builderTipParams = submitTransactionsModule.getBuilderTipParams('31337', 'evm-local', sponsorWalletAddress, [
      '0xBeaconSetId',
    ]);

    expect(builderTipParams).toBeNull();
  });

  it('returns the tip params when the update is pending for too long', () => {
    jest.spyOn(logger, 'info');
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              contracts: { Api3ServerV1BuilderTipExtension: extensionAddress },
              builderTipSettings: { consecutivelyUpdatableCountThreshold: 3, multiplier: 1.5 },
            },
          },
        },
        pendingTransactionsInfo: {
          '31337': {
            'evm-local': {
              [sponsorWalletAddress]: {
                '0xBeaconSetId': { consecutivelyUpdatableCount: 4, hasSubmittedTransaction: true },
              },
            },
          },
        },
      })
    );

    const builderTipParams = submitTransactionsModule.getBuilderTipParams('31337', 'evm-local', sponsorWalletAddress, [
      '0xBeaconSetId',
    ]);

    expect(builderTipParams).toStrictEqual({
      chainId: '31337',
      providerName: 'evm-local',
      extensionAddress,
      multiplier: 1.5,
      maxTip: undefined,
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Update transaction is pending for too long. Will tip the block builder.',
      {
        consecutivelyUpdatableCount: 4,
        consecutivelyUpdatableCountThreshold: 3,
      }
    );
  });

  it('makes the decision based on the most stuck data feed of the transaction', () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              contracts: { Api3ServerV1BuilderTipExtension: extensionAddress },
              builderTipSettings: { consecutivelyUpdatableCountThreshold: 3, multiplier: 1.5 },
            },
          },
        },
        pendingTransactionsInfo: {
          '31337': {
            'evm-local': {
              [sponsorWalletAddress]: {
                '0xBeaconSetId1': { consecutivelyUpdatableCount: 1, hasSubmittedTransaction: true },
                '0xBeaconSetId2': { consecutivelyUpdatableCount: 4, hasSubmittedTransaction: true },
              },
            },
          },
        },
      })
    );

    const builderTipParams = submitTransactionsModule.getBuilderTipParams('31337', 'evm-local', sponsorWalletAddress, [
      '0xBeaconSetId1',
      '0xBeaconSetId2',
    ]);

    expect(builderTipParams).toStrictEqual({
      chainId: '31337',
      providerName: 'evm-local',
      extensionAddress,
      multiplier: 1.5,
      maxTip: undefined,
    });
  });

  it('ignores the data feeds that have no submitted transaction', () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              contracts: { Api3ServerV1BuilderTipExtension: extensionAddress },
              builderTipSettings: { consecutivelyUpdatableCountThreshold: 3, multiplier: 1.5 },
            },
          },
        },
        pendingTransactionsInfo: {
          '31337': {
            'evm-local': {
              [sponsorWalletAddress]: {
                '0xBeaconSetId1': { consecutivelyUpdatableCount: 4, hasSubmittedTransaction: false },
                '0xBeaconSetId2': { consecutivelyUpdatableCount: 1, hasSubmittedTransaction: true },
              },
            },
          },
        },
      })
    );

    const builderTipParams = submitTransactionsModule.getBuilderTipParams('31337', 'evm-local', sponsorWalletAddress, [
      '0xBeaconSetId1',
      '0xBeaconSetId2',
    ]);

    expect(builderTipParams).toBeNull();
  });

  it('returns null when no transaction has been submitted during the pending period', () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              contracts: { Api3ServerV1BuilderTipExtension: extensionAddress },
              builderTipSettings: { consecutivelyUpdatableCountThreshold: 3, multiplier: 1.5 },
            },
          },
        },
        pendingTransactionsInfo: {
          '31337': {
            'evm-local': {
              [sponsorWalletAddress]: {
                '0xBeaconSetId': { consecutivelyUpdatableCount: 4, hasSubmittedTransaction: false },
              },
            },
          },
        },
      })
    );

    const builderTipParams = submitTransactionsModule.getBuilderTipParams('31337', 'evm-local', sponsorWalletAddress, [
      '0xBeaconSetId',
    ]);

    expect(builderTipParams).toBeNull();
  });

  it('returns null when there are no data feed IDs', () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              contracts: { Api3ServerV1BuilderTipExtension: extensionAddress },
              builderTipSettings: { consecutivelyUpdatableCountThreshold: 3, multiplier: 1.5 },
            },
          },
        },
      })
    );

    const builderTipParams = submitTransactionsModule.getBuilderTipParams(
      '31337',
      'evm-local',
      sponsorWalletAddress,
      []
    );

    expect(builderTipParams).toBeNull();
  });
});

describe(submitTransactionsModule.submitTransactions.name, () => {
  it('submits a transaction for each feed to update in the batch', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: { walletDerivationScheme: { type: 'managed' } },
      })
    );
    jest.spyOn(submitTransactionsModule, 'submitTransaction').mockImplementation();

    await submitTransactionsModule.submitTransactions(
      '31337',
      'evm-local',
      new ethers.JsonRpcProvider(),
      generateMockApi3ServerV1() as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: { dapiName: utilsModule.encodeDapiName('ETH/USD') },
        }),
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: { dapiName: utilsModule.encodeDapiName('BTC/USD') },
        }),
      ],
      123_456
    );

    expect(submitTransactionsModule.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it('submits a single transaction for updating all feeds in the batch', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          walletDerivationScheme: { type: 'fixed', sponsorAddress: '0x0000000000000000000000000000000000000001' },
        },
      })
    );
    jest.spyOn(submitTransactionsModule, 'submitBatchTransaction').mockImplementation();

    await submitTransactionsModule.submitTransactions(
      '31337',
      'evm-local',
      new ethers.JsonRpcProvider(),
      generateMockApi3ServerV1() as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: { dapiName: utilsModule.encodeDapiName('ETH/USD') },
        }),
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: { dapiName: utilsModule.encodeDapiName('BTC/USD') },
        }),
      ],
      123_456
    );

    expect(submitTransactionsModule.submitBatchTransaction).toHaveBeenCalledTimes(1);
  });
});

describe(submitTransactionsModule.submitBatchTransaction.name, () => {
  const dapiNames = [utilsModule.encodeDapiName('BTC/USD'), utilsModule.encodeDapiName('ETH/USD')];

  it('updates all dAPIs', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'info');
    jest.spyOn(gasEstimationModule, 'estimateMulticallGasLimit').mockResolvedValue(BigInt(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
              contracts: {},
            },
          },
          walletDerivationScheme: {
            type: 'fixed',
            sponsorAddress: '0x0000000000000000000000000000000000000001',
            sponsorWalletMnemonic:
              'diamond result history offer forest diagram crop armed stumble orchard stage glance',
          },
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockResolvedValue(0),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitBatchTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      dapiNames.map((dapiName) =>
        allowPartial<UpdatableDataFeed>({
          updatableBeacons: [
            {
              beaconId: '0xBeaconId1',
              signedData: {
                airnode: '0xAirnode1',
                templateId: '0xTemplateId1',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
          dataFeedInfo: {
            dapiName,
            dataFeedId: '0xBeaconSetId',
            beaconsWithData: [
              {
                beaconId: '0xBeaconId1',
                airnodeAddress: '0xAirnode1',
                templateId: '0xTemplateId1',
              },
              {
                beaconId: '0xBeaconId2',
                airnodeAddress: '0xAirnode2',
                templateId: '0xTemplateId2',
              },
            ],
          },
        })
      ),
      123_456
    );

    // Verify that the data feed was updated successfully.
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed(s).', {
      sponsorWalletAddress: '0xFaFF9C2E67716d2209552f46Fa9829D46830aCcB',
      gasLimit: '500000',
      gasPrice: '100000000',
      nonce: 0,
    });
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', {
      txHash: '0xTransactionHash',
    });

    // Verify the flow of the update process via the debug logs. Note, that some debug log calls are not here because
    // many functions are mocked.
    expect(logger.debug).toHaveBeenCalledTimes(6);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Getting derived sponsor wallet.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Derived new sponsor wallet.', {
      sponsorAddress: expect.any(String),
      sponsorWalletAddress: '0xFaFF9C2E67716d2209552f46Fa9829D46830aCcB',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Getting nonce.');
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Getting recommended gas price.');
    expect(logger.debug).toHaveBeenNthCalledWith(5, 'Creating calldatas.');
    expect(logger.debug).toHaveBeenNthCalledWith(6, 'Estimating multicall update gas limit.');
  });

  it('logs an error when getting nonce fails', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'warn');
    jest.spyOn(gasEstimationModule, 'estimateMulticallGasLimit').mockResolvedValue(BigInt(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
            },
          },
          walletDerivationScheme: {
            type: 'managed',
            sponsorWalletMnemonic:
              'diamond result history offer forest diagram crop armed stumble orchard stage glance',
          },
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockRejectedValue(new Error('some-error')),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        dataFeedInfo: {
          dapiName: dapiNames[1]!,
          dataFeedId: '0xBeaconSetId',
        },
      }),
      123_456
    );

    // Verify that the data feed was not updated.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Failed to get nonce.', new Error('some-error'));
  });
});

describe(submitTransactionsModule.submitTransaction.name, () => {
  const dapiName = utilsModule.encodeDapiName('ETH/USD');

  it('updates a dAPI', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'info');
    jest.spyOn(gasEstimationModule, 'estimateMulticallGasLimit').mockResolvedValue(BigInt(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
              contracts: {},
            },
          },
          walletDerivationScheme: {
            type: 'managed',
            sponsorWalletMnemonic:
              'diamond result history offer forest diagram crop armed stumble orchard stage glance',
          },
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockResolvedValue(0),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xBeaconId1',
            signedData: {
              airnode: '0xAirnode1',
              templateId: '0xTemplateId1',
              timestamp: '1629811000',
              encodedValue: '0xEncodedValue',
              signature: '0xSignature',
            },
          },
        ],
        dataFeedInfo: {
          dapiName,
          dataFeedId: '0xBeaconSetId',
          beaconsWithData: [
            {
              beaconId: '0xBeaconId1',
              airnodeAddress: '0xAirnode1',
              templateId: '0xTemplateId1',
            },
            {
              beaconId: '0xBeaconId2',
              airnodeAddress: '0xAirnode2',
              templateId: '0xTemplateId2',
            },
          ],
        },
      }),
      123_456
    );

    // Verify that the data feed was updated successfully.
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed(s).', {
      gasLimit: '500000',
      gasPrice: '100000000',
      nonce: 0,
      sponsorWalletAddress: '0xA772F7b103BBecA3Bb6C74Be41fCc2c192C8146c',
    });
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', {
      txHash: '0xTransactionHash',
    });

    // Verify the flow of the update process via the debug logs. Note, that some debug log calls are not here because
    // many functions are mocked.
    expect(logger.debug).toHaveBeenCalledTimes(6);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Getting derived sponsor wallet.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Derived new sponsor wallet.', {
      sponsorAddress: expect.any(String),
      sponsorWalletAddress: '0xA772F7b103BBecA3Bb6C74Be41fCc2c192C8146c',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Getting nonce.');
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Getting recommended gas price.');
    expect(logger.debug).toHaveBeenNthCalledWith(5, 'Creating calldatas.');
    expect(logger.debug).toHaveBeenNthCalledWith(6, 'Estimating multicall update gas limit.');
  });

  it('logs an error when getting nonce fails', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'warn');
    jest.spyOn(gasEstimationModule, 'estimateMulticallGasLimit').mockResolvedValue(BigInt(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
            },
          },
          walletDerivationScheme: {
            type: 'managed',
            sponsorWalletMnemonic:
              'diamond result history offer forest diagram crop armed stumble orchard stage glance',
          },
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockRejectedValue(new Error('some-error')),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        dataFeedInfo: {
          dapiName,
          dataFeedId: '0xBeaconSetId',
        },
      }),
      123_456
    );

    // Verify that the data feed was not updated.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Failed to get nonce.', new Error('some-error'));
  });

  it('updates a dAPI with a builder tip when the update transaction is pending for too long', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'info');
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xApi3ServerV1Address');
    api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas.mockResolvedValue(150_000n);
    api3ServerV1BuilderTipExtension.tryMulticallAndTip.send.mockReturnValue({ hash: '0xTransactionHash' });
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
              contracts: { Api3ServerV1BuilderTipExtension: '0x1F585372F13b8d1A1b8d0F4918f6c979a71353c6' },
              builderTipSettings: { consecutivelyUpdatableCountThreshold: 2, multiplier: 1.5 },
            },
          },
          walletDerivationScheme: {
            type: 'managed',
            sponsorWalletMnemonic:
              'diamond result history offer forest diagram crop armed stumble orchard stage glance',
          },
        },
        pendingTransactionsInfo: {
          '31337': {
            'evm-local': {
              '0xA772F7b103BBecA3Bb6C74Be41fCc2c192C8146c': {
                '0xBeaconSetId': { consecutivelyUpdatableCount: 3, hasSubmittedTransaction: true },
              },
            },
          },
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockResolvedValue(0),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xBeaconId1',
            signedData: {
              airnode: '0xAirnode1',
              templateId: '0xTemplateId1',
              timestamp: '1629811000',
              encodedValue: '0xEncodedValue',
              signature: '0xSignature',
            },
          },
        ],
        dataFeedInfo: {
          dapiName,
          dataFeedId: '0xBeaconSetId',
          beaconsWithData: [
            {
              beaconId: '0xBeaconId1',
              airnodeAddress: '0xAirnode1',
              templateId: '0xTemplateId1',
            },
            {
              beaconId: '0xBeaconId2',
              airnodeAddress: '0xAirnode2',
              templateId: '0xTemplateId2',
            },
          ],
        },
      }),
      123_456
    );

    // Verify that the update transaction was submitted through the builder tip extension.
    expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send).toHaveBeenCalledWith(['calldata1', 'calldata2'], {
      value: 29_250_000_000_000n, // multiplier (1.5) * gasPrice (100_000_000) * gasLimit (195_000)
      gasPrice: 100_000_000n,
      gasLimit: 195_000n,
      nonce: 0,
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Update transaction is pending for too long. Will tip the block builder.',
      {
        consecutivelyUpdatableCount: 3,
        consecutivelyUpdatableCountThreshold: 2,
      }
    );
    expect(logger.info).toHaveBeenCalledWith('Updating data feed(s) with a builder tip.', {
      sponsorWalletAddress: '0xA772F7b103BBecA3Bb6C74Be41fCc2c192C8146c',
      gasPrice: '100000000',
      gasLimit: '195000',
      nonce: 0,
      tipAmount: '29250000000000',
    });
    expect(api3ServerV1.tryMulticall.send).toHaveBeenCalledTimes(0);
  });
});

describe(submitTransactionsModule.submitUpdate.name, () => {
  const builderTipParams: submitTransactionsModule.BuilderTipParams = {
    chainId: '31337',
    providerName: 'evm-local',
    extensionAddress: '0x1F585372F13b8d1A1b8d0F4918f6c979a71353c6' as Address,
    multiplier: 1.5,
    maxTip: undefined,
  };

  it('submits a single beacon update', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(api3ServerV1.updateBeaconWithSignedData, 'estimateGas').mockReturnValue(150_000n);
    jest.spyOn(api3ServerV1.updateBeaconWithSignedData, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    jest.spyOn(logger, 'info');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [
              {
                beaconId: '0xBeaconId',
                airnodeAddress: '0xAirnode',
                templateId: '0xTemplateId',
              },
            ],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId',
              signedData: {
                airnode: '0xAirnode',
                templateId: '0xTemplateId',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      null
    );

    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating single beacon.', {
      sponsorWalletAddress: '0xD8Ba840Cae5c24e5Dc148355Ea3cde3CFB12f8eF',
      gasPrice: '100000000',
      gasLimit: '150000',
      nonce: 11,
    });
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', {
      txHash: '0xTransactionHash',
    });
  });

  it('submits a beacon set update', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(api3ServerV1.multicall, 'estimateGas').mockReturnValue(150_000n);
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    jest.spyOn(logger, 'info');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [
              {
                beaconId: '0xBeaconId1',
                airnodeAddress: '0xAirnode1',
                templateId: '0xTemplateId1',
              },
              {
                beaconId: '0xBeaconId2',
                airnodeAddress: '0xAirnode2',
                templateId: '0xTemplateId2',
              },
            ],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId1',
              signedData: {
                airnode: '0xAirnode1',
                templateId: '0xTemplateId1',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      null
    );

    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed(s).', {
      sponsorWalletAddress: '0xD8Ba840Cae5c24e5Dc148355Ea3cde3CFB12f8eF',
      gasPrice: '100000000',
      gasLimit: '165000',
      nonce: 11,
    });
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', {
      txHash: '0xTransactionHash',
    });
  });

  it('submits a tipped beacon set update through the builder tip extension', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest
      .spyOn(api3ServerV1.interface, 'encodeFunctionData')
      .mockReturnValueOnce('0xBeaconCalldata')
      .mockReturnValueOnce('0xBeaconSetCalldata');
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xApi3ServerV1Address');
    api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas.mockResolvedValue(150_000n);
    api3ServerV1BuilderTipExtension.tryMulticallAndTip.send.mockReturnValue({ hash: '0xTransactionHash' });
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    jest.spyOn(stateModule, 'getState').mockReturnValue(allowPartial<stateModule.State>({}));
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(logger, 'info');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [
              {
                beaconId: '0xBeaconId1',
                airnodeAddress: '0xAirnode1',
                templateId: '0xTemplateId1',
              },
              {
                beaconId: '0xBeaconId2',
                airnodeAddress: '0xAirnode2',
                templateId: '0xTemplateId2',
              },
            ],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId1',
              signedData: {
                airnode: '0xAirnode1',
                templateId: '0xTemplateId1',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
          shouldUpdateBeaconSet: true,
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      builderTipParams
    );

    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(contractsModule.getApi3ServerV1BuilderTipExtension).toHaveBeenCalledWith(
      '0x1F585372F13b8d1A1b8d0F4918f6c979a71353c6',
      sponsorWallet
    );
    expect(api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas).toHaveBeenCalledWith(
      ['0xBeaconCalldata', '0xBeaconSetCalldata'],
      { value: 1n }
    );
    expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send).toHaveBeenCalledWith(
      ['0xBeaconCalldata', '0xBeaconSetCalldata'],
      {
        value: 29_250_000_000_000n, // multiplier (1.5) * gasPrice (100_000_000) * gasLimit (195_000)
        gasPrice: 100_000_000n,
        gasLimit: 195_000n,
        nonce: 11,
      }
    );
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed(s) with a builder tip.', {
      sponsorWalletAddress: '0xD8Ba840Cae5c24e5Dc148355Ea3cde3CFB12f8eF',
      gasPrice: '100000000',
      gasLimit: '195000',
      nonce: 11,
      tipAmount: '29250000000000',
    });
  });

  it('caps the tip amount at the configured maximum', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData').mockReturnValueOnce('0xBeaconCalldata');
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xApi3ServerV1Address');
    api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas.mockResolvedValue(150_000n);
    api3ServerV1BuilderTipExtension.tryMulticallAndTip.send.mockReturnValue({ hash: '0xTransactionHash' });
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    jest.spyOn(stateModule, 'getState').mockReturnValue(allowPartial<stateModule.State>({}));
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(logger, 'warn');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [
              {
                beaconId: '0xBeaconId',
                airnodeAddress: '0xAirnode',
                templateId: '0xTemplateId',
              },
            ],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId',
              signedData: {
                airnode: '0xAirnode',
                templateId: '0xTemplateId',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      { ...builderTipParams, maxTip: 1_000_000_000_000n }
    );

    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(logger.warn).toHaveBeenCalledWith('Sanitizing tip amount.', {
      tipAmount: '29250000000000', // multiplier (1.5) * gasPrice (100_000_000) * gasLimit (195_000)
      maxTip: '1000000000000',
    });
    expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send).toHaveBeenCalledWith(['0xBeaconCalldata'], {
      value: 1_000_000_000_000n,
      gasPrice: 100_000_000n,
      gasLimit: 195_000n,
      nonce: 11,
    });
  });

  it('submits a tipped update through the builder tip extension for a single beacon feed', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData').mockReturnValueOnce('0xBeaconCalldata');
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xApi3ServerV1Address');
    api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas.mockResolvedValue(100_000n);
    api3ServerV1BuilderTipExtension.tryMulticallAndTip.send.mockReturnValue({ hash: '0xTransactionHash' });
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    jest.spyOn(stateModule, 'getState').mockReturnValue(allowPartial<stateModule.State>({}));
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [
              {
                beaconId: '0xBeaconId',
                airnodeAddress: '0xAirnode',
                templateId: '0xTemplateId',
              },
            ],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId',
              signedData: {
                airnode: '0xAirnode',
                templateId: '0xTemplateId',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      { ...builderTipParams, multiplier: 1 }
    );

    // Verify that the single beacon update is not submitted directly to Api3ServerV1 (which is the case for untipped
    // updates), but through the builder tip extension.
    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(api3ServerV1.updateBeaconWithSignedData.send).toHaveBeenCalledTimes(0);
    expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send).toHaveBeenCalledWith(['0xBeaconCalldata'], {
      value: 14_000_000_000_000n, // multiplier (1) * gasPrice (100_000_000) * gasLimit (140_000)
      gasPrice: 100_000_000n,
      gasLimit: 140_000n,
      nonce: 11,
    });
  });

  it('falls back to an untipped update when the extension does not wrap the configured Api3ServerV1', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData').mockReturnValueOnce('0xBeaconCalldata');
    jest.spyOn(api3ServerV1.multicall, 'estimateGas').mockResolvedValue(150_000n);
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xOtherApi3ServerV1Address');
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    jest.spyOn(stateModule, 'getState').mockReturnValue(allowPartial<stateModule.State>({}));
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(logger, 'warn');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [{ beaconId: '0xBeaconId', airnodeAddress: '0xAirnode', templateId: '0xTemplateId' }],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId',
              signedData: {
                airnode: '0xAirnode',
                templateId: '0xTemplateId',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      builderTipParams
    );

    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to submit the tipped update transaction. Falling back to an untipped update.',
      new Error('The Api3ServerV1BuilderTipExtension does not wrap the configured Api3ServerV1 contract.')
    );
    expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send).toHaveBeenCalledTimes(0);
    expect(api3ServerV1.tryMulticall.send).toHaveBeenCalledWith(['0xBeaconCalldata'], {
      gasPrice: 100_000_000n,
      gasLimit: 165_000n,
      nonce: 11,
    });
  });

  it('falls back to an untipped update when the tipped gas estimation fails', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData').mockReturnValueOnce('0xBeaconCalldata');
    jest.spyOn(api3ServerV1.multicall, 'estimateGas').mockResolvedValue(150_000n);
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xApi3ServerV1Address');
    api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas.mockRejectedValue(new Error('some-error'));
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    jest.spyOn(stateModule, 'getState').mockReturnValue(allowPartial<stateModule.State>({}));
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(logger, 'info');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [{ beaconId: '0xBeaconId', airnodeAddress: '0xAirnode', templateId: '0xTemplateId' }],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId',
              signedData: {
                airnode: '0xAirnode',
                templateId: '0xTemplateId',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      builderTipParams
    );

    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(logger.info).toHaveBeenCalledWith(
      'Failed to estimate the tipped update transaction. Falling back to an untipped update.'
    );
    expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send).toHaveBeenCalledTimes(0);
    expect(api3ServerV1.tryMulticall.send).toHaveBeenCalledWith(['0xBeaconCalldata'], {
      gasPrice: 100_000_000n,
      gasLimit: 165_000n,
      nonce: 11,
    });
  });

  it('falls back to an untipped update when the sponsor wallet cannot cover the tip', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData').mockReturnValueOnce('0xBeaconCalldata');
    jest.spyOn(api3ServerV1.multicall, 'estimateGas').mockResolvedValue(150_000n);
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xApi3ServerV1Address');
    api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas.mockResolvedValue(150_000n);
    api3ServerV1BuilderTipExtension.tryMulticallAndTip.send.mockRejectedValue(new Error('insufficient funds'));
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    jest.spyOn(stateModule, 'getState').mockReturnValue(allowPartial<stateModule.State>({}));
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(logger, 'warn');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [{ beaconId: '0xBeaconId', airnodeAddress: '0xAirnode', templateId: '0xTemplateId' }],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId',
              signedData: {
                airnode: '0xAirnode',
                templateId: '0xTemplateId',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      builderTipParams
    );

    // The tipped submission was attempted but rejected, and the update was still submitted without a tip.
    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to submit the tipped update transaction. Falling back to an untipped update.',
      new Error('insufficient funds')
    );
    expect(api3ServerV1.tryMulticall.send).toHaveBeenCalledWith(['0xBeaconCalldata'], {
      gasPrice: 100_000_000n,
      gasLimit: 165_000n,
      nonce: 11,
    });
  });

  it('verifies the builder tip extension only once', async () => {
    initializeState(generateTestConfig());
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData').mockReturnValue('0xBeaconCalldata');
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xApi3ServerV1Address');
    api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas.mockResolvedValue(150_000n);
    api3ServerV1BuilderTipExtension.tryMulticallAndTip.send.mockReturnValue({ hash: '0xTransactionHash' });
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');
    const updatableDataFeeds = [
      allowPartial<UpdatableDataFeed>({
        dataFeedInfo: {
          beaconsWithData: [{ beaconId: '0xBeaconId', airnodeAddress: '0xAirnode', templateId: '0xTemplateId' }],
        },
        updatableBeacons: [
          {
            beaconId: '0xBeaconId',
            signedData: {
              airnode: '0xAirnode',
              templateId: '0xTemplateId',
              timestamp: '1629811000',
              encodedValue: '0xEncodedValue',
              signature: '0xSignature',
            },
          },
        ],
      }),
    ];

    await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      updatableDataFeeds,
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11,
      builderTipParams
    );
    await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      updatableDataFeeds,
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      12,
      builderTipParams
    );

    // The wrapped Api3ServerV1 address is immutable, so the verification result is cached in the state.
    expect(api3ServerV1BuilderTipExtension.api3ServerV1.staticCall).toHaveBeenCalledTimes(1);
    expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send).toHaveBeenCalledTimes(2);
  });

  it('verifies the builder tip extension for each chain and provider separately', async () => {
    initializeState(generateTestConfig());
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData').mockReturnValue('0xBeaconCalldata');
    const api3ServerV1BuilderTipExtension = generateMockApi3ServerV1BuilderTipExtension();
    api3ServerV1BuilderTipExtension.api3ServerV1.staticCall.mockResolvedValue('0xApi3ServerV1Address');
    api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas.mockResolvedValue(150_000n);
    api3ServerV1BuilderTipExtension.tryMulticallAndTip.send.mockReturnValue({ hash: '0xTransactionHash' });
    jest
      .spyOn(contractsModule, 'getApi3ServerV1BuilderTipExtension')
      .mockReturnValue(api3ServerV1BuilderTipExtension as unknown as contractsModule.Api3ServerV1BuilderTipExtension);
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');
    const updatableDataFeeds = [
      allowPartial<UpdatableDataFeed>({
        dataFeedInfo: {
          beaconsWithData: [{ beaconId: '0xBeaconId', airnodeAddress: '0xAirnode', templateId: '0xTemplateId' }],
        },
        updatableBeacons: [
          {
            beaconId: '0xBeaconId',
            signedData: {
              airnode: '0xAirnode',
              templateId: '0xTemplateId',
              timestamp: '1629811000',
              encodedValue: '0xEncodedValue',
              signature: '0xSignature',
            },
          },
        ],
      }),
    ];

    for (const params of [
      builderTipParams,
      { ...builderTipParams, providerName: 'evm-local-2' },
      { ...builderTipParams, chainId: '1' },
    ]) {
      await submitTransactionsModule.submitUpdate(
        api3ServerV1 as unknown as Api3ServerV1,
        updatableDataFeeds,
        undefined,
        sponsorWallet,
        BigInt(100_000_000),
        11,
        params
      );
    }

    // A verification is only as trustworthy as the provider that answered it, so it is not shared across providers
    // (nor across chains, where the same address may host a different deployment).
    expect(api3ServerV1BuilderTipExtension.api3ServerV1.staticCall).toHaveBeenCalledTimes(3);
  });
});
