import { deriveBeaconId } from '@api3/commons';
import { goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';

import type { SignedData, SignedDataRecordEntry } from '../types';

// The function is supposed to be run from inside a worker thread. It validates a batch of signed data and a whole batch
// is rejected if there is even a single invalid signed data.
//
// If the verification is successful, the function returns `true`. Otherwise, returns the signed data that caused the
// validation to fail.
export const verifySignedData = (signedDataBatch: SignedDataRecordEntry[]): SignedData | true => {
  for (const [beaconId, signedData] of signedDataBatch) {
    const { airnode, templateId, timestamp, encodedValue, signature } = signedData;

    // Verification is wrapped in goSync, because ethers methods can potentially throw on invalid input.
    const goVerifySignature = goSync(() => {
      const message = ethers.getBytes(
        ethers.solidityPackedKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, encodedValue])
      );

      const signerAddress = ethers.verifyMessage(message, signature);
      if (signerAddress !== airnode) throw new Error('Signer address does not match');
    });
    if (!goVerifySignature.success) return signedData;

    const goVerifyBeaconId = goSync(() => {
      const derivedBeaconId = deriveBeaconId(airnode, templateId);
      if (derivedBeaconId !== beaconId) throw new Error('Beacon ID does not match');
    });
    if (!goVerifyBeaconId.success) return signedData;
  }

  return true;
};
