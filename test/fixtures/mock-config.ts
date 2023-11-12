import type { Config } from '../../src/config/schema';
import { setState, type State } from '../../src/state';

/**
 * A stub to retrieve the latest config
 */
export const getConfig = () => generateTestConfig();

// This is not a secret
// https://pool.nodary.io/0xC04575A2773Da9Cd23853A69694e02111b2c4182
export const generateTestConfig = (): Config => ({
  sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
  chains: {
    '31337': {
      contracts: {
        Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        DapiDataRegistry: '0xDD78254f864F97f65e2d86541BdaEf88A504D2B2',
      },
      providers: { hardhat: { url: 'http://127.0.0.1:8545' } },
      gasSettings: {
        recommendedGasPriceMultiplier: 1.5,
        sanitizationPercentile: 80,
        sanitizationSamplingWindow: 15,
        maxScalingMultiplier: 2,
        scalingWindow: 5,
      },
      dataFeedBatchSize: 10,
      dataFeedUpdateInterval: 60,
    },
  },
  signedDataFetchInterval: 10,
  deviationThresholdCoefficient: 1,
});

// TODO: Do we need this function? Can't we use the one from production code?
export const init = (stateOverride?: Partial<State>) => {
  const config = getConfig();
  setState({
    config,
    gasPriceStore: {},
    signedApiStore: {},
    signedApiUrlStore: {},
    derivedSponsorWallets: {},
    dapis: {},
    ...stateOverride,
  });
};
