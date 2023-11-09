import { ethers } from 'ethers';

import { init } from '../../test/fixtures/mock-config';
import { allowPartial } from '../../test/utils';
import type * as stateModule from '../state';

import * as contractUtils from './api3-server-v1';
import { callAndParseMulticall, shallowCheckFeeds } from './check-feeds';
import type { ReadDapiWithIndexResponse } from './dapi-data-registry';

// jest.mock('../state');

describe('checks whether feeds should be updated or not', () => {
  describe('shallow analysis', () => {
    it('reports an updatable feed as updatable', () => {
      init(
        allowPartial<stateModule.State>({
          signedApiStore: {
            '0x000a': { timestamp: '100', encodedValue: ethers.BigNumber.from(200).toHexString() },
            '0x000b': { timestamp: '150', encodedValue: ethers.BigNumber.from(250).toHexString() },
            '0x000c': { timestamp: '200', encodedValue: ethers.BigNumber.from(300).toHexString() },
          },
        })
      );

      const batch = allowPartial<ReadDapiWithIndexResponse[]>([
        {
          updateParameters: { deviationThresholdInPercentage: 2 },
          dataFeedValue: { value: ethers.BigNumber.from(1), timestamp: 1 },
          decodedDataFeed: {
            dataFeedId: '0x000',
            beacons: [{ dataFeedId: '0x000a' }, { dataFeedId: '0x000b' }, { dataFeedId: '0x000c' }],
          },
          dapiName: 'test',
        },
      ]);

      const result = shallowCheckFeeds(batch);

      expect(result).toHaveLength(1);
    });

    it('does not report a feed that should not be updated', () => {
      init(
        allowPartial<stateModule.State>({
          signedApiStore: {
            '0x000a': { timestamp: '100', encodedValue: ethers.BigNumber.from(200).toHexString() },
            '0x000b': { timestamp: '150', encodedValue: ethers.BigNumber.from(250).toHexString() },
            '0x000c': { timestamp: '200', encodedValue: ethers.BigNumber.from(300).toHexString() },
          },
        })
      );

      const batch = allowPartial<ReadDapiWithIndexResponse[]>([
        {
          updateParameters: { deviationThresholdInPercentage: 2 },
          dataFeedValue: { value: ethers.BigNumber.from(250), timestamp: 150 },
          decodedDataFeed: {
            dataFeedId: '0x000',
            beacons: [{ dataFeedId: '0x000a' }, { dataFeedId: '0x000b' }, { dataFeedId: '0x000c' }],
          },
          dapiName: 'test',
        },
      ]);

      const result = shallowCheckFeeds(batch);

      expect(result).toHaveLength(0);
    });
  });

  describe('deep analysis', () => {
    it('reports an updatable feed as updatable', async () => {
      init(
        allowPartial<stateModule.State>({
          signedApiStore: {
            '0x000a': { timestamp: '100', encodedValue: ethers.BigNumber.from(200).toHexString() },
            '0x000b': { timestamp: '150', encodedValue: ethers.BigNumber.from(250).toHexString() },
            '0x000c': { timestamp: '200', encodedValue: ethers.BigNumber.from(300).toHexString() },
          },
        })
      );

      const batch = allowPartial<ReadDapiWithIndexResponse[]>([
        {
          updateParameters: { deviationThresholdInPercentage: 2 },
          dataFeedValue: { value: ethers.BigNumber.from(1), timestamp: 1 },
          decodedDataFeed: {
            dataFeedId: '0x000',
            beacons: [
              { dataFeedId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6' },
              { dataFeedId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7' },
              { dataFeedId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8' },
            ],
          },
          dapiName: 'test',
        },
      ]);

      const mockContract = {
        connect: jest.fn().mockReturnValue({
          callStatic: {
            tryMulticall: jest.fn().mockReturnValue({
              successes: [true, true, true],
              returndata: [
                ethers.utils.defaultAbiCoder.encode(['int224', 'uint32'], [100, 105]),
                ethers.utils.defaultAbiCoder.encode(['int224', 'uint32'], [101, 106]),
                ethers.utils.defaultAbiCoder.encode(['int224', 'uint32'], [102, 107]),
              ],
            }),
          },
        }),
      };

      jest.spyOn(contractUtils, 'getApi3ServerV1').mockReturnValue(mockContract as any);

      const shallowFeedsToUpdate = shallowCheckFeeds(batch);

      const multicallPromise = await callAndParseMulticall(shallowFeedsToUpdate, 'hardhat', '31337');

      await expect(multicallPromise).resolves.toBe([]);
    });
  });
});
