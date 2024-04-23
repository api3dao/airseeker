import { type Hex, deriveBeaconId } from '@api3/commons';
import { goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { SignedData } from '../types';

export const verifySignedData = ({ airnode, templateId, timestamp, signature, encodedValue }: SignedData) => {
  // Verification is wrapped in goSync, because ethers methods can potentially throw on invalid input.
  const goVerify = goSync(() => {
    const message = ethers.getBytes(
      ethers.solidityPackedKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, encodedValue])
    );

    const signerAddr = ethers.verifyMessage(message, signature);
    if (signerAddr !== airnode) throw new Error('Signer address does not match');
  });

  if (!goVerify.success) {
    logger.error(`Signature verification failed.`, {
      signature,
      timestamp,
      encodedValue,
    });
    return false;
  }

  return true;
};

const verifyTimestamp = (timestamp: number) => {
  const timestampMs = timestamp * 1000;

  if (timestampMs > Date.now() + 60 * 60 * 1000) {
    logger.error(`Refusing to store sample as timestamp is more than one hour in the future.`, {
      systemDateNow: new Date().toLocaleDateString(),
      signedDataDate: new Date(timestampMs).toLocaleDateString(),
    });
    return false;
  }

  if (timestampMs > Date.now()) {
    logger.warn(`Sample is in the future, but by less than an hour, therefore storing anyway.`, {
      systemDateNow: new Date().toLocaleDateString(),
      signedDataDate: new Date(timestampMs).toLocaleDateString(),
    });
  }

  return true;
};

export const verifySignedDataIntegrity = (signedData: SignedData) => {
  return verifyTimestamp(Number.parseInt(signedData.timestamp, 10)) && verifySignedData(signedData);
};

export const saveSignedData = (signedData: SignedData) => {
  const { airnode, templateId, timestamp } = signedData;

  // Make sure we run the verification checks with enough context.
  logger.runWithContext({ airnode, templateId }, () => {
    if (!verifySignedDataIntegrity(signedData)) {
      return;
    }

    const state = getState();

    const dataFeedId = deriveBeaconId(airnode, templateId) as Hex;

    const existingValue = state.signedDatas[dataFeedId];
    if (existingValue && existingValue.timestamp >= timestamp) {
      logger.debug('Skipping state update. The signed data value is not fresher than the stored value.');
      return;
    }

    updateState((draft) => {
      draft.signedDatas[dataFeedId] = signedData;
    });
  });
};

export const getSignedData = (dataFeedId: Hex) => getState().signedDatas[dataFeedId];

export const isSignedDataFresh = (signedData: SignedData) =>
  BigInt(signedData.timestamp) > BigInt(Math.ceil(Date.now() / 1000 - 24 * 60 * 60));

export const purgeOldSignedData = () => {
  const state = getState();
  const oldSignedData = Object.values(state.signedDatas).filter((signedData) => isSignedDataFresh(signedData));
  if (oldSignedData.length > 0) {
    logger.debug(`Purging some old signed data.`, { oldSignedData });
  }

  updateState((draft) => {
    draft.signedDatas = Object.fromEntries(
      Object.entries(draft.signedDatas).filter(([_dataFeedId, signedData]) => isSignedDataFresh(signedData))
    );
  });
};
