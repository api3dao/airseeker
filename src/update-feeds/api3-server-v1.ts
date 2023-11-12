import { Api3ServerV1__factory as Api3ServerV1Factory } from '@api3/airnode-protocol-v1';
import type { ethers } from 'ethers';

export const getApi3ServerV1 = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  Api3ServerV1Factory.connect(address, provider);
