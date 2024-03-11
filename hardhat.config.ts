import type { HardhatUserConfig } from 'hardhat/types';

import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545/',
    },
  },
  defaultNetwork: 'localhost',
};

// eslint-disable-next-line import/no-default-export
export default config;
