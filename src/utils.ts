import { randomBytes } from 'node:crypto';

import { deriveWalletPathFromSponsorAddress, type Address, type Hex } from '@api3/commons';
import { ethers, type ErrorCode, type EthersError } from 'ethers';

import type { WalletDerivationScheme } from './config/schema';
import { AIRSEEKER_PROTOCOL_ID, INT224_MAX, INT224_MIN } from './constants';

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

export type SponsorAddressDerivationParams = WalletDerivationScheme & {
  updateParameters: string;
  dapiNameOrDataFeedId: string;
};

export const deriveSponsorAddress = (params: SponsorAddressDerivationParams) => {
  let sponsorAddress: Address;
  switch (params.type) {
    case 'self-funded': {
      // Airseeker will derive a sponsor wallet for updating each dAPI name or data feed + update parameters combination.
      const { dapiNameOrDataFeedId, updateParameters } = params;
      sponsorAddress = deriveSponsorAddressForSelfFundedFeed(dapiNameOrDataFeedId, updateParameters);
      break;
    }
    case 'managed': {
      // Here it will derive a single sponsor wallet for updating  each dAPI name or data feed.
      const { dapiNameOrDataFeedId } = params;
      sponsorAddress = deriveSponsorAddressForManagedFeed(dapiNameOrDataFeedId);
      break;
    }
    case 'fixed': {
      // Here it will derive a single sponsor wallet for updating all dAPI names or data feeds.
      sponsorAddress = params.sponsorAddress!;
      break;
    }
  }

  return sponsorAddress;
};

export const deriveSponsorWallet = (sponsorWalletMnemonic: string, sponsorParams: SponsorAddressDerivationParams) => {
  const sponsorAddress: Address = deriveSponsorAddress(sponsorParams);
  return deriveSponsorWalletFromSponsorAddress(sponsorWalletMnemonic, sponsorAddress);
};

export const multiplyBigNumber = (bigNumber: bigint, multiplier: number) =>
  (bigNumber * BigInt(Math.round(multiplier * 100))) / 100n;

// https://github.com/api3dao/contracts/blob/4592f5c4802f7cf2585884fc641a1e89937bfd9c/contracts/api3-server-v1/DataFeedServer.sol#L132
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
  const sanitizedError = new SanitizedErrorsError(ethersError.code, ethersError.shortMessage);
  // NOTE: We don't need the stack trace, because the errors are usually easy to find by the developer message and the
  // stack can be traced manually. This reduces the risk of the stack trace being too large and "exploding" the log
  // size.
  delete sanitizedError.stack;
  return sanitizedError;
};

export const generateRandomId = () => randomBytes(32).toString('hex');
