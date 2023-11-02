import { logger } from '../../src/logger';
import { runUpdateFeed } from '../../src/update-feeds';
import { deployAndUpdate } from '../setup/contract';

it('reads blockchain data correctly', async () => {
  const { config } = await deployAndUpdate();
  const [chainId, chain] = Object.entries(config.chains)[0]!;
  const providerName = Object.keys(chain.providers)[0]!;
  jest.spyOn(logger, 'debug').mockImplementation();

  await runUpdateFeed(providerName, chain, chainId);

  expect(logger.debug).toHaveBeenCalledWith('Fetching first batch of dAPIs batches');
});
