import { deriveWalletPathFromSponsorAddress, type Address, type Hex } from '@api3/commons';
import { ethers, type ErrorCode, type EthersError } from 'ethers';

import { AIRSEEKER_PROTOCOL_ID, INT224_MAX, INT224_MIN } from './constants';
import type { ManagedParams, SelfFundedParams, SponsorParams } from './types';

export const abs = (n: bigint) => (n < 0n ? -n : n);

export const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const encodeDapiName = (decodedDapiName: string) => ethers.encodeBytes32String(decodedDapiName) as Hex;

export const decodeDapiName = (encodedDapiName: string) => ethers.decodeBytes32String(encodedDapiName);

export const getAddressFromHash = (hash: Hex) => ethers.getAddress(hash.slice(0, 42)) as Address;

export const deriveSponsorAddressForManagedFeed = (dapiNameOrDataFeedId: string) => {
  // Hashing the dAPI name is important because we need to take the first 20 bytes of the hash which could result in
  // collisions for (encoded) dAPI names with the same prefix.
  return getAddressFromHash(ethers.keccak256(dapiNameOrDataFeedId) as Hex);
};

export const deriveSponsorAddressForSelfFundedFeed = (dapiNameOrDataFeedId: string, updateParameters: string) => {
  return getAddressFromHash(
    ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes'], [dapiNameOrDataFeedId, updateParameters])) as Hex
  );
};

export const deriveSponsorWalletFromSponsorAddress = (sponsorWalletMnemonic: string, sponsorAddress: Address) => {
  // NOTE: Be sure not to use "ethers.Wallet.fromPhrase(sponsorWalletMnemonic).derivePath" because that produces a
  // different result.
  const sponsorWallet = ethers.HDNodeWallet.fromPhrase(
    sponsorWalletMnemonic,
    undefined,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress, AIRSEEKER_PROTOCOL_ID)}`
  );

  return sponsorWallet;
};

export const deriveSponsorAddress = (sponsorParams: SponsorParams) => {
  let sponsorAddress: Address;
  switch (sponsorParams.walletDerivationScheme.type) {
    case 'self-funded': {
      // Airseeker will derive a sponsor wallet for updating each dAPI name or data feed + update parameters combination.
      const { dapiNameOrDataFeedId, updateParameters } = sponsorParams as SelfFundedParams;
      sponsorAddress = deriveSponsorAddressForSelfFundedFeed(dapiNameOrDataFeedId, updateParameters);
      break;
    }
    case 'managed': {
      // Here it will derive a single sponsor wallet for updating  each dAPI name or data feed.
      const { dapiNameOrDataFeedId } = sponsorParams as ManagedParams;
      sponsorAddress = deriveSponsorAddressForManagedFeed(dapiNameOrDataFeedId);
      break;
    }
    case 'fixed': {
      // Here it will derive a single sponsor wallet for updating all dAPI names or data feeds.
      sponsorAddress = sponsorParams.walletDerivationScheme.sponsorAddress!;
      break;
    }
  }

  return sponsorAddress;
};

export const deriveSponsorWallet = (sponsorWalletMnemonic: string, sponsorParams: SponsorParams) => {
  const sponsorAddress: Address = deriveSponsorAddress(sponsorParams);
  return deriveSponsorWalletFromSponsorAddress(sponsorWalletMnemonic, sponsorAddress);
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

// eslint-disable-next-line functional/no-classes
class SanitizedErrorsError extends Error {
  public code: ErrorCode;

  public constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// Ethers error messages are sometimes serialized into huge strings containing the raw transaction bytes that is
// unnecessary. The serialized string is so big, that Grafana log forwarder needs to split the message into multiple
// parts (messing up with our log format). As a workaround, we pick the most useful properties from the error message.
export const sanitizeEthersError = (error: Error) => {
  const ethersError = error as EthersError;

  // We only care about ethers errors and they all should have a code.
  if (!ethersError.code) return error;

  // We don't care about the stack trace, nor error name - just the code and the message. According to the ethers
  // sources, the short message should always be defined.
  return new SanitizedErrorsError(ethersError.code, ethersError.shortMessage);
};
