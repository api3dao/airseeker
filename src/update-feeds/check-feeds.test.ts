import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { allowPartial } from '../../test/utils';
import { logger } from '../logger';
import * as signedDataStore from '../signed-data-store/signed-data-store';
import { updateState } from '../state';
import type { BeaconId, SignedData } from '../types';

import * as contractUtils from './api3-server-v1';
import { multicallBeaconValues, getUpdatableFeeds } from './check-feeds';
import * as checkFeedsModule from './check-feeds';
import type { ReadDapiWithIndexResponse } from './dapi-data-registry';

const chainId = '31337';
const rpcUrl = 'http://127.0.0.1:8545/';
const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
  chainId: Number.parseInt(chainId, 10),
  name: chainId,
});

// https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L132
const encodeBeaconValue = (numericValue: string) => {
  const numericValueAsBigNumber = ethers.BigNumber.from(numericValue);

  return ethers.utils.defaultAbiCoder.encode(['int256'], [numericValueAsBigNumber]);
};

describe('getUpdatableFeeds', () => {
  const feedIds = [
    '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
    '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
    '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
  ] as const;

  beforeEach(() => {
    initializeState();
    updateState((draft) => {
      draft.signedApiStore = allowPartial<Record<BeaconId, SignedData>>({
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

    const callAndParseMulticallPromise = await multicallBeaconValues(feedIds as unknown as string[], provider, '31337');

    expect(callAndParseMulticallPromise).toStrictEqual([
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

  it('returns updatable feeds when value exceeds the threshold', async () => {
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

    // Only the third feed will satisfy the timestamp check
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
    jest.spyOn(checkFeedsModule, 'multicallBeaconValues').mockResolvedValue(multicallResult);
    jest.spyOn(logger, 'info');

    const batch = allowPartial<ReadDapiWithIndexResponse[]>([
      {
        updateParameters: { deviationThresholdInPercentage: ethers.BigNumber.from(1), heartbeatInterval: 100 },
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

    const checkFeedsResult = await getUpdatableFeeds(batch, 1, 'hardhat', provider, '31337');

    expect(logger.info).toHaveBeenCalledWith(`Deviation exceeded.`);
    expect(checkFeedsResult).toStrictEqual([
      {
        updatableBeacons: [
          expect.objectContaining({
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              encodedValue: '0x000000000000000000000000000000000000000000000000000000000000012c',
              timestamp: '200',
            },
          }),
        ],
        dapiInfo: {
          dapiName: 'test',
          dataFeedValue: {
            timestamp: 95,
            value: ethers.BigNumber.from('10'),
          },
          decodedDataFeed: {
            beacons: [
              expect.objectContaining({
                beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
              }),
              expect.objectContaining({
                beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
              }),
              expect.objectContaining({
                beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
              }),
            ],
            dataFeedId: '0x000',
          },
          updateParameters: {
            deviationThresholdInPercentage: ethers.BigNumber.from(1),
            heartbeatInterval: 100,
          },
        },
      },
    ]);
  });

  it('returns updatable feeds when on chain timestamp is older than heartbeat and value is within the deviation', async () => {
    jest.useFakeTimers().setSystemTime(500_000);

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
          value: ethers.BigNumber.from('400'),
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        onChainValue: {
          timestamp: ethers.BigNumber.from(170),
          value: ethers.BigNumber.from('400'),
        },
      },
    ];

    // Only the third feed will satisfy the timestamp check
    const mockSignedDataStore = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '101',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[2]]: {
        timestamp: '200',
        encodedValue: encodeBeaconValue('400'),
      },
    });

    const getStoreDataPointSpy = jest.spyOn(signedDataStore, 'getStoreDataPoint');
    getStoreDataPointSpy.mockImplementation((dataFeedId: string) => mockSignedDataStore[dataFeedId]!);

    // None of the feeds failed to update
    jest.spyOn(checkFeedsModule, 'multicallBeaconValues').mockResolvedValue(multicallResult);
    jest.spyOn(logger, 'info');

    const batch = allowPartial<ReadDapiWithIndexResponse[]>([
      {
        updateParameters: { deviationThresholdInPercentage: ethers.BigNumber.from(1), heartbeatInterval: 1 },
        dataFeedValue: {
          value: ethers.BigNumber.from(400),
          timestamp: 90,
        },
        decodedDataFeed: {
          dataFeedId: '0x000',
          beacons: [{ beaconId: feedIds[0] }, { beaconId: feedIds[1] }, { beaconId: feedIds[2] }],
        },
        dapiName: 'test',
      },
    ]);

    const checkFeedsResult = await getUpdatableFeeds(batch, 1, 'hardhat', provider, '31337');

    expect(logger.info).toHaveBeenCalledWith(`On-chain timestamp is older than the heartbeat interval.`);
    expect(checkFeedsResult).toStrictEqual([
      {
        updatableBeacons: [
          expect.objectContaining({
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          }),
        ],
        dapiInfo: {
          dapiName: 'test',
          dataFeedValue: {
            timestamp: 90,
            value: ethers.BigNumber.from('400'),
          },
          decodedDataFeed: {
            beacons: [
              expect.objectContaining({
                beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
              }),
              expect.objectContaining({
                beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
              }),
              expect.objectContaining({
                beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
              }),
            ],
            dataFeedId: '0x000',
          },
          updateParameters: {
            deviationThresholdInPercentage: ethers.BigNumber.from(1),
            heartbeatInterval: 1,
          },
        },
      },
    ]);
  });

  it('returns an empty array for old fulfillment data', async () => {
    jest.useFakeTimers().setSystemTime(150);

    // Ensure on-chain values don't trigger an update
    const multicallResult = [
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        onChainValue: {
          timestamp: ethers.BigNumber.from(150),
          value: ethers.BigNumber.from('200'),
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        onChainValue: {
          timestamp: ethers.BigNumber.from(160),
          value: ethers.BigNumber.from('200'),
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        onChainValue: {
          timestamp: ethers.BigNumber.from(170),
          value: ethers.BigNumber.from('200'),
        },
      },
    ];

    // Mock signed data store to have stale data
    const mockSignedDataStore = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '101',
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[2]]: {
        timestamp: '200',
        encodedValue: encodeBeaconValue('200'),
      },
    });

    const getStoreDataPointSpy = jest.spyOn(signedDataStore, 'getStoreDataPoint');
    getStoreDataPointSpy.mockImplementation((dataFeedId: string) => mockSignedDataStore[dataFeedId]!);

    // Set up batch with on-chain values that don't trigger an update
    const batch = allowPartial<ReadDapiWithIndexResponse[]>([
      {
        updateParameters: { deviationThresholdInPercentage: ethers.BigNumber.from(1), heartbeatInterval: 100 },
        dataFeedValue: {
          value: ethers.BigNumber.from(200),
          timestamp: 160,
        },
        decodedDataFeed: {
          dataFeedId: '0x000',
          beacons: [{ beaconId: feedIds[0] }, { beaconId: feedIds[1] }, { beaconId: feedIds[2] }],
        },
        dapiName: 'test',
      },
    ]);

    jest.spyOn(checkFeedsModule, 'multicallBeaconValues').mockResolvedValue(multicallResult);
    jest.spyOn(logger, 'warn');

    const checkFeedsResult = await getUpdatableFeeds(batch, 1, 'hardhat', provider, '31337');

    expect(logger.warn).toHaveBeenCalledWith(`Off-chain sample's timestamp is older than on-chain timestamp.`);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it('returns an empty array for on chain data newer than heartbeat and value within the threshold', async () => {
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
          value: ethers.BigNumber.from('400'),
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        onChainValue: {
          timestamp: ethers.BigNumber.from(170),
          value: ethers.BigNumber.from('400'),
        },
      },
    ];

    // Only the third feed will satisfy the timestamp check
    const mockSignedDataStore = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '101',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[2]]: {
        timestamp: '200',
        encodedValue: encodeBeaconValue('400'),
      },
    });

    const getStoreDataPointSpy = jest.spyOn(signedDataStore, 'getStoreDataPoint');
    getStoreDataPointSpy.mockImplementation((dataFeedId: string) => mockSignedDataStore[dataFeedId]!);

    // None of the feeds failed to update
    jest.spyOn(checkFeedsModule, 'multicallBeaconValues').mockResolvedValue(multicallResult);
    jest.spyOn(logger, 'info');

    const batch = allowPartial<ReadDapiWithIndexResponse[]>([
      {
        updateParameters: { deviationThresholdInPercentage: ethers.BigNumber.from(1), heartbeatInterval: 100 },
        dataFeedValue: {
          value: ethers.BigNumber.from(400),
          timestamp: 140,
        },
        decodedDataFeed: {
          dataFeedId: '0x000',
          beacons: [{ beaconId: feedIds[0] }, { beaconId: feedIds[1] }, { beaconId: feedIds[2] }],
        },
        dapiName: 'test',
      },
    ]);

    const checkFeedsResult = await getUpdatableFeeds(batch, 1, 'hardhat', provider, '31337');

    expect(logger.info).not.toHaveBeenCalledWith(`Deviation exceeded.`);
    expect(logger.info).not.toHaveBeenCalledWith(`On-chain timestamp is older than the heartbeat interval.`);
    expect(checkFeedsResult).toStrictEqual([]);
  });
});
