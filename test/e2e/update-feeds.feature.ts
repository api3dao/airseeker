import { ethers } from 'ethers';
import { omit } from 'lodash';

import { initializeGasState } from '../../src/gas-price';
import { logger } from '../../src/logger';
import * as stateModule from '../../src/state';
import { runUpdateFeeds } from '../../src/update-feeds-loops';
import { decodeDataFeedDetails, decodeUpdateParameters } from '../../src/update-feeds-loops/contracts';
import { submitTransactions } from '../../src/update-feeds-loops/submit-transactions';
import { decodeDapiName } from '../../src/utils';
import { initializeState } from '../fixtures/mock-config';
import { deployAndUpdate } from '../setup/contract';
import { generateSignedData } from '../utils';

const chainId = '31337';
const providerName = 'localhost';
const rpcUrl = 'http://127.0.0.1:8545/';
const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl);

it('reads blockchain data', async () => {
  const { config } = await deployAndUpdate();
  const [chainId, chain] = Object.entries(config.chains)[0]!;
  const providerName = Object.keys(chain.providers)[0]!;
  jest.spyOn(logger, 'debug').mockImplementation();

  initializeState(config);
  initializeGasState(chainId, providerName);

  await runUpdateFeeds(providerName, chain, chainId);

  expect(logger.debug).toHaveBeenNthCalledWith(2, 'Processing batch of active data feeds.', expect.anything());
});

it('updates blockchain data', async () => {
  const {
    config,
    api3ServerV1,
    airseekerRegistry,
    krakenBtcBeacon,
    binanceBtcBeacon,
    krakenAirnodeWallet,
    binanceAirnodeWallet,
    airseekerWallet,
  } = await deployAndUpdate();
  initializeState(config);
  stateModule.updateState((draft) => {
    draft.config.sponsorWalletMnemonic = airseekerWallet.mnemonic.phrase;
  });
  initializeGasState(chainId, providerName);
  const btcDataFeed = await airseekerRegistry.activeDataFeed(0);

  const decodedDataFeed = decodeDataFeedDetails(btcDataFeed.dataFeedDetails)!;
  const activeBtcDataFeed = {
    ...omit(btcDataFeed, ['dataFeedDetails', 'updateParameters']),
    decodedUpdateParameters: decodeUpdateParameters(btcDataFeed.updateParameters),
    decodedDataFeed,
    decodedDapiName: decodeDapiName(btcDataFeed.dapiName),
  };

  const currentBlock = await airseekerRegistry.provider.getBlock('latest');
  const currentBlockTimestamp = currentBlock.timestamp;
  const binanceBtcSignedData = await generateSignedData(
    binanceAirnodeWallet,
    binanceBtcBeacon.templateId,
    (currentBlockTimestamp + 1).toString()
  );
  const krakenBtcSignedData = await generateSignedData(
    krakenAirnodeWallet,
    krakenBtcBeacon.templateId,
    (currentBlockTimestamp + 2).toString()
  );
  jest.spyOn(logger, 'debug');

  await submitTransactions(
    chainId,
    providerName,
    provider,
    api3ServerV1,
    [
      {
        dataFeedInfo: activeBtcDataFeed,
        updatableBeacons: [
          {
            beaconId: binanceBtcBeacon.beaconId,
            signedData: binanceBtcSignedData,
          },
          {
            beaconId: krakenBtcBeacon.beaconId,
            signedData: krakenBtcSignedData,
          },
        ],
      },
    ],
    123_456
  );

  expect(logger.debug).toHaveBeenCalledTimes(10);
  expect(logger.debug).toHaveBeenNthCalledWith(1, 'Creating calldatas.');
  expect(logger.debug).toHaveBeenNthCalledWith(2, 'Estimating gas limit.');
  expect(logger.debug).toHaveBeenNthCalledWith(3, 'Getting derived sponsor wallet.');
  expect(logger.debug).toHaveBeenNthCalledWith(4, 'Derived new sponsor wallet.', expect.anything());
  expect(logger.debug).toHaveBeenNthCalledWith(5, 'Getting gas price.');
  expect(logger.debug).toHaveBeenNthCalledWith(6, 'Fetching gas price and saving it to the state.');
  expect(logger.debug).toHaveBeenNthCalledWith(7, 'Purging old gas prices.');
  expect(logger.debug).toHaveBeenNthCalledWith(
    8,
    'No historical gas prices to compute the percentile. Using the provider recommended gas price.'
  );
  expect(logger.debug).toHaveBeenNthCalledWith(9, 'Setting timestamp of the original update transaction.');
  expect(logger.debug).toHaveBeenNthCalledWith(10, 'Updating data feed.', expect.anything());
});
