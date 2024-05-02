import type { Hex } from '@api3/commons';

import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { SignedData, SignedDataRecordEntry } from '../types';

import { getVerifier } from './signed-data-verifier-pool';

const verifyTimestamp = (signedData: SignedData) => {
  const { airnode, templateId, timestamp } = signedData;

  // Verify the timestamp of the signed data.
  const timestampMs = Number.parseInt(timestamp, 10) * 1000;
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
  // Filter out signed data with invalid timestamps.
  signedDataBatch = signedDataBatch.filter(([_, data]) => verifyTimestamp(data));
  if (signedDataBatch.length === 0) return;

  const verifier = await getVerifier();
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
};

export const getSignedData = (dataFeedId: Hex) => getState().signedDatas[dataFeedId];

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
      Object.entries(draft.signedDatas).filter(([_dataFeedId, signedData]) => isSignedDataFresh(signedData!))
    );
  });
};
