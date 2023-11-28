import type { Api3ServerV1 } from '@api3/airnode-protocol-v1';
import { ethers } from 'ethers';

import { generateMockApi3ServerV1 } from '../../test/fixtures/mock-contract';
import { allowPartial } from '../../test/utils';

import { type UpdatableDapi, createUpdateFeedCalldatas, estimateMulticallGasLimit } from './update-transactions';

describe(estimateMulticallGasLimit.name, () => {
  it('estimates the gas limit for a multicall', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockResolvedValueOnce(ethers.BigNumber.from(500_000));

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xbeaconId1Calldata', '0xbeaconId2Calldata', '0xbeaconSetCalldata'],
      undefined
    );

    expect(gasLimit).toStrictEqual(ethers.BigNumber.from(550_000)); // Note that the gas limit is increased by 10%.
  });

  it('uses fallback gas limit when dummy data estimation fails', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockRejectedValue(new Error('some-error'));

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xbeaconId1Calldata', '0xbeaconId2Calldata', '0xbeaconSetCalldata'],
      2_000_000
    );

    expect(gasLimit).toBe(2_000_000);
  });

  it('throws an error if no fallback is provided', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockRejectedValue(new Error('some-error'));

    await expect(async () =>
      estimateMulticallGasLimit(
        mockApi3ServerV1 as unknown as Api3ServerV1,
        ['0xbeaconId1Calldata', '0xbeaconId2Calldata', '0xbeaconSetCalldata'],
        undefined
      )
    ).rejects.toStrictEqual(new Error('Unable to estimate gas limit'));
  });
});

describe(createUpdateFeedCalldatas.name, () => {
  it('creates beacon update calldata', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDapi>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: 'airnode',
              signature: 'some-signature',
              templateId: 'template',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          },
        ],
        dapiInfo: {
          decodedDataFeed: {
            beacons: [
              {
                beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
              },
            ],
          },
        },
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(1);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledWith('updateBeaconWithSignedData', [
      'airnode',
      'template',
      '200',
      '0x0000000000000000000000000000000000000000000000000000000000000190',
      'some-signature',
    ]);
  });

  it('creates beacon set update calldata with all beacons updatable', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDapi>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            signedData: {
              airnode: 'airnode-1',
              signature: 'some-signature-1',
              templateId: 'template-1',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          },
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            signedData: {
              airnode: 'airnode-2',
              signature: 'some-signature-2',
              templateId: 'template-2',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000350',
              timestamp: '300',
            },
          },
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: 'airnode-3',
              signature: 'some-signature-3',
              templateId: 'template-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dapiInfo: {
          decodedDataFeed: {
            beacons: [
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
        },
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(4);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(1, 'updateBeaconWithSignedData', [
      'airnode-1',
      'template-1',
      '200',
      '0x0000000000000000000000000000000000000000000000000000000000000190',
      'some-signature-1',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(2, 'updateBeaconWithSignedData', [
      'airnode-2',
      'template-2',
      '300',
      '0x0000000000000000000000000000000000000000000000000000000000000350',
      'some-signature-2',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(3, 'updateBeaconWithSignedData', [
      'airnode-3',
      'template-3',
      '400',
      '0x0000000000000000000000000000000000000000000000000000000000000270',
      'some-signature-3',
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

    createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDapi>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: 'airnode-3',
              signature: 'some-signature-3',
              templateId: 'template-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dapiInfo: {
          decodedDataFeed: {
            beacons: [
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
        },
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(2);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(1, 'updateBeaconWithSignedData', [
      'airnode-3',
      'template-3',
      '400',
      '0x0000000000000000000000000000000000000000000000000000000000000270',
      'some-signature-3',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(2, 'updateBeaconSetWithBeacons', [
      [
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
      ],
    ]);
  });
});
