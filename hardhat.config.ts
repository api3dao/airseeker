import { hardhatConfig } from '@api3/contracts';
import type { HardhatUserConfig } from 'hardhat/types';

import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-deploy';
import 'dotenv/config';

const config: HardhatUserConfig = {
  // Mirrors the verification setup of the api3dao/contracts repository.
  blockscout: hardhatConfig.blockscout(),
  etherscan: hardhatConfig.etherscan(),
  sourcify: {
    enabled: true,
    apiUrl: 'https://sourcify.dev/server',
    browserUrl: 'https://repo.sourcify.dev',
  },
  networks: {
    ...hardhatConfig.networks(),
    localhost: {
      url: 'http://127.0.0.1:8545/',
    },
  },
  defaultNetwork: 'localhost',
  // Mirrors the compiler settings of the api3dao/contracts repository.
  solidity: {
    version: '0.8.27',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
};

// eslint-disable-next-line import/no-default-export
export default config;
