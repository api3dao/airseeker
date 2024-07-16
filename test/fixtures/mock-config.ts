import packageJson from '../../package.json';
import type { Config } from '../../src/config/schema';
import { setInitialState } from '../../src/state';

// This is not a secret
// https://pool.nodary.io/0xC04575A2773Da9Cd23853A69694e02111b2c4182
export const generateTestConfig = (): Config => ({
  sponsorWalletMnemonic: 'test test test test test test test test test test test junk',
  chains: {
    '31337': {
      alias: 'hardhat',
      contracts: {
        Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      },
      providers: { hardhat: { url: 'http://127.0.0.1:8545' } },
      gasSettings: {
        recommendedGasPriceMultiplier: 1.2, // In practice, this should likely be set to 1.
        sanitizationPercentile: 50,
        sanitizationSamplingWindow: 900,
        maxScalingMultiplier: 2,
        scalingWindow: 300,
        sanitizationMultiplier: 2, // In practice, this should probably be larger than maxScalingMultiplier.
      },
      dataFeedBatchSize: 10,
      dataFeedUpdateInterval: 60,
    },
  },
  deviationThresholdCoefficient: 1,
  heartbeatIntervalModifier: 0,
  individualBeaconUpdateDeviationThresholdCoefficient: null,
  signedDataFetchInterval: 10,
  signedApiUrls: [],
  stage: 'test',
  version: packageJson.version,
  walletDerivationScheme: { type: 'managed' },
});

export const initializeState = (config: Config = generateTestConfig()) => setInitialState(config);
