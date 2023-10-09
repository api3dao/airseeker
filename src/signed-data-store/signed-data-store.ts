import { clearInterval } from 'timers';
import { LocalSignedData, SignedData, AirnodeAddress, DataStore, TemplateId } from '../types';
import { logger } from '../logger';
import { verifySignedData } from '../signed-api-fetch/data-fetcher';

// A simple in-memory data store implementation - the interface allows for swapping in a remote key/value store

const signedApiStore: Record<AirnodeAddress, Record<TemplateId, LocalSignedData>> = {};
let pruner: NodeJS.Timeout | undefined;

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
  // logger.debug(
  //   `Storing sample for (Airnode ${airnode}) (Template ID ${templateId}) (Timestamp ${new Date(
  //     parseInt(timestamp) * 1_000
  //   ).toLocaleDateString()}), ${BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8}`
  // );
};

const getStoreDataPoint = async (airnode: AirnodeAddress, templateId: TemplateId) =>
  (signedApiStore[airnode] ?? {})[templateId];

const prune = async () => {
  Object.keys(signedApiStore).forEach((airnodeAddress) => {
    Object.keys(signedApiStore[airnodeAddress] ?? {}).forEach((templateId) => {
      const { timestamp } = (signedApiStore[airnodeAddress] ?? {})[templateId] ?? {};

      if (timestamp && Date.now() - parseInt(timestamp) > 24 * 60 * 60) {
        // timestamps are in s, not ms
        // the datapoint is more than 24 hours old
        delete (signedApiStore[airnodeAddress] ?? {})[templateId];
      }
    });
  });
};

const init = async () => {
  pruner = setInterval(prune, 300_000);
};

const shutdown = async () => {
  clearInterval(pruner);
};

export const localDataStore: DataStore = {
  getStoreDataPoint,
  setStoreDataPoint,
  init,
  shutdown,
  prune,
};
