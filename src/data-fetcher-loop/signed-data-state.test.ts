import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { allowPartial, generateRandomBytes, signData } from '../../test/utils';
import { getState, updateState } from '../state';
import type { SignedData } from '../types';
import { deriveBeaconId } from '../utils';

import * as signedDataStateModule from './signed-data-state';

describe('signed data state', () => {
  let testDataPoint: SignedData;
  const signer = ethers.Wallet.fromPhrase('test test test test test test test test test test test junk');

  beforeAll(async () => {
    initializeState();
    const templateId = generateRandomBytes(32);
    const timestamp = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [BigInt(1)]);

    testDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
  });

  it('stores and gets a data point', () => {
    jest.spyOn(signedDataStateModule, 'isSignedDataFresh').mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const promisedStorage = signedDataStateModule.saveSignedData(testDataPoint);
    expect(promisedStorage).toBeFalsy();

    const dataFeedId = deriveBeaconId(testDataPoint.airnode, testDataPoint.templateId)!;
    const datapoint = signedDataStateModule.getSignedData(dataFeedId);

    expect(datapoint).toStrictEqual(testDataPoint);
  });

  it('checks that the timestamp on signed data is not in the future', async () => {
    const templateId = generateRandomBytes(32);
    const timestamp = Math.floor((Date.now() + 61 * 60 * 1000) / 1000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [BigInt(1)]);

    const futureTestDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };

    expect(signedDataStateModule.verifySignedDataIntegrity(testDataPoint)).toBeTruthy();
    expect(signedDataStateModule.verifySignedDataIntegrity(futureTestDataPoint)).toBeFalsy();
  });

  it('checks the signature on signed data', async () => {
    const templateId = generateRandomBytes(32);
    const timestamp = Math.floor((Date.now() + 60 * 60 * 1000) / 1000).toString();
    const airnode = ethers.Wallet.createRandom().address;
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [BigInt(1)]);

    const badTestDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };

    expect(signedDataStateModule.verifySignedDataIntegrity(badTestDataPoint)).toBeFalsy();
  });

  it('purges old data from the state', () => {
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

    signedDataStateModule.purgeOldSignedData();

    expect(Object.values(getState().signedDatas)).toStrictEqual([
      {
        timestamp: (baseTime / 1000 - 23 * 60 * 60).toString(),
      },
    ]);
  });
});
