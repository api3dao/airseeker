import { ethers } from 'ethers';
import { setState } from '../../src/state';
import { runDataFetcher } from '../../src/signed-api-fetch';
import type { Config } from '../../src/config/schema';

/**
 * A stub to retrieve the latest config
 */
const getConfig = () => generateTestConfig();

// This is not a secret
// https://pool.nodary.io/0xC04575A2773Da9Cd23853A69694e02111b2c4182
export const generateTestConfig = (): Config => ({
  sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
  chains: {
    '31337': {
      contracts: {
        Api3ServerV1: '',
      },
      providers: { hardhat: { url: 'http://127.0.0.1:8545' } },
      __Temporary__DapiDataRegistry: {
        airnodeToSignedApiUrl: {
          '0xC04575A2773Da9Cd23853A69694e02111b2c4182': 'https://pool.nodary.io', // stale data
          '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4': 'https://pool.nodary.io', // fresh data
        },
        dataFeedIdToBeacons: {
          [ethers.BigNumber.from(ethers.utils.randomBytes(64)).toHexString()]: [
            {
              templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
              airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
            },
          ],
          [ethers.BigNumber.from(ethers.utils.randomBytes(64)).toHexString()]: [
            {
              templateId: '0x96504241fb9ae9a5941f97c9561dcfcd7cee77ee9486a58c8e78551c1268ddec',
              airnode: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
            },
          ],
        },
        activeDapiNames: [],
      },
    },
  },
  fetchInterval: 10,
  deviationThresholdCoefficient: 1,
});

// this should probably be moved to test fixtures
export const init = () => {
  const config = getConfig();
  setState({
    config,
  });
};

if (require.main === module) {
  init();
  // eslint-disable-next-line unicorn/prefer-top-level-await
  runDataFetcher().catch((error) => {
    // eslint-disable-next-line no-console
    console.trace(error);
  });
}
