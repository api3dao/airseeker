import { ethers } from 'ethers';

import { logger } from '../../src/logger';
import * as stateModule from '../../src/state';
import { runUpdateFeed } from '../../src/update-feeds';
import { deriveSponsorWallet, updateFeeds } from '../../src/update-feeds/update-transactions';
import { deployAndUpdate } from '../setup/contract';
import { allowPartial, generateSignedData } from '../utils';

it('reads blockchain data', async () => {
  const { config } = await deployAndUpdate();
  const [chainId, chain] = Object.entries(config.chains)[0]!;
  const providerName = Object.keys(chain.providers)[0]!;
  jest.spyOn(logger, 'debug').mockImplementation();

  await runUpdateFeed(providerName, chain, chainId);

  expect(logger.debug).toHaveBeenNthCalledWith(2, 'Processing batch of active dAPIs', expect.anything());
});

it('updates blockchain data', async () => {
  const {
    api3ServerV1,
    dapiDataRegistry,
    krakenBtcBeacon,
    binanceBtcBeacon,
    krakenAirnodeWallet,
    binanceAirnodeWallet,
    airseekerSponsorWallet,
    walletFunder,
  } = await deployAndUpdate();
  const gasPrice = await api3ServerV1.provider.getGasPrice();
  const btcDapi = await dapiDataRegistry.readDapiWithIndex(0);
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
  const btcDapiSponsorWallet = deriveSponsorWallet(airseekerSponsorWallet.mnemonic.phrase, btcDapi.dapiName);
  await walletFunder.sendTransaction({
    to: btcDapiSponsorWallet.address,
    value: ethers.utils.parseEther('1'),
  });
  jest.spyOn(logger, 'debug');
  jest
    .spyOn(stateModule, 'getState')
    .mockReturnValue(
      allowPartial<stateModule.State>({ config: { sponsorWalletMnemonic: airseekerSponsorWallet.mnemonic.phrase } })
    );

  await updateFeeds(api3ServerV1, gasPrice, [
    {
      dapiInfo: btcDapi,
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

  expect(logger.debug).toHaveBeenCalledWith('Successfully updated dAPI');
});
