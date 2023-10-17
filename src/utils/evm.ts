import { BigNumber, ethers } from 'ethers';
import { SignedData } from '../types';
import { verifySignedData } from '../signed-data-store';
import { logger } from '../logger';

export const benchmark = async () => {
  const signer = getTestSigner();
  const templateId = generateRandomBytes32();
  const timestamp = Math.floor((Date.now() - 25 * 60 * 60 * 1_000) / 1_000).toString();
  const airnode = signer.address;
  const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [BigNumber.from(1)]);
  const signature = await signData(signer, airnode, templateId, timestamp, encodedValue);

  const datapoint: SignedData = {
    airnode,
    encodedValue,
    signature,
    timestamp,
    templateId,
  };

  const iterations = 100_000;
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    verifySignedData(datapoint);
  }
  const end = Date.now();
  const durationMs = end - start;

  logger.info('Benchmark duration in seconds:', durationMs / 1_000);
  logger.info('Duration per iteration: ', (end - start) / 1_000 / iterations);
  logger.info('Throughput per second: ', 1_000 / ((end - start) / iterations));
};

export const getTestSigner = () =>
  ethers.Wallet.fromMnemonic('test test test test test test test test test test test junk');

export const signData = (signer: ethers.Signer, airnode: string, templateId: string, timestamp: string, data: string) =>
  signer.signMessage(
    ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data])
    )
  );

export const generateRandomBytes32 = () => ethers.utils.hexlify(ethers.utils.randomBytes(32));

if (require.main === module) {
  benchmark().catch((error) => {
    // eslint-disable-next-line no-console
    console.trace(error);
    process.exit(1);
  });
}
