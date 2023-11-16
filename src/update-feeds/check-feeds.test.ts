import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { allowPartial } from '../../test/utils';
import * as signedDataStore from '../signed-data-store/signed-data-store';
import { updateState } from '../state';
import type { DataFeedId, SignedData } from '../types';

import * as contractUtils from './api3-server-v1';
import { callAndParseMulticall, checkFeeds } from './check-feeds';
import * as checkFeedsModule from './check-feeds';
import type { ReadDapiWithIndexResponse } from './dapi-data-registry';

// https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L132
const encodeBeaconValue = (numericValue: string) => {
  const numericValueAsBigNumber = ethers.BigNumber.from(numericValue);

  return ethers.utils.defaultAbiCoder.encode(['int256'], [numericValueAsBigNumber]);
};

describe('checkFeeds', () => {
  const feedIds = [
    '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
    '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
    '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
  ] as const;

  beforeEach(() => {
    initializeState();
    updateState((draft) => {
      draft.signedApiStore = allowPartial<Record<DataFeedId, SignedData>>({
        '0x000a': { timestamp: '100', encodedValue: encodeBeaconValue('200') },
        '0x000b': { timestamp: '150', encodedValue: encodeBeaconValue('250') },
        '0x000c': { timestamp: '200', encodedValue: encodeBeaconValue('300') },
      });
    });
  });

  it('calls and parses a multicall', async () => {
    const tryMulticallMock = jest.fn().mockReturnValue({
      successes: [true, true, true],
      returndata: [
        ethers.utils.defaultAbiCoder.encode(['int224', 'uint32'], [100, 105]),
        ethers.utils.defaultAbiCoder.encode(['int224', 'uint32'], [101, 106]),
        ethers.utils.defaultAbiCoder.encode(['int224', 'uint32'], [102, 107]),
      ],
    });

    const encodeFunctionDataMock = jest.fn();
    encodeFunctionDataMock.mockReturnValueOnce('0xfirst');
    encodeFunctionDataMock.mockReturnValueOnce('0xsecond');
    encodeFunctionDataMock.mockReturnValueOnce('0xthird');

    const mockContract = {
      connect: jest.fn().mockReturnValue({
        callStatic: {
          tryMulticall: tryMulticallMock,
        },
      }),
      interface: { encodeFunctionData: encodeFunctionDataMock },
    };

    jest.spyOn(contractUtils, 'getApi3ServerV1').mockReturnValue(mockContract as any);

    const callAndParseMulticallPromise = callAndParseMulticall(feedIds as unknown as string[], 'hardhat', '31337');

    await expect(callAndParseMulticallPromise).resolves.toStrictEqual([
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        onChainValue: {
          timestamp: ethers.BigNumber.from(105),
          value: ethers.BigNumber.from(100),
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        onChainValue: {
          timestamp: ethers.BigNumber.from(106),
          value: ethers.BigNumber.from(101),
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        onChainValue: {
          timestamp: ethers.BigNumber.from(107),
          value: ethers.BigNumber.from(102),
        },
      },
    ]);
    expect(tryMulticallMock).toHaveBeenCalledWith(['0xfirst', '0xsecond', '0xthird']);
  });

  it('returns updatable feeds', async () => {
    jest.useFakeTimers().setSystemTime(90);

    const multicallResult = [
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        onChainValue: {
          timestamp: ethers.BigNumber.from(150),
          value: ethers.BigNumber.from('400'),
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        onChainValue: {
          timestamp: ethers.BigNumber.from(160),
          value: ethers.BigNumber.from('500'),
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        onChainValue: {
          timestamp: ethers.BigNumber.from(170),
          value: ethers.BigNumber.from('600'),
        },
      },
    ];

    const mockSignedDataStore = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '101',
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('250'),
      },
      [feedIds[2]]: {
        timestamp: '200',
        encodedValue: encodeBeaconValue('300'),
      },
    });

    const getStoreDataPointSpy = jest.spyOn(signedDataStore, 'getStoreDataPoint');
    getStoreDataPointSpy.mockImplementation((dataFeedId: string) => mockSignedDataStore[dataFeedId]!);

    // None of the feeds failed to update
    jest.spyOn(checkFeedsModule, 'callAndParseMulticall').mockResolvedValue(multicallResult);

    const batch = allowPartial<ReadDapiWithIndexResponse[]>([
      {
        updateParameters: { deviationThresholdInPercentage: ethers.BigNumber.from(1) },
        dataFeedValue: {
          value: ethers.BigNumber.from(10),
          timestamp: 95,
        },
        decodedDataFeed: {
          dataFeedId: '0x000',
          beacons: [{ beaconId: feedIds[0] }, { beaconId: feedIds[1] }, { beaconId: feedIds[2] }],
        },
        dapiName: 'test',
      },
    ]);

    const checkFeedsResult = checkFeeds(batch, 1, 'hardhat', '31337');

    await expect(checkFeedsResult).resolves.toStrictEqual([
      {
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              encodedValue: '0x000000000000000000000000000000000000000000000000000000000000012c',
              timestamp: '200',
            },
          },
        ],
        dapiInfo: {
          dapiName: 'test',
          dataFeedValue: {
            timestamp: 95,
            value: ethers.BigNumber.from('10'),
          },
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
            dataFeedId: '0x000',
          },
          updateParameters: {
            deviationThresholdInPercentage: ethers.BigNumber.from(1),
          },
        },
      },
    ]);
  });
});
