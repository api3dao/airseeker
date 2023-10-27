import { goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { logger } from '../logger';
import type { LocalSignedData, SignedData, AirnodeAddress, TemplateId } from '../types';

// A simple in-memory data store implementation - the interface allows for swapping in a remote key/value store
let signedApiStore: Record<AirnodeAddress, Record<TemplateId, LocalSignedData>> = {};

export const verifySignedData = ({ airnode, templateId, timestamp, signature, encodedValue }: SignedData) => {
  // Verification is wrapped in goSync, because ethers methods can potentially throw on invalid input.
  const goVerify = goSync(() => {
    const message = ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, encodedValue])
    );

    const signerAddr = ethers.utils.verifyMessage(message, signature);
    if (signerAddr !== airnode) throw new Error('Signer address does not match');
  });

  if (!goVerify.success) {
    logger.error(`Signature verification failed`, {
      airnode,
      templateId,
      signature,
      timestamp,
      encodedValue,
    });
    return false;
  }

  return true;
};

const verifyTimestamp = ({ timestamp, airnode, templateId }: SignedData) => {
  if (Number.parseInt(timestamp, 10) * 1000 > Date.now() + 60 * 60 * 1000) {
    logger.error(`Refusing to store sample as timestamp is more than one hour in the future.`, {
      airnode,
      templateId,
      systemDateNow: new Date().toLocaleDateString(),
      signedDataDate: new Date(Number.parseInt(timestamp, 10) * 1000).toLocaleDateString(),
    });
    return false;
  }

  if (Number.parseInt(timestamp, 10) * 1000 > Date.now()) {
    logger.warn(`Sample is in the future, but by less than an hour, therefore storing anyway.`, {
      airnode,
      templateId,
      systemDateNow: new Date().toLocaleDateString(),
      signedDataDate: new Date(Number.parseInt(timestamp, 10) * 1000).toLocaleDateString(),
    });
  }

  return true;
};

export const verifySignedDataIntegrity = (signedData: SignedData) => {
  return verifyTimestamp(signedData) && verifySignedData(signedData);
};

export const setStoreDataPoint = (signedData: SignedData) => {
  const { airnode, templateId, signature, timestamp, encodedValue } = signedData;

  if (!verifySignedDataIntegrity(signedData)) {
    return;
  }

  if (!signedApiStore[airnode]) {
    signedApiStore[airnode] = {};
  }

  const existingValue = signedApiStore[airnode]![templateId];
  if (existingValue && existingValue.timestamp >= timestamp) {
    logger.debug('Skipping store update. The existing store value is fresher.');
    return;
  }

  logger.debug(`Storing signed data`, {
    airnode,
    templateId,
    timestamp,
    signature,
    encodedValue,
  });
  signedApiStore[airnode]![templateId] = { signature, timestamp, encodedValue };
};

export const getStoreDataPoint = (airnode: AirnodeAddress, templateId: TemplateId) =>
  signedApiStore[airnode]?.[templateId];

export const clear = () => {
  signedApiStore = {};
};