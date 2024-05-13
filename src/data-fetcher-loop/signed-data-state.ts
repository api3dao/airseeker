import type { Hex } from '@api3/commons';

import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { SignedData, SignedDataRecordEntry } from '../types';

import { getVerifier } from './signed-data-verifier-pool';

const verifyTimestamp = ([beaconId, signedData]: SignedDataRecordEntry) => {
  const { airnode, templateId, timestamp } = signedData;

  // Check that the signed data is fresher than the one stored in state.
  const timestampMs = Number(timestamp) * 1000;
  const storedValue = getState().signedDatas[beaconId];
  if (storedValue && Number(storedValue.timestamp) * 1000 >= timestampMs) {
    logger.debug('Skipping state update. The signed data value is not fresher than the stored value.');
    return false;
  }

  // Verify the timestamp of the signed data.
  const nowMs = Date.now();
  if (timestampMs > nowMs + 60 * 60 * 1000) {
    logger.error(`Refusing to store sample as timestamp is more than one hour in the future.`, {
      airnode,
      templateId,
      timestampMs,
      nowMs,
    });
    return false;
  }
  if (timestampMs > nowMs) {
    logger.warn(`Sample is in the future, but by less than an hour, therefore storing anyway.`, {
      airnode,
      templateId,
      timestampMs,
      nowMs,
    });
  }

  return true;
};

export const saveSignedData = async (signedDataBatch: SignedDataRecordEntry[]) => {
  // Filter out signed data with invalid timestamps or we already have a fresher signed data stored in state.
  signedDataBatch = signedDataBatch.filter((signedDataEntry) => verifyTimestamp(signedDataEntry));
  if (signedDataBatch.length === 0) return;

  const verifier = await getVerifier();
  // We are skipping the whole batch even if there is only one invalid signed data. This is consistent with the Signed
  // API approach.
  const verificationResult = await verifier.verifySignedData(signedDataBatch);
  if (verificationResult !== true) {
    logger.error('Failed to verify signed data.', verificationResult);
    return;
  }
  updateState((draft) => {
    for (const [beaconId, signedData] of signedDataBatch) {
      draft.signedDatas[beaconId] = signedData;
    }
  });

  return signedDataBatch.length;
};

export const getSignedData = (beaconId: Hex) => getState().signedDatas[beaconId];

export const isSignedDataFresh = (signedData: SignedData) =>
  BigInt(signedData.timestamp) > BigInt(Math.ceil(Date.now() / 1000 - 24 * 60 * 60));

export const purgeOldSignedData = () => {
  const state = getState();
  const oldSignedData = Object.values(state.signedDatas).filter((signedData) => isSignedDataFresh(signedData!));
  if (oldSignedData.length > 0) {
    logger.debug(`Purging some old signed data.`, { oldSignedData });
  }

  updateState((draft) => {
    draft.signedDatas = Object.fromEntries(
      Object.entries(draft.signedDatas).filter(([_beaconId, signedData]) => isSignedDataFresh(signedData!))
    );
  });
};
