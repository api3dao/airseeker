import { BigNumber, ethers } from 'ethers';
import { localDataStore } from './signed-data-store';

describe('datastore', () => {
  const timestamp = Math.floor(Date.now() / 1_000).toString();

  it('stores a data point', async () => {
    const promisedStorage = localDataStore.setStoreDataPoint({
      airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c418A',
      encodedValue: '0x1',
      signature: '0x321',
      templateId: '0x123',
      timestamp,
    });
    await expect(promisedStorage).resolves.toBeFalsy();
  });

  it('gets a data point', async () => {
    const promisedStorage = localDataStore.setStoreDataPoint({
      airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c418A',
      encodedValue: '0x1',
      signature: '0x321',
      templateId: '0x123',
      timestamp,
    });
    await expect(promisedStorage).resolves.toBeFalsy();

    const datapoint = localDataStore.getStoreDataPoint('0xC04575A2773Da9Cd23853A69694e02111b2c418A', '0x123');

    await expect(datapoint).resolves.toEqual({
      encodedValue: '0x1',
      signature: '0x321',
      timestamp,
    });
  });

  it('prunes old data', async () => {
    const signer = getSigner();
    const templateId = generateRandomBytes32();
    const timestamp = Math.floor((Date.now() - 25 * 60 * 60 * 1_000) / 1_000).toString();
    const airnode = signer.address;
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int256'], [BigNumber.from(1)]);

    const promisedStorage = localDataStore.setStoreDataPoint({
      airnode,
      encodedValue,
      signature: await signData(airnode, templateId, timestamp, encodedValue),
      templateId,
      timestamp,
    });
    await expect(promisedStorage).resolves.toBeFalsy();

    await localDataStore.prune();

    const datapoint = localDataStore.getStoreDataPoint(airnode, templateId);

    await expect(datapoint).resolves.toBeUndefined();
  });
});

const getSigner = () => ethers.Wallet.fromMnemonic('test test test test test test test test test test test junk');

const signData = async (airnode: string, templateId: string, timestamp: string, data: string) => {
  const signer = getSigner();

  return signer.signMessage(
    ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data])
    )
  );
};

const generateRandomBytes32 = () => ethers.utils.hexlify(ethers.utils.randomBytes(32));
