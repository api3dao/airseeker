import type { KeycardWallet } from 'keycard-manager';

import { loadConfig } from './config';

let keycardWallet: KeycardWallet | undefined;

export const initializeKeycardWallet = async () => {
  const { walletDerivationScheme } = loadConfig();
  if (walletDerivationScheme.type !== 'keycard') {
    throw new Error('Wallet derivation scheme is not keycard. This function should not be called.');
  }

  if (keycardWallet) return;

  // Do not import at the top level to avoid loading keycard-manager when not needed
  keycardWallet = await (await import('keycard-manager')).getKeycardWallet(undefined, walletDerivationScheme.pin); // eslint-disable-line
};

export const getKeycardWallet = () => {
  if (keycardWallet) return keycardWallet;

  throw new Error('Keycard wallet is not initialized.');
};
