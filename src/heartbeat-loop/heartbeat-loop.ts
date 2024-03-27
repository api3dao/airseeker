import { createSha256Hash, serializePlainObject } from '@api3/commons';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { loadRawConfig } from '../config';
import { HEARTBEAT_LOG_MESSAGE } from '../constants';
import { logger } from '../logger';
import { getState } from '../state';

import { heartbeatLogger } from './logger';

export const startHeartbeatLoop = () => {
  logger.info('Initiating heartbeat loop.');

  setInterval(async () => {
    const goLogHeartbeat = await go(logHeartbeat);
    if (!goLogHeartbeat.success) logger.error('Failed to log heartbeat.', goLogHeartbeat.error);
  }, 1000 * 60); // Frequency is hardcoded to 1 minute.
};

export interface HeartbeatPayload {
  currentTimestamp: string;
  configHash: string;
  signature: string;
  stage: string;
  version: string;
  deploymentTimestamp: string;
}

export const logHeartbeat = async () => {
  logger.debug('Creating heartbeat log.');

  const rawConfig = loadRawConfig(); // We want to log the raw config, not the one with interpolated secrets.
  const configHash = createSha256Hash(serializePlainObject(rawConfig));
  const {
    config: { sponsorWalletMnemonic, stage, version },
    deploymentTimestamp,
  } = getState();

  logger.debug('Creating heartbeat payload.');
  const currentTimestamp = Math.floor(Date.now() / 1000).toString();
  const unsignedHeartbeatPayload = {
    currentTimestamp,
    configHash,
    stage,
    version,
    deploymentTimestamp,
  };
  const sponsorWallet = ethers.Wallet.fromPhrase(sponsorWalletMnemonic);
  const signature = await signHeartbeat(sponsorWallet, unsignedHeartbeatPayload);
  const heartbeatPayload: HeartbeatPayload = { ...unsignedHeartbeatPayload, signature };

  heartbeatLogger.info(HEARTBEAT_LOG_MESSAGE, heartbeatPayload);
};

export const signHeartbeat = async (
  sponsorWallet: ethers.HDNodeWallet,
  unsignedHeartbeatPayload: Omit<HeartbeatPayload, 'signature'>
) => {
  logger.debug('Signing heartbeat payload.');
  const messageToSign = ethers.getBytes(createSha256Hash(serializePlainObject(unsignedHeartbeatPayload)));
  return sponsorWallet.signMessage(messageToSign);
};
