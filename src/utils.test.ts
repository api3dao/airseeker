import { ethers } from 'ethers';

import { deriveSponsorWallet, deriveWalletPathFromSponsorAddress } from './utils';

describe(deriveSponsorWallet.name, () => {
  it('derives sponsor wallets for a dAPI', () => {
    const btcEthDapiName = ethers.utils.formatBytes32String('BTC/ETH');
    const sponsorWalletMnemonic = 'diamond result history offer forest diagram crop armed stumble orchard stage glance';

    const btcEthSponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, btcEthDapiName);

    expect(btcEthSponsorWallet.address).toBe('0xDa8b0388F435F609C8cdA6cf73C890D90205c863');
  });
});

describe(deriveWalletPathFromSponsorAddress.name, () => {
  it('derives the correct wallet path from the sponsor address', () => {
    expect(deriveWalletPathFromSponsorAddress('0xE2c582D05126E09734cAFABea8A0E56E9B827629')).toBe(
      '5/461534761/1363266269/1395387130/154600633/743976197/28'
    );
    expect(deriveWalletPathFromSponsorAddress('0x86D3763039cA6BABe616755Ceb58e19f3388D9AB')).toBe(
      '5/864606635/1454490430/408540531/1314086239/1832346371/16'
    );
  });
});
