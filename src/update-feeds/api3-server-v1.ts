import type { ethers } from 'ethers';

// NOTE: The contract is not yet published, so we generate the Typechain artifacts locally and import it from there.
import { Api3ServerV1__factory } from '../../typechain-types';

export const getApi3ServerV1 = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  Api3ServerV1__factory.connect(address, provider);
