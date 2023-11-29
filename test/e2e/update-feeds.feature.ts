import { ethers } from 'ethers';
import { omit } from 'lodash';

import { initializeGasStore } from '../../src/gas-price';
import { logger } from '../../src/logger';
import * as stateModule from '../../src/state';
import { runUpdateFeeds } from '../../src/update-feeds-loops';
import { decodeDataFeed } from '../../src/update-feeds-loops/contracts';
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
  initializeGasStore(chainId, providerName);

  await runUpdateFeeds(providerName, chain, chainId);

  expect(logger.debug).toHaveBeenNthCalledWith(2, 'Processing batch of active dAPIs', expect.anything());
});

it('updates blockchain data', async () => {
  const {
    config,
    api3ServerV1,
    dapiDataRegistry,
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
  initializeGasStore(chainId, providerName);
  const btcDapi = await dapiDataRegistry.readDapiWithIndex(0);

  const decodedDataFeed = decodeDataFeed(btcDapi.dataFeed);
  const decodedBtcDapi = {
    ...omit(btcDapi, ['dataFeed']),
    decodedDataFeed,
    decodedDapiName: decodeDapiName(btcDapi.dapiName),
  };

  const currentBlock = await dapiDataRegistry.provider.getBlock('latest');
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

  await submitTransactions(chainId, providerName, provider, api3ServerV1, [
    {
      dapiInfo: decodedBtcDapi,
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
  ]);

  expect(logger.debug).toHaveBeenCalledTimes(8);
  expect(logger.debug).toHaveBeenNthCalledWith(1, 'Creating calldatas');
  expect(logger.debug).toHaveBeenNthCalledWith(2, 'Estimating gas limit');
  expect(logger.debug).toHaveBeenNthCalledWith(3, 'Getting derived sponsor wallet');
  expect(logger.debug).toHaveBeenNthCalledWith(4, 'Derived new sponsor wallet', expect.anything());
  expect(logger.debug).toHaveBeenNthCalledWith(5, 'Getting gas price');
  expect(logger.debug).toHaveBeenNthCalledWith(6, 'Updating gas price store.');
  expect(logger.debug).toHaveBeenNthCalledWith(7, 'Setting timestamp of the original update transaction');
  expect(logger.debug).toHaveBeenNthCalledWith(8, 'Updating dAPI', expect.anything());
});
