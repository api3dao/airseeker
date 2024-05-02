import { type Hex, deriveBeaconId } from '@api3/commons';
import { goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';
import workerpool from 'workerpool';

import type { SignedData } from '../types';

// The function is supposed to be run from inside a worker thread. It validates a batch of signed data and a whole batch
// is rejected if there is even a single invalid signed data.
//
// If the verification is successful, the function returns an array of beacon IDs for each signed data. Otherwise,
// returns the signed data that caused the validation to fail.
export const verifySignedData = (signedDataBatch: SignedData[]): Hex[] | SignedData => {
  const beaconIds: Hex[] = [];
  for (const signedData of signedDataBatch) {
    const { airnode, templateId, timestamp, encodedValue, signature } = signedData;

    // Verification is wrapped in goSync, because ethers methods can potentially throw on invalid input.
    const goVerifySignature = goSync(() => {
      const message = ethers.getBytes(
        ethers.solidityPackedKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, encodedValue])
      );

      const signerAddr = ethers.verifyMessage(message, signature);
      if (signerAddr !== airnode) throw new Error('Signer address does not match');
    });
    if (!goVerifySignature.success) return signedData;

    beaconIds.push(deriveBeaconId(airnode, templateId) as Hex);
  }

  return beaconIds;
};

// Create a worker from this module and register public functions.
workerpool.worker({
  verifySignedData,
});
