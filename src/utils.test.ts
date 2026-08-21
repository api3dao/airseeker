import { ethers } from 'hardhat';

import { allowPartial } from '../test/utils';

import * as stateModule from './state';
import * as utilsModule from './utils';
import {
  deriveSponsorAddressForManagedFeed,
  deriveSponsorAddressForSelfFundedFeed,
  deriveSponsorWallet,
  deriveSponsorWalletFromSponsorAddress,
  encodeDapiName,
  generateRandomId,
} from './utils';

describe(deriveSponsorWalletFromSponsorAddress.name, () => {
  describe(deriveSponsorAddressForManagedFeed.name, () => {
    it('derives different wallets for dAPIs with same prefix', () => {
      const dapiName = encodeDapiName('Ethereum - Avalanche');
      const otherDapiName = encodeDapiName('Ethereum - Avalanche (DEX)');
      const sponsorWalletMnemonic =
        'diamond result history offer forest diagram crop armed stumble orchard stage glance';

      const sponsorAddress = deriveSponsorAddressForManagedFeed(dapiName);
      const sponsorWallet = deriveSponsorWalletFromSponsorAddress(sponsorWalletMnemonic, sponsorAddress);
      const otherSponsorAddress = deriveSponsorAddressForManagedFeed(otherDapiName);
      const otherSponsorWallet = deriveSponsorWalletFromSponsorAddress(sponsorWalletMnemonic, otherSponsorAddress);

      expect(sponsorWallet.address).not.toBe(otherSponsorWallet.address);
    });

    it('works with data feed ID', () => {
      const dataFeedId = '0x917ecd1b870ef5fcbd53088046d0987493593d761e2516ec6acc455848976f36';
      const sponsorWalletMnemonic =
        'diamond result history offer forest diagram crop armed stumble orchard stage glance';

      const sponsorAddress = deriveSponsorAddressForManagedFeed(dataFeedId);
      const sponsorWallet = deriveSponsorWalletFromSponsorAddress(sponsorWalletMnemonic, sponsorAddress);

      expect(sponsorWallet.address).toBe('0x6fD46d2D7AB4574Be0185618944106fdaF20DB7D'); // Note, that the address is different if the sponsor address hash is derived using the "self-funded" scheme.
    });
  });

  describe(deriveSponsorAddressForSelfFundedFeed.name, () => {
    it('derives a wallet for a self-funded feed', () => {
      const dataFeedId = '0x917ecd1b870ef5fcbd53088046d0987493593d761e2516ec6acc455848976f36';
      const updateParameters =
        '0x0000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000000000064';
      const sponsorWalletMnemonic =
        'diamond result history offer forest diagram crop armed stumble orchard stage glance';

      const sponsorAddress = deriveSponsorAddressForSelfFundedFeed(dataFeedId, updateParameters);
      const sponsorWallet = deriveSponsorWalletFromSponsorAddress(sponsorWalletMnemonic, sponsorAddress);

      expect(sponsorWallet.address).toBe('0x08E47E2dF1440492289da760B58d036b3abb1A43'); // Note, that the address is different if the sponsor address hash is derived using the "managed" scheme.
    });
  });

  describe('fixed sponsor address read from airseeker.json', () => {
    it('derives a wallet for a fixed feed', () => {
      const sponsorWalletMnemonic =
        'diamond result history offer forest diagram crop armed stumble orchard stage glance';

      const sponsorWallet = deriveSponsorWalletFromSponsorAddress(
        sponsorWalletMnemonic,
        '0x0000000000000000000000000000000000000001'
      );

      expect(sponsorWallet.address).toBe('0xFaFF9C2E67716d2209552f46Fa9829D46830aCcB');
    });
  });
});

describe(deriveSponsorWallet.name, () => {
  it('derives a wallet for a managed feed', () => {
    const dapiName = encodeDapiName('Ethereum - Avalanche');
    const sponsorWalletMnemonic = 'diamond result history offer forest diagram crop armed stumble orchard stage glance';

    const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, {
      type: 'managed',
      dapiNameOrDataFeedId: dapiName,
      updateParameters: 'does-not-matter',
      sponsorWalletMnemonic,
    });

    expect(sponsorWallet.address).toBe('0xDF5Eb6273BdB4608e70Bb0ABCA0571B45Cb60a22'); // Note, that the address is different if the sponsor address hash is derived using the "self-funded" scheme.
  });

  it('derives a wallet for a self-funded feed', () => {
    const dapiName = encodeDapiName('Ethereum - Avalanche');
    const updateParameters =
      '0x0000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000000000064';
    const sponsorWalletMnemonic = 'diamond result history offer forest diagram crop armed stumble orchard stage glance';

    const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, {
      type: 'self-funded',
      dapiNameOrDataFeedId: dapiName,
      updateParameters,
      sponsorWalletMnemonic,
    });

    expect(sponsorWallet.address).toBe('0x1e0cb43e47bf4335d21812C2d652fC83F2CB64Bb'); // Note, that the address is different if the sponsor address hash is derived using the "managed" scheme.
  });

  it('derives a wallet for a fixed feed', () => {
    const sponsorWalletMnemonic = 'diamond result history offer forest diagram crop armed stumble orchard stage glance';

    const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, {
      type: 'fixed',
      sponsorAddress: '0x0000000000000000000000000000000000000001',
      dapiNameOrDataFeedId: 'does-not-matter',
      updateParameters: 'does-not-matter',
      sponsorWalletMnemonic,
    });

    expect(sponsorWallet.address).toBe('0xFaFF9C2E67716d2209552f46Fa9829D46830aCcB');
  });
});

test('ethers compatibility for Wallet.fromMnemonic', () => {
  const wallet = ethers.Wallet.fromPhrase(
    'arrange actress together floor menu parade dawn abandon say swear excess museum'
  );

  expect(wallet.address).toBe('0xE1f7E4662F92e5DaDB9529Efb2EE61ec63b028e3');
});

describe(generateRandomId.name, () => {
  it('generates an ID', () => {
    expect(generateRandomId()).toMatch(/^[\da-f]{64}$/); // There is no 0x prefix.
  });
});

describe(utilsModule.getDerivedSponsorWallet.name, () => {
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

      const sponsorWallet = utilsModule.getDerivedSponsorWallet({
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

      const sponsorWallet = utilsModule.getDerivedSponsorWallet({
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

      const sponsorWallet = utilsModule.getDerivedSponsorWallet({
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

      const sponsorWallet = utilsModule.getDerivedSponsorWallet({
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
