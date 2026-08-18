import type { HardhatUserConfig } from 'hardhat/types';

import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  networks: {
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
