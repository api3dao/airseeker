import type { HardhatUserConfig } from 'hardhat/types';
import '@nomiclabs/hardhat-ethers';

export const config: HardhatUserConfig = {
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545/',
    },
  },
  defaultNetwork: 'localhost',
};
