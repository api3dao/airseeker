import { type Wallet, ethers } from 'ethers';

import type { SignedData, Beacon } from '../src/types';

export const signData = async (signer: ethers.Signer, templateId: string, timestamp: string, data: string) =>
  signer.signMessage(
    ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data])
    )
  );

export const generateRandomBytes32 = () => ethers.utils.hexlify(ethers.utils.randomBytes(32));

export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/**
 * A helper functions which accepts a deeply partial object and casts it to a given (non-partial) type. This makes it
 * convenient to create a mocked data object with properties that are only used for the given test.
 */
export const allowPartial = <T = unknown>(obj: DeepPartial<T>): T => obj as T;

export const encodeBeaconFeed = (dataFeed: Beacon) =>
  ethers.utils.defaultAbiCoder.encode(['address', 'bytes32'], [dataFeed.airnodeAddress, dataFeed.templateId]);

export const encodeBeaconFeedSet = (dataFeed: Beacon[]) =>
  ethers.utils.defaultAbiCoder.encode(
    ['address[]', 'bytes32[]'],
    [dataFeed.map((item) => item.airnodeAddress), dataFeed.map((item) => item.templateId)]
  );
export const getUnixTimestamp = (dateString: string) => Math.floor(Date.parse(dateString) / 1000);

export const generateSignedData = async (
  airnodeWallet: Wallet,
  templateId: string,
  dataFeedTimestamp: string,
  apiValue = ethers.BigNumber.from(ethers.utils.randomBytes(Math.floor(Math.random() * 27) + 1)) // Fits into uint224.
): Promise<SignedData> => {
  const encodedValue = ethers.utils.defaultAbiCoder.encode(['uint224'], [ethers.BigNumber.from(apiValue)]);
  const signature = await signData(airnodeWallet, templateId, dataFeedTimestamp, encodedValue);

  return { airnode: airnodeWallet.address, templateId, timestamp: dataFeedTimestamp, encodedValue, signature };
};

export const createDummyBeaconUpdateData = async (dummyAirnode: ethers.Wallet = ethers.Wallet.createRandom()) => {
  const dummyBeaconTemplateId = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const dummyBeaconTimestamp = Math.floor(Date.now() / 1000);
  const randomBytes = ethers.utils.randomBytes(Math.floor(Math.random() * 27) + 1);
  const dummyBeaconData = ethers.utils.defaultAbiCoder.encode(
    ['int224'],
    // Any random number that fits into an int224
    [ethers.BigNumber.from(randomBytes)]
  );
  const dummyBeaconSignature = await dummyAirnode.signMessage(
    ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(
        ['bytes32', 'uint256', 'bytes'],
        [dummyBeaconTemplateId, dummyBeaconTimestamp, dummyBeaconData]
      )
    )
  );
  return { dummyAirnode, dummyBeaconTemplateId, dummyBeaconTimestamp, dummyBeaconData, dummyBeaconSignature };
};
