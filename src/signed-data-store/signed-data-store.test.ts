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

  it('gets prunes old data', async () => {
    const promisedStorage = localDataStore.setStoreDataPoint({
      airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c418A',
      encodedValue: '0x1',
      signature: '0x321',
      templateId: '0x123',
      timestamp: Math.floor((Date.now() - 25 * 60 * 60 * 1_000) / 1_000).toString(),
    });
    await expect(promisedStorage).resolves.toBeFalsy();

    await localDataStore.prune();

    const datapoint = localDataStore.getStoreDataPoint('0xC04575A2773Da9Cd23853A69694e02111b2c418A', '0x123');

    await expect(datapoint).resolves.toBeUndefined();
  });
});
