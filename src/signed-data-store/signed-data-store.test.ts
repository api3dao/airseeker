import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { allowPartial, generateRandomBytes32, signData } from '../../test/utils';
import { getState, updateState } from '../state';
import type { SignedData } from '../types';
import { deriveBeaconId } from '../utils';

import { purgeOldSignedData, verifySignedDataIntegrity } from './signed-data-store';
import * as localDataStore from './signed-data-store';

describe('datastore', () => {
  let testDataPoint: SignedData;
  const signer = ethers.Wallet.fromMnemonic('test test test test test test test test test test test junk');

  beforeAll(async () => {
    initializeState();
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [ethers.BigNumber.from(1)]);

    testDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
  });

  it('stores and gets a data point', () => {
    jest.spyOn(localDataStore, 'isSignedDataFresh').mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const promisedStorage = localDataStore.saveSignedData(testDataPoint);
    expect(promisedStorage).toBeFalsy();

    const dataFeedId = deriveBeaconId(testDataPoint.airnode, testDataPoint.templateId)!;
    const datapoint = localDataStore.getSignedData(dataFeedId);

    expect(datapoint).toStrictEqual(testDataPoint);
  });

  it('checks that the timestamp on signed data is not in the future', async () => {
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() + 61 * 60 * 1000) / 1000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [ethers.BigNumber.from(1)]);

    const futureTestDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };

    expect(verifySignedDataIntegrity(testDataPoint)).toBeTruthy();
    expect(verifySignedDataIntegrity(futureTestDataPoint)).toBeFalsy();
  });

  it('checks the signature on signed data', async () => {
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() + 60 * 60 * 1000) / 1000).toString();
    const airnode = ethers.Wallet.createRandom().address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [ethers.BigNumber.from(1)]);

    const badTestDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };

    expect(verifySignedDataIntegrity(badTestDataPoint)).toBeFalsy();
  });

  it('purges old data from the store', () => {
    const baseTime = 1_700_126_230_000;
    jest.useFakeTimers().setSystemTime(baseTime);

    initializeState();
    updateState((draft) => {
      draft.signedDatas['0x000'] = allowPartial<SignedData>({
        timestamp: (baseTime / 1000 - 25 * 60 * 60).toString(),
      });
      draft.signedDatas['0x001'] = allowPartial<SignedData>({
        timestamp: (baseTime / 1000 - 23 * 60 * 60).toString(),
      });
    });

    purgeOldSignedData();

    expect(Object.values(getState().signedDatas)).toStrictEqual([
      {
        timestamp: (baseTime / 1000 - 23 * 60 * 60).toString(),
      },
    ]);
  });
});
