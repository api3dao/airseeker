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
    provider,
  } = await deployAndUpdate();
  initializeState(config);
  stateModule.updateState((draft) => {
    draft.config.sponsorWalletMnemonic = airseekerWallet.mnemonic!.phrase;
  });
  initializeGasState(chainId, providerName);
  const { dataFeedId, dapiName, dataFeedDetails, dataFeedValue, dataFeedTimestamp, updateParameters, signedApiUrls } =
    await airseekerRegistry.activeDataFeed(0);

  const decodedDataFeed = decodeDataFeedDetails(dataFeedDetails)!;
  const activeBtcDataFeed = {
    dapiName,
    dataFeedId,
    dataFeedValue,
    dataFeedTimestamp,
    signedApiUrls,
    decodedUpdateParameters: decodeUpdateParameters(updateParameters),
    decodedDataFeed,
    decodedDapiName: decodeDapiName(dapiName),
  };

  const currentBlock = await provider.getBlock('latest');
  const currentBlockTimestamp = currentBlock!.timestamp;
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
  jest.spyOn(logger, 'info');
  const blockNumber = await provider.getBlockNumber();

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
    blockNumber
  );

  expect(logger.debug).toHaveBeenCalledTimes(10);
  expect(logger.debug).toHaveBeenNthCalledWith(1, 'Creating calldatas.');
  expect(logger.debug).toHaveBeenNthCalledWith(2, 'Estimating gas limit.');
  expect(logger.debug).toHaveBeenNthCalledWith(3, 'Getting derived sponsor wallet.');
  expect(logger.debug).toHaveBeenNthCalledWith(4, 'Derived new sponsor wallet.', expect.anything());
  expect(logger.debug).toHaveBeenNthCalledWith(5, 'Getting nonce.');
  expect(logger.debug).toHaveBeenNthCalledWith(6, 'Getting gas price.');
  expect(logger.debug).toHaveBeenNthCalledWith(7, 'Fetching gas price and saving it to the state.');
  expect(logger.debug).toHaveBeenNthCalledWith(8, 'Purging old gas prices.');
  expect(logger.debug).toHaveBeenNthCalledWith(
    9,
    'No historical gas prices to compute the percentile. Using the provider recommended gas price.'
  );
  expect(logger.debug).toHaveBeenNthCalledWith(10, 'Setting timestamp of the original update transaction.');
  expect(logger.info).toHaveBeenCalledTimes(2);
  expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed.', expect.anything());
  expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully updated data feed.');
});
