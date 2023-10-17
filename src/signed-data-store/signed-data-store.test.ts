import { BigNumber, ethers } from 'ethers';
import * as localDataStore from './signed-data-store';
import { checkSignedDataIntegrity } from './signed-data-store';
import { SignedData } from '../types';
import { generateRandomBytes32, getTestSigner, signData } from '../utils';

describe('datastore', () => {
  let testDataPoint: SignedData;

  beforeAll(async () => {
    const signer = getTestSigner();
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() - 25 * 60 * 60 * 1_000) / 1_000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [BigNumber.from(1)]);

    testDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, airnode, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
  });

  beforeEach(localDataStore.clear);

  it('stores and gets a data point', async () => {
    const promisedStorage = localDataStore.setStoreDataPoint(testDataPoint);
    await expect(promisedStorage).resolves.toBeFalsy();

    const datapoint = localDataStore.getStoreDataPoint(testDataPoint.airnode, testDataPoint.templateId);

    const { encodedValue, signature, timestamp } = testDataPoint;

    await expect(datapoint).resolves.toEqual({ encodedValue, signature, timestamp });
  });

  it('prunes old data', async () => {
    const promisedStorage = localDataStore.setStoreDataPoint(testDataPoint);
    await expect(promisedStorage).resolves.toBeFalsy();

    await localDataStore.prune();

    const datapoint = localDataStore.getStoreDataPoint(testDataPoint.airnode, testDataPoint.templateId);

    await expect(datapoint).resolves.toBeUndefined();
  });

  it('checks that the timestamp on signed data is not in the future', async () => {
    const signer = getTestSigner();
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() + 61 * 60 * 1_000) / 1_000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [BigNumber.from(1)]);

    const futureTestDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, airnode, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };

    expect(checkSignedDataIntegrity(testDataPoint)).toBeTruthy();
    expect(checkSignedDataIntegrity(futureTestDataPoint)).toBeFalsy();
  });

  it('checks the signature on signed data', async () => {
    const signer = getTestSigner();
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() + 60 * 60 * 1_000) / 1_000).toString();
    const airnode = ethers.Wallet.createRandom().address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [BigNumber.from(1)]);

    const badTestDataPoint = {
      airnode,
      encodedValue,
      signature: await signData(signer, airnode, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };

    expect(checkSignedDataIntegrity(badTestDataPoint)).toBeFalsy();
  });
});
