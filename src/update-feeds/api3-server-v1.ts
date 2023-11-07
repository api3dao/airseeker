import { Api3ServerV1__factory } from '@api3/airnode-protocol-v1';
import type { ethers } from 'ethers';

export const getApi3ServerV1 = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  Api3ServerV1__factory.connect(address, provider);
