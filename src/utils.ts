import { goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { AIRSEEKER_PROTOCOL_ID } from './constants';

export const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function deriveBeaconId(airnodeAddress: string, templateId: string) {
  return goSync(() => ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnodeAddress, templateId])).data;
}

export function deriveBeaconSetId(beaconIds: string[]) {
  return goSync(() => ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds]))).data;
}

export function deriveWalletPathFromSponsorAddress(sponsorAddress: string) {
  const sponsorAddressBN = ethers.BigNumber.from(sponsorAddress);
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `${AIRSEEKER_PROTOCOL_ID}/${paths.join('/')}`;
}

export const deriveSponsorWallet = (sponsorWalletMnemonic: string, dapiName: string) => {
  // Take first 20 bytes of dapiName as sponsor address together with the "0x" prefix.
  const sponsorAddress = ethers.utils.getAddress(dapiName.slice(0, 42));
  const sponsorWallet = ethers.Wallet.fromMnemonic(
    sponsorWalletMnemonic,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress)}`
  );

  return sponsorWallet;
};

export const multiplyBigNumber = (bigNumber: ethers.BigNumber, multiplier: number) =>
  bigNumber.mul(ethers.BigNumber.from(Math.round(multiplier * 100))).div(ethers.BigNumber.from(100));
