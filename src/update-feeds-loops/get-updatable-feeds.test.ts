import { ethers } from 'ethers';
import { range } from 'lodash';

import { allowPartial } from '../../test/utils';
import { HUNDRED_PERCENT } from '../constants';
import * as signedDataStateModule from '../data-fetcher-loop/signed-data-state';
import { calculateMedian } from '../deviation-check';
import { logger } from '../logger';
import type { SignedData } from '../types';
import { encodeDapiName } from '../utils';

import type * as contractsModule from './contracts';
import { getUpdatableFeeds } from './get-updatable-feeds';

const ONE_PERCENT = BigInt(Number(HUNDRED_PERCENT) / 100);

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
  it('returns updatable feeds when value exceeds the threshold', () => {
    jest.useFakeTimers().setSystemTime(90 * 1000);

    // Only the second and third feed will satisfy the timestamp check
    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '101',
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[1]]: {
        timestamp: '165',
        encodedValue: encodeBeaconValue('250'),
      },
      [feedIds[2]]: {
        timestamp: '175',
        encodedValue: encodeBeaconValue('300'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n, 160n, 170n];
    const values = [400n, 500n, 600n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: calculateMedian(values),
        dataFeedTimestamp: calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(`Deviation exceeded.`);
    expect(checkFeedsResult).toHaveLength(1);
    expect(checkFeedsResult[0]!.updatableBeacons).toStrictEqual([
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        signedData: {
          encodedValue: '0x00000000000000000000000000000000000000000000000000000000000000fa',
          timestamp: '165',
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        signedData: {
          encodedValue: '0x000000000000000000000000000000000000000000000000000000000000012c',
          timestamp: '175',
        },
      },
    ]);
  });

  it('returns updatable feeds when on chain timestamp is older than heartbeat and value is within the deviation', () => {
    jest.useFakeTimers().setSystemTime(200 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '400',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[1]]: {
        timestamp: '500',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[2]]: {
        timestamp: '600',
        encodedValue: encodeBeaconValue('400'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n, 160n, 170n];
    const values = [400n, 400n, 400n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 1n,
          deviationReference: 0n,
        },
        dataFeedValue: calculateMedian(values),
        dataFeedTimestamp: calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(`On-chain timestamp is older than the heartbeat interval.`);
    expect(checkFeedsResult).toHaveLength(1);
    expect(checkFeedsResult[0]!.updatableBeacons).toStrictEqual([
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        signedData: {
          encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
          timestamp: '400',
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        signedData: {
          encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
          timestamp: '500',
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        signedData: {
          encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
          timestamp: '600',
        },
      },
    ]);
  });

  it('returns an empty array for old fulfillment data', () => {
    jest.useFakeTimers().setSystemTime(150 * 1000);

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
    const timestamps = [150n, 160n, 170n];
    const values = [200n, 200n, 200n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: calculateMedian(values),
        dataFeedTimestamp: calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);
    jest.spyOn(logger, 'warn');

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.warn).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it('returns an empty array for on chain data newer than heartbeat and value within the threshold', () => {
    jest.useFakeTimers().setSystemTime(90 * 1000);

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

    const timestamps = [150n, 160n, 170n];
    const values = [400n, 400n, 400n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: calculateMedian(values),
        dataFeedTimestamp: calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.info).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it('does not update beacon feed if the off-chain value is not newer', () => {
    jest.useFakeTimers().setSystemTime(90 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('200'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n];
    const values = [200n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedTimestamp: calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.info).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it("does not update beacon set if it won't cause on-chain update", () => {
    jest.useFakeTimers().setSystemTime(500 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '110', // Changed by 10 compared to the on-chain value
        encodedValue: encodeBeaconValue('210'), // Changed by 10 compared to the on-chain value
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('300'),
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

    const timestamps = [150n, 160n, 170n];
    const values = [300n, 300n, 300n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: calculateMedian(values),
        dataFeedTimestamp: calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.info).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it("updates a beacon set even if it's timestamp doesn't change, but the value does", () => {
    jest.useFakeTimers().setSystemTime(300 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '150', // Changed by 50 compared to the on-chain value
        encodedValue: encodeBeaconValue('350'), // Changed by 150 compared to the on-chain value
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('300'),
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

    const timestamps = [100n, 150n, 200n];
    const values = [200n, 300n, 400n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: calculateMedian(values),
        dataFeedTimestamp: calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(`Deviation exceeded.`);
    expect(checkFeedsResult).toStrictEqual([
      {
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
              timestamp: 100n,
              value: 200n,
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
              timestamp: 150n,
              value: 300n,
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
              timestamp: 200n,
              value: 400n,
            },
          ],
          dapiName: '0x7465737400000000000000000000000000000000000000000000000000000000',
          dataFeedId: '0x000',
          dataFeedTimestamp: 150n,
          dataFeedValue: 300n,
          decodedUpdateParameters: {
            deviationReference: 0n,
            deviationThresholdInPercentage: ONE_PERCENT,
            heartbeatInterval: 100n,
          },
        },
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            signedData: {
              encodedValue: '0x000000000000000000000000000000000000000000000000000000000000015e',
              timestamp: '150',
            },
          },
        ],
      },
    ]);
  });
});
