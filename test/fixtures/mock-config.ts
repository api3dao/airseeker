import type { Config } from '../../src/config/schema';
import { setInitialState } from '../../src/state';

// This is not a secret
// https://pool.nodary.io/0xC04575A2773Da9Cd23853A69694e02111b2c4182
export const generateTestConfig = (): Config => ({
  sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
  chains: {
    '31337': {
      contracts: {
        Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        AirseekerRegistry: '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
      },
      providers: { hardhat: { url: 'http://127.0.0.1:8545' } },
      gasSettings: {
        recommendedGasPriceMultiplier: 1.5,
        sanitizationPercentile: 80,
        sanitizationSamplingWindow: 900,
        maxScalingMultiplier: 2,
        scalingWindow: 300,
      },
      dataFeedBatchSize: 10,
      dataFeedUpdateInterval: 60,
    },
  },
  signedDataFetchInterval: 10,
  deviationThresholdCoefficient: 1,
  signedApiUrls: [],
});

export const initializeState = (config: Config = generateTestConfig()) => setInitialState(config);
