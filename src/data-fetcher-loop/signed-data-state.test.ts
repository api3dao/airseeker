import { deriveBeaconId, type Hex } from '@api3/commons';
import { ethers } from 'ethers';

import { initializeState } from '../../test/fixtures/mock-config';
import { allowPartial, createMockSignedDataVerifier, generateRandomBytes, signData } from '../../test/utils';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { SignedData } from '../types';

import * as signedDataStateModule from './signed-data-state';
import * as signedDataVerifierPoolModule from './signed-data-verifier-pool';

describe(signedDataStateModule.saveSignedData.name, () => {
  let validSignedData: SignedData;
  const signer = ethers.Wallet.fromPhrase('test test test test test test test test test test test junk');

  beforeAll(async () => {
    initializeState();
    const templateId = generateRandomBytes(32);
    const timestamp = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000).toString();
    const airnode = signer.address as Hex;
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [1n]);

    validSignedData = {
      airnode,
      encodedValue,
      templateId,
      timestamp,
      signature: await signData(signer, templateId, timestamp, encodedValue),
    };
  });

  it('stores signed data', async () => {
    jest.spyOn(signedDataStateModule, 'isSignedDataFresh').mockReturnValue(true);
    jest.spyOn(signedDataVerifierPoolModule, 'getVerifier').mockResolvedValue(createMockSignedDataVerifier());
    const beaconId = deriveBeaconId(validSignedData.airnode, validSignedData.templateId) as Hex;

    await signedDataStateModule.saveSignedData([[beaconId, validSignedData]], false);

    const signedData = signedDataStateModule.getSignedData(beaconId);

    expect(signedData).toStrictEqual(validSignedData);
  });

  it('does not store signed data that is older than already stored one', async () => {
    const beaconId = deriveBeaconId(validSignedData.airnode, validSignedData.templateId) as Hex;
    const timestamp = String(Number(validSignedData.timestamp) + 10); // 10s newer.
    const storedSignedData = {
      ...validSignedData,
      timestamp,
      signature: await signData(signer, validSignedData.templateId, timestamp, validSignedData.encodedValue),
    };
    updateState((draft) => {
      draft.signedDatas[beaconId] = storedSignedData;
    });
    jest.spyOn(logger, 'debug');

    await signedDataStateModule.saveSignedData([[beaconId, validSignedData]], false);

    expect(signedDataStateModule.getSignedData(beaconId)).toStrictEqual(storedSignedData);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      'Skipping state update. The signed data value is not fresher than the stored value.'
    );
  });

  it('does not accept signed data that is too far in the future', async () => {
    const templateId = generateRandomBytes(32);
    const timestamp = Math.floor((Date.now() + 61 * 60 * 1000) / 1000).toString();
    const airnode = signer.address as Hex;
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [1n]);
    const futureSignedData = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
    const beaconId = deriveBeaconId(airnode, templateId) as Hex;
    jest.spyOn(signedDataVerifierPoolModule, 'getVerifier').mockResolvedValue(createMockSignedDataVerifier());
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'error');

    await signedDataStateModule.saveSignedData([[beaconId, futureSignedData]], false);

    expect(signedDataStateModule.getSignedData(beaconId)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Refusing to store sample as timestamp is more than one hour in the future.',
      expect.any(Object)
    );
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });

  it('accepts signed data that is less then 1h in the future', async () => {
    const templateId = generateRandomBytes(32);
    const timestamp = Math.floor((Date.now() + 30 * 60 * 1000) / 1000).toString();
    const airnode = signer.address as Hex;
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [1n]);
    const futureSignedData = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
    const beaconId = deriveBeaconId(airnode, templateId) as Hex;
    jest.spyOn(signedDataVerifierPoolModule, 'getVerifier').mockResolvedValue(createMockSignedDataVerifier());
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'error');

    await signedDataStateModule.saveSignedData([[beaconId, futureSignedData]], false);

    expect(signedDataStateModule.getSignedData(deriveBeaconId(airnode, templateId) as Hex)).toStrictEqual(
      futureSignedData
    );
    expect(logger.error).toHaveBeenCalledTimes(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Sample is in the future, but by less than an hour, therefore storing anyway.',
      expect.any(Object)
    );
  });

  it('checks the signature on signed data', async () => {
    const templateId = generateRandomBytes(32);
    const timestamp = Math.floor((Date.now() - 0.5 * 1000) / 1000).toString();
    const airnode = ethers.Wallet.createRandom().address as Hex;
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [1n]);
    jest.spyOn(signedDataVerifierPoolModule, 'getVerifier').mockResolvedValue(createMockSignedDataVerifier());
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'error');

    const badSignedData = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
    const beaconId = deriveBeaconId(airnode, templateId) as Hex;

    await signedDataStateModule.saveSignedData([[beaconId, badSignedData]], false);

    expect(signedDataStateModule.getSignedData(deriveBeaconId(airnode, templateId) as Hex)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Failed to verify signed data.', badSignedData);
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });

  it('only verifies the signed data for untrusted APIs', async () => {
    const templateId = generateRandomBytes(32);
    const airnode = ethers.Wallet.createRandom().address as Hex;
    jest.spyOn(signedDataVerifierPoolModule, 'getVerifier').mockResolvedValue(createMockSignedDataVerifier());
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'error');
    const beaconId = deriveBeaconId(airnode, templateId) as Hex;

    // First save data for trusted API and expect it to be saved without verification.
    await signedDataStateModule.saveSignedData([[beaconId, validSignedData]], true);

    expect(signedDataVerifierPoolModule.getVerifier).not.toHaveBeenCalled();

    // Then save data for untrusted API and expect it to be verified.
    const timestamp = Math.floor((Date.now() - 30 * 60 * 1000) / 1000).toString();
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [123n]);
    const otherSignedData = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
    await signedDataStateModule.saveSignedData([[beaconId, otherSignedData]], false);

    expect(signedDataVerifierPoolModule.getVerifier).toHaveBeenCalledTimes(1);
  });
});

describe(signedDataStateModule.purgeOldSignedData.name, () => {
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
