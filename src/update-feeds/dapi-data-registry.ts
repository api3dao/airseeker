import type { ethers } from 'ethers';

// NOTE: The contract is not yet published, so we generate the Typechain artifacts locally and import it from there.
import { type DapiDataRegistry, DapiDataRegistry__factory } from '../../typechain-types';

export const getDapiDataRegistry = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  DapiDataRegistry__factory.connect(address, provider);

export type ReadDapisResponse = Awaited<ReturnType<DapiDataRegistry['readDapis']>>;
