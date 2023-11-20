import type { HardhatUserConfig } from 'hardhat/types';

import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-ethers';
// ci

const config: HardhatUserConfig = {
  solidity: { version: '0.8.18' },
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545/',
    },
  },
  typechain: {
    // To build the "/dist" folder, we need to include both "src" and "typechain-types" and we would prefer the
    // flattened version (only the contents of the "src" folder). This is also in anticipation of importing the
    // Typechain types instead of generating them at build time.
    outDir: 'src/typechain-types',
  },
  defaultNetwork: 'localhost',
};

// eslint-disable-next-line import/no-default-export
export default config;
