import { BigNumber } from 'ethers';
import { LocalSignedData, SignedData, AirnodeAddress, DataStore, TemplateId } from '../types';
import { logger } from '../logger';
import { verifySignedData } from '../signed-api-fetch/data-fetcher';

const signedApiStore: Record<AirnodeAddress, Record<TemplateId, LocalSignedData>> = {};

const setStoreDataPoint = async ({ airnode, templateId, signature, timestamp, encodedValue }: SignedData) => {
  if (!verifySignedData({ airnode, templateId, signature, timestamp, encodedValue })) {
    logger.warn(`Signed data received from signed data API has a signature mismatch.`);
    logger.warn(JSON.stringify({ airnode, templateId, signature, timestamp, encodedValue }, null, 2));
    return;
  }

  if (!signedApiStore[airnode]) {
    signedApiStore[airnode] = {};
  }

  signedApiStore[airnode]![templateId] = { signature, timestamp, encodedValue };
  logger.debug(
    `Storing sample for (Airnode ${airnode}) (Template ID ${templateId}) (Timestamp ${new Date(
      parseInt(timestamp) * 1_000
    ).toLocaleDateString()}), ${BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8}`
  );
};

const getStoreDataPoint = async (airnode: AirnodeAddress, templateId: TemplateId) =>
  (signedApiStore[airnode] ?? {})[templateId];

export const localDataStore: DataStore = {
  getStoreDataPoint,
  setStoreDataPoint,
};
