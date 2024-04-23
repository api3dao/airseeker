import type { Hex } from '@api3/commons';
import { ethers } from 'ethers';

import type { WalletDerivationScheme } from './config/schema';
import { AIRSEEKER_PROTOCOL_ID, INT224_MAX, INT224_MIN } from './constants';

export const abs = (n: bigint) => (n < 0n ? -n : n);

export const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const encodeDapiName = (decodedDapiName: string) => ethers.encodeBytes32String(decodedDapiName) as Hex;

export const decodeDapiName = (encodedDapiName: string) => ethers.decodeBytes32String(encodedDapiName);

export function deriveWalletPathFromSponsorAddress(sponsorAddress: string) {
  const sponsorAddressBN = BigInt(sponsorAddress);
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN >> BigInt(31 * i);
    paths.push((shiftedSponsorAddressBN % 2n ** 31n).toString());
  }
  return `${AIRSEEKER_PROTOCOL_ID}/${paths.join('/')}`;
}

export const deriveSponsorAddressHashForManagedFeed = (dapiNameOrDataFeedId: string) => {
  // Hashing the dAPI name is important because we need to take the first 20 bytes of the hash which could result in
  // collisions for (encoded) dAPI names with the same prefix.
  return ethers.keccak256(dapiNameOrDataFeedId);
};

export const deriveSponsorAddressHashForSelfFundedFeed = (dapiNameOrDataFeedId: string, updateParameters: string) => {
  return ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes'], [dapiNameOrDataFeedId, updateParameters]));
};

export const deriveSponsorWalletFromSponsorAddressHash = (
  sponsorWalletMnemonic: string,
  sponsorAddressHash: string
) => {
  // Take the first 20 bytes of the sponsor address hash + "0x" prefix.
  const sponsorAddress = ethers.getAddress(sponsorAddressHash.slice(0, 42));
  // NOTE: Be sure not to use "ethers.Wallet.fromPhrase(sponsorWalletMnemonic).derivePath" because that produces a
  // different result.
  const sponsorWallet = ethers.HDNodeWallet.fromPhrase(
    sponsorWalletMnemonic,
    undefined,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress)}`
  );

  return sponsorWallet;
};

export const deriveSponsorWallet = (
  sponsorWalletMnemonic: string,
  dapiNameOrDataFeedId: string,
  updateParameters: string,
  walletDerivationScheme: WalletDerivationScheme
) => {
  // Derive the sponsor address hash, whose first 20 bytes are interpreted as the sponsor address. This address is used
  // to derive the sponsor wallet.
  //
  // For self-funded feeds it's more suitable to derive the hash also from update parameters. This does not apply to
  // mananaged feeds which want to be funded by the same wallet independently of the update parameters.
  const sponsorAddressHash =
    walletDerivationScheme.type === 'self-funded'
      ? deriveSponsorAddressHashForSelfFundedFeed(dapiNameOrDataFeedId, updateParameters)
      : deriveSponsorAddressHashForManagedFeed(dapiNameOrDataFeedId);

  return deriveSponsorWalletFromSponsorAddressHash(sponsorWalletMnemonic, sponsorAddressHash);
};

export const multiplyBigNumber = (bigNumber: bigint, multiplier: number) =>
  (bigNumber * BigInt(Math.round(multiplier * 100))) / 100n;

// https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L132
export const decodeBeaconValue = (encodedBeaconValue: string) => {
  const decodedBeaconValue = BigInt(ethers.AbiCoder.defaultAbiCoder().decode(['int256'], encodedBeaconValue)[0]);
  if (decodedBeaconValue > INT224_MAX || decodedBeaconValue < INT224_MIN) {
    return null;
  }

  return decodedBeaconValue;
};
