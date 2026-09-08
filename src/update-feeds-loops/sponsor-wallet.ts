import type { Hex } from '@api3/commons';
import { ethers } from 'ethers';

import { getKeycardWallet } from '../keycard';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import {
  deriveSponsorAddress,
  deriveSponsorWalletFromSponsorAddress,
  type SponsorAddressDerivationParams,
} from '../utils';

export const getDerivedSponsorWallet = (params: SponsorAddressDerivationParams) => {
  if (params.type === 'keycard') {
    return getKeycardWallet();
  }
  const { derivedSponsorWallets } = getState();
  const sponsorAddress = deriveSponsorAddress(params);
  const privateKey = derivedSponsorWallets?.[sponsorAddress];
  if (privateKey) {
    const sponsorWallet = new ethers.Wallet(privateKey);
    logger.debug('Found derived sponsor wallet.', { sponsorAddress, sponsorWalletAddress: sponsorWallet.address });
    return sponsorWallet;
  }
  const sponsorWallet = deriveSponsorWalletFromSponsorAddress(params.sponsorWalletMnemonic, sponsorAddress);
  logger.debug('Derived new sponsor wallet.', { sponsorAddress, sponsorWalletAddress: sponsorWallet.address });
  updateState((draft) => {
    draft.derivedSponsorWallets[sponsorAddress] = sponsorWallet.privateKey as Hex;
  });
  return sponsorWallet;
};
