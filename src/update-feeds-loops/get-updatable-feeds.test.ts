import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { allowPartial } from '../../test/utils';
import * as signedDataStateModule from '../data-fetcher-loop/signed-data-state';
import { logger } from '../logger';
import { updateState } from '../state';
import type { BeaconId, SignedData } from '../types';
import { encodeDapiName } from '../utils';

import type * as contractsModule from './contracts';
import { getUpdatableFeeds } from './get-updatable-feeds';

// https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L132
const encodeBeaconValue = (numericValue: string) => {
  const numericValueAsBigNumber = BigInt(numericValue);

  return ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [numericValueAsBigNumber]);
};

const feedIds = [
  '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
  '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
  '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
] as const;

describe(getUpdatableFeeds.name, () => {
  beforeEach(() => {
    initializeState();
    updateState((draft) => {
      draft.signedDatas = allowPartial<Record<BeaconId, SignedData>>({
        '0x000a': { timestamp: '100', encodedValue: encodeBeaconValue('200') },
        '0x000b': { timestamp: '150', encodedValue: encodeBeaconValue('250') },
        '0x000c': { timestamp: '200', encodedValue: encodeBeaconValue('300') },
      });
    });
  });

  it('returns updatable feeds when value exceeds the threshold', () => {
    jest.useFakeTimers().setSystemTime(90);

    // Only the third feed will satisfy the timestamp check
    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
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
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: 1n,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: 10n,
        dataFeedTimestamp: 95n,
        beaconsWithData: [
          { beaconId: feedIds[0], timestamp: BigInt(150), value: BigInt('400') },
          { beaconId: feedIds[1], timestamp: BigInt(160), value: BigInt('500') },
          { beaconId: feedIds[2], timestamp: BigInt(170), value: BigInt('600') },
        ],
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

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
        dataFeedInfo: {
          dapiName: encodeDapiName('test'),
          dataFeedId: '0x000',
          dataFeedValue: BigInt('10'),
          dataFeedTimestamp: 95n,
          beaconsWithData: [
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
          decodedUpdateParameters: {
            deviationThresholdInPercentage: 1n,
            heartbeatInterval: 100n,
            deviationReference: 0n,
          },
        },
      },
    ]);
  });

  it('returns updatable feeds when on chain timestamp is older than heartbeat and value is within the deviation', () => {
    jest.useFakeTimers().setSystemTime(500_000);

    // Only the third feed will satisfy the timestamp check
    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
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
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: 1n,
          heartbeatInterval: 1n,
        },
        dataFeedValue: 400n,
        dataFeedTimestamp: 90n,
        beaconsWithData: [
          { beaconId: feedIds[0], timestamp: BigInt(150), value: BigInt('400') },
          { beaconId: feedIds[1], timestamp: BigInt(160), value: BigInt('400') },
          { beaconId: feedIds[2], timestamp: BigInt(170), value: BigInt('400') },
        ],
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

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
        dataFeedInfo: {
          dapiName: encodeDapiName('test'),
          dataFeedId: '0x000',
          dataFeedValue: BigInt('400'),
          dataFeedTimestamp: 90n,
          beaconsWithData: [
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
          decodedUpdateParameters: {
            deviationThresholdInPercentage: 1n,
            heartbeatInterval: 1n,
          },
        },
      },
    ]);
  });

  it('returns an empty array for old fulfillment data', () => {
    jest.useFakeTimers().setSystemTime(150);

    // Mock signed data state to have stale data
    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
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
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);

    // Set up batch with on-chain values that don't trigger an update
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: 1n,
          heartbeatInterval: 100n,
        },
        dataFeedValue: 200n,
        dataFeedTimestamp: 160n,
        beaconsWithData: [
          { beaconId: feedIds[0], timestamp: BigInt(150), value: BigInt('200') },
          { beaconId: feedIds[1], timestamp: BigInt(155), value: BigInt('200') },
          { beaconId: feedIds[2], timestamp: BigInt(170), value: BigInt('200') },
        ],
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);
    jest.spyOn(logger, 'warn');

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.warn).toHaveBeenCalledWith(`Off-chain sample's timestamp is not newer than on-chain timestamp.`);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it('returns an empty array for on chain data newer than heartbeat and value within the threshold', () => {
    jest.useFakeTimers().setSystemTime(90);

    // Only the third feed will satisfy the timestamp check
    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
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
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: 1n,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: 400n,
        dataFeedTimestamp: 140n,
        beaconsWithData: [
          { beaconId: feedIds[0], timestamp: BigInt(150), value: BigInt('400') },
          { beaconId: feedIds[1], timestamp: BigInt(160), value: BigInt('400') },
          { beaconId: feedIds[2], timestamp: BigInt(170), value: BigInt('400') },
        ],
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.info).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });
});
