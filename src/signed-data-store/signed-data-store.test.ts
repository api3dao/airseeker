import { BigNumber, ethers } from 'ethers';

import { generateRandomBytes32, signData } from '../../test/utils';
import type { SignedData } from '../types';

import { verifySignedDataIntegrity } from './signed-data-store';
import * as localDataStore from './signed-data-store';

describe('datastore', () => {
  let testDataPoint: SignedData;
  const signer = ethers.Wallet.fromMnemonic('test test test test test test test test test test test junk');

  beforeAll(async () => {
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [BigNumber.from(1)]);

    testDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
  });

  beforeEach(localDataStore.clear);

  it('stores and gets a data point', () => {
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const promisedStorage = localDataStore.setStoreDataPoint(testDataPoint);
    expect(promisedStorage).toBeFalsy();

    const datapoint = localDataStore.getStoreDataPoint(testDataPoint.airnode, testDataPoint.templateId);

    const { encodedValue, signature, timestamp } = testDataPoint;

    expect(datapoint).toStrictEqual({ encodedValue, signature, timestamp });
  });

  it('checks that the timestamp on signed data is not in the future', async () => {
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() + 61 * 60 * 1000) / 1000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [BigNumber.from(1)]);

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
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [BigNumber.from(1)]);

    const badTestDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };

    expect(verifySignedDataIntegrity(badTestDataPoint)).toBeFalsy();
  });
});
