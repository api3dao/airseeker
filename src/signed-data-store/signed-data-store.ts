import { BigNumber, ethers } from 'ethers';
import { logger } from '../logger';
import type { LocalSignedData, SignedData, AirnodeAddress, TemplateId } from '../types';

// A simple in-memory data store implementation - the interface allows for swapping in a remote key/value store
let signedApiStore: Record<AirnodeAddress, Record<TemplateId, LocalSignedData>> = {};

export const verifySignedData = ({ airnode, templateId, timestamp, signature, encodedValue }: SignedData) => {
  // 'encodedValue' is: ethers.utils.defaultAbiCoder.encode(['int256'], [beaconValue]);

  const message = ethers.utils.arrayify(
    ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, encodedValue])
  );

  const signerAddr = ethers.utils.verifyMessage(message, signature);
  return signerAddr !== airnode;
};

const verifyTimestamp = ({ timestamp, airnode, encodedValue, templateId }: SignedData) => {
  if (Number.parseInt(timestamp, 10) * 1000 > Date.now() + 60 * 60 * 1000) {
    logger.warn(`Refusing to store sample as timestamp is more than one hour in the future.`, {
      airnode,
      templateId,
      systemDateNow: new Date().toLocaleDateString(),
      signedDataDate: new Date(Number.parseInt(timestamp, 10) * 1000).toLocaleDateString(),
    });
    return false;
  }

  if (Number.parseInt(timestamp, 10) * 1000 > Date.now()) {
    logger.warn(
      `Sample is in the future, but by less than an hour, therefore storing anyway: (Airnode ${airnode}) (Template ID ${templateId}) (Received timestamp ${new Date(
        Number.parseInt(timestamp, 10) * 1000
      ).toLocaleDateString()} vs now ${new Date().toLocaleDateString()}), ${
        BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8
      }`
    );
  }

  return true;
};

export const verifySignedDataIntegrity = (signedData: SignedData) => {
  const { airnode, templateId, timestamp, encodedValue } = signedData;

  if (!verifyTimestamp(signedData)) {
    return false;
  }

  if (verifySignedData(signedData)) {
    logger.warn(
      `Refusing to store sample as signature does not match: (Airnode ${airnode}) (Template ID ${templateId}) (Received timestamp ${new Date(
        Number.parseInt(timestamp, 10) * 1000
      ).toLocaleDateString()} vs now ${new Date().toLocaleDateString()}), ${
        BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8
      }`
    );
    return false;
  }

  return true;
};

export const setStoreDataPoint = (signedData: SignedData) => {
  const { airnode, templateId, signature, timestamp, encodedValue } = signedData;

  if (!verifySignedDataIntegrity(signedData)) {
    logger.warn(`Signed data received from signed data API has a signature mismatch.`);
    logger.warn(JSON.stringify({ airnode, templateId, signature, timestamp, encodedValue }, null, 2));
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

  logger.debug(
    `Storing sample for (Airnode ${airnode}) (Template ID ${templateId}) (Timestamp ${new Date(
      Number.parseInt(timestamp, 10) * 1000
    ).toISOString()}), ${BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8}`
  );

  signedApiStore[airnode]![templateId] = { signature, timestamp, encodedValue };
};

export const getStoreDataPoint = (airnode: AirnodeAddress, templateId: TemplateId) =>
  signedApiStore[airnode]?.[templateId];

// eslint-disable-next-line @typescript-eslint/require-await
export const clear = () => {
  signedApiStore = {};
};
