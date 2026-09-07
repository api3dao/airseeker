import { allowPartial } from '../../test/utils';
import * as stateModule from '../state';
import * as utilsModule from '../utils';

import { getDerivedSponsorWallet } from './sponsor-wallet';

describe(getDerivedSponsorWallet.name, () => {
  describe('managed feeds', () => {
    it('returns the derived sponsor wallet for a dAPI', () => {
      const dapiName = utilsModule.encodeDapiName('ETH/USD');
      const sponsorAddress = utilsModule.deriveSponsorAddressForManagedFeed(dapiName);
      jest.spyOn(stateModule, 'getState').mockReturnValue(
        allowPartial<stateModule.State>({
          derivedSponsorWallets: {
            [sponsorAddress]: '0x034e238bdc2622122e7b2191ee5be5df38597b6f58e45b25c6d32cae3110ebfa',
          },
        })
      );
      jest.spyOn(utilsModule, 'deriveSponsorWalletFromSponsorAddress');

      const sponsorWallet = getDerivedSponsorWallet({
        type: 'managed',
        dapiNameOrDataFeedId: dapiName,
        updateParameters: 'does-not-matter',
        sponsorWalletMnemonic: 'some-mnemonic',
      });

      expect(utilsModule.deriveSponsorWalletFromSponsorAddress).toHaveBeenCalledTimes(0);
      expect(sponsorWallet.privateKey).toBe('0x034e238bdc2622122e7b2191ee5be5df38597b6f58e45b25c6d32cae3110ebfa');
    });

    it('derives the sponsor wallet for a dAPI if it does not exist', () => {
      const dapiName = utilsModule.encodeDapiName('ETH/USD');
      jest.spyOn(stateModule, 'getState').mockReturnValue(
        allowPartial<stateModule.State>({
          derivedSponsorWallets: {},
        })
      );
      jest.spyOn(stateModule, 'updateState').mockImplementation();
      jest.spyOn(utilsModule, 'deriveSponsorWalletFromSponsorAddress');

      const sponsorWallet = getDerivedSponsorWallet({
        type: 'managed',
        dapiNameOrDataFeedId: dapiName,
        updateParameters: 'does-not-matter',
        sponsorWalletMnemonic: 'diamond result history offer forest diagram crop armed stumble orchard stage glance',
      });

      expect(utilsModule.deriveSponsorWalletFromSponsorAddress).toHaveBeenCalledTimes(1);
      expect(sponsorWallet.privateKey).toBe('0xd4cc2592775d876d6af59163bb7894272d84f538439e3c53af3bebdc0668b49d');
    });

    it('derives the sponsor wallet for a data feed ID if it does not exist', () => {
      jest.spyOn(stateModule, 'getState').mockReturnValue(
        allowPartial<stateModule.State>({
          derivedSponsorWallets: {},
        })
      );
      jest.spyOn(stateModule, 'updateState').mockImplementation();
      jest.spyOn(utilsModule, 'deriveSponsorWalletFromSponsorAddress');

      const sponsorWallet = getDerivedSponsorWallet({
        type: 'managed',
        dapiNameOrDataFeedId: '0x173ec7594911a9d584d577bc8e8b9bb546018667d820a67685df49201a11ae9b',
        updateParameters: 'does-not-matter',
        sponsorWalletMnemonic: 'diamond result history offer forest diagram crop armed stumble orchard stage glance',
      });

      expect(utilsModule.deriveSponsorWalletFromSponsorAddress).toHaveBeenCalledTimes(1);
      expect(sponsorWallet.privateKey).toBe('0x1a193892271d2a8c1e39b9d78281a9e7f8c080965dc3ed744eac7746c47b700e');
    });
  });

  describe('self-funded feeds', () => {
    it('derives the sponsor wallet for a dAPI if it does not exist', () => {
      const dapiName = utilsModule.encodeDapiName('ETH/USD');
      const updateParameters =
        '0x0000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000000000064';
      jest.spyOn(stateModule, 'getState').mockReturnValue(
        allowPartial<stateModule.State>({
          derivedSponsorWallets: {},
        })
      );
      jest.spyOn(stateModule, 'updateState').mockImplementation();
      jest.spyOn(utilsModule, 'deriveSponsorWalletFromSponsorAddress');

      const sponsorWallet = getDerivedSponsorWallet({
        type: 'self-funded',
        dapiNameOrDataFeedId: dapiName,
        updateParameters,
        sponsorWalletMnemonic: 'diamond result history offer forest diagram crop armed stumble orchard stage glance',
      });

      expect(utilsModule.deriveSponsorWalletFromSponsorAddress).toHaveBeenCalledTimes(1);
      expect(sponsorWallet.privateKey).toBe('0x858cd2fbfc60014023911f94190ee4f4bb2d5acf8910a4c0c47596db5717ce5a');
    });
  });
});
