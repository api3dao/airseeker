import { deriveBeaconId, type Hex } from '@api3/commons';
import { ethers } from 'ethers';
import type { Pool } from 'workerpool';

import { initializeState } from '../../test/fixtures/mock-config';
import { allowPartial, generateRandomBytes, signData } from '../../test/utils';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { SignedData } from '../types';

import * as signedDataStateModule from './signed-data-state';
import { initializeVerifierPool } from './signed-data-verifier-pool';

describe('signed data state', () => {
  let validSignedData: SignedData;
  let pool: Pool;
  const signer = ethers.Wallet.fromPhrase('test test test test test test test test test test test junk');

  beforeAll(async () => {
    initializeState();
    pool = initializeVerifierPool();
    const templateId = generateRandomBytes(32);
    const timestamp = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000).toString();
    const airnode = signer.address as Hex;
    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [1n]);

    validSignedData = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };
  });

  afterAll(async () => {
    await pool.terminate();
  });

  it('stores and gets a data point', async () => {
    jest.spyOn(signedDataStateModule, 'isSignedDataFresh').mockReturnValue(true);
    const dataFeedId = deriveBeaconId(validSignedData.airnode, validSignedData.templateId) as Hex;

    await signedDataStateModule.saveSignedData([validSignedData]);
    const signedData = signedDataStateModule.getSignedData(dataFeedId);

    expect(signedData).toStrictEqual(validSignedData);
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
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'error');

    await signedDataStateModule.saveSignedData([futureSignedData]);

    expect(signedDataStateModule.getSignedData(deriveBeaconId(airnode, templateId) as Hex)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Refusing to store sample as timestamp is more than one hour in the future.',
      expect.any(Object)
    );
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });

  it('accepts signed data that is a bit in the future', async () => {
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
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'error');

    await signedDataStateModule.saveSignedData([futureSignedData]);

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
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'error');

    const badSignedData = {
      airnode,
      encodedValue,
      signature: await signData(signer, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    };

    await signedDataStateModule.saveSignedData([badSignedData]);

    expect(signedDataStateModule.getSignedData(deriveBeaconId(airnode, templateId) as Hex)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Failed to verify signed data.', badSignedData);
    expect(logger.warn).toHaveBeenCalledTimes(0);
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
