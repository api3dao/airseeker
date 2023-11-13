import { ethers } from 'ethers';
import { omit } from 'lodash';

import { initializeGasStore } from '../../src/gas-price';
import { logger } from '../../src/logger';
import * as stateModule from '../../src/state';
import { runUpdateFeed } from '../../src/update-feeds';
import { decodeDataFeed } from '../../src/update-feeds/dapi-data-registry';
import { updateFeeds } from '../../src/update-feeds/update-transactions';
import { initializeState } from '../fixtures/mock-config';
import { deployAndUpdate } from '../setup/contract';
import { allowPartial, generateSignedData } from '../utils';

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

  await runUpdateFeed(providerName, chain, chainId);

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
  initializeGasStore(chainId, providerName);
  const btcDapi = await dapiDataRegistry.readDapiWithIndex(0);

  const decodedDataFeed = decodeDataFeed(btcDapi.dataFeed);
  const decodedBtcDapi = { ...omit(btcDapi, ['dataFeed']), decodedDataFeed };

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
  jest
    .spyOn(stateModule, 'getState')
    .mockReturnValue(
      allowPartial<stateModule.State>({ config: { sponsorWalletMnemonic: airseekerWallet.mnemonic.phrase } })
    );

  await updateFeeds(chainId, providerName, provider, api3ServerV1, [
    {
      dapiInfo: decodedBtcDapi,
      updateableBeacons: [
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

  expect(logger.debug).toHaveBeenCalledTimes(4);
  expect(logger.debug).toHaveBeenNthCalledWith(1, 'Estimating gas limit');
  expect(logger.debug).toHaveBeenNthCalledWith(2, 'Getting derived sponsor wallet');
  expect(logger.debug).toHaveBeenNthCalledWith(3, 'Derived new sponsor wallet', expect.anything());
  expect(logger.debug).toHaveBeenNthCalledWith(4, 'Updating dAPI', expect.anything());
});
