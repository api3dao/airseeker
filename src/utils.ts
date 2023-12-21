import { goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { AIRSEEKER_PROTOCOL_ID, INT224_MAX, INT224_MIN } from './constants';

export const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function deriveBeaconId(airnodeAddress: string, templateId: string) {
  return goSync(() => ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnodeAddress, templateId])).data;
}

export function deriveBeaconSetId(beaconIds: string[]) {
  return goSync(() => ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds]))).data;
}

export const encodeDapiName = (decodedDapiName: string) => ethers.utils.formatBytes32String(decodedDapiName);

export const decodeDapiName = (encodedDapiName: string) => ethers.utils.parseBytes32String(encodedDapiName);

export function deriveWalletPathFromSponsorAddress(sponsorAddress: string) {
  const sponsorAddressBN = ethers.BigNumber.from(sponsorAddress);
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `${AIRSEEKER_PROTOCOL_ID}/${paths.join('/')}`;
}

export const deriveSponsorWallet = (sponsorWalletMnemonic: string, dapiNameOrDataFeedId: string) => {
  // Hash the dAPI name or data feed ID because we need to take the first 20 bytes of it which could result in
  // collisions for dAPIs with the same prefix.
  const hashedDapiNameOrDataFeedId = ethers.utils.keccak256(dapiNameOrDataFeedId);

  // Take first 20 bytes of the hashed dapiName or data feed ID as sponsor address together with the "0x" prefix.
  const sponsorAddress = ethers.utils.getAddress(hashedDapiNameOrDataFeedId.slice(0, 42));
  const sponsorWallet = ethers.Wallet.fromMnemonic(
    sponsorWalletMnemonic,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress)}`
  );

  return sponsorWallet;
};

export const multiplyBigNumber = (bigNumber: ethers.BigNumber, multiplier: number) =>
  bigNumber.mul(ethers.BigNumber.from(Math.round(multiplier * 100))).div(ethers.BigNumber.from(100));

// https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L132
export const decodeBeaconValue = (encodedBeaconValue: string) => {
  const decodedBeaconValue = ethers.BigNumber.from(
    ethers.utils.defaultAbiCoder.decode(['int256'], encodedBeaconValue)[0]
  );
  if (decodedBeaconValue.gt(INT224_MAX) || decodedBeaconValue.lt(INT224_MIN)) {
    return null;
  }

  return decodedBeaconValue;
};
