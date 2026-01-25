import type { KeycardWallet } from 'keycard-manager';

import { loadConfig } from './config';

let keycardWallet: KeycardWallet | undefined;

export const initializeKeycardWallet = async () => {
  if (keycardWallet) {
    throw new Error('Keycard wallet is already initialized.');
  }

  const { walletDerivationScheme } = loadConfig();
  if (walletDerivationScheme.type !== 'keycard') {
    throw new Error('Wallet derivation scheme is not keycard. This function should not be called.');
  }

  // Dynamic import to avoid loading keycard-manager when not needed
  const { getKeycardWallet: createKeycardWallet } = await import('keycard-manager');
  keycardWallet = await createKeycardWallet(undefined, walletDerivationScheme.pin);
};

export const terminateKeycardWallet = () => {
  // Idempotent - safe to call even if the keycard wallet was never initialized
  if (!keycardWallet) return;

  keycardWallet.disconnect();
  keycardWallet = undefined;
};

export const getKeycardWallet = () => {
  if (keycardWallet) return keycardWallet;

  throw new Error('Keycard wallet is not initialized.');
};
