import { ethers } from 'ethers';

export const signData = async (signer: ethers.Signer, templateId: string, timestamp: string, data: string) =>
  signer.signMessage(
    ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data])
    )
  );

export const generateRandomBytes32 = () => ethers.utils.hexlify(ethers.utils.randomBytes(32));
