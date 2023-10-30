import '@nomiclabs/hardhat-ethers';
import * as abi from '@api3/airnode-abi';
import {
  AccessControlRegistry__factory as AccessControlRegistryFactory,
  type Api3ServerV1,
  Api3ServerV1__factory as Api3ServerV1Factory,
} from '@api3/airnode-protocol-v1';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import type { Signer, Wallet } from 'ethers';
import { ethers } from 'hardhat';

import { deriveBeaconId } from '../../src/utils';
import { generateTestConfig } from '../fixtures/mock-config';
import { signData } from '../utils';

const createKrakenEthBeacon = (airnodeAddress: string) => ({
  airnodeAddress,
  endpoint: {
    oisTitle: 'Kraken API',
    endpointName: 'feeds',
  },
  templateParameters: [
    { type: 'string32', name: 'to', value: 'USD' },
    { type: 'string32', name: '_type', value: 'int256' },
    { type: 'string32', name: '_path', value: 'result' },
    { type: 'string32', name: '_times', value: '1000000' },
    { type: 'string32', name: 'from', value: 'ETH' },
  ],
});

const createKrakenBtcBeacon = (airnodeAddress: string) => ({
  airnodeAddress,
  endpoint: {
    oisTitle: 'Kraken API',
    endpointName: 'feeds',
  },
  templateParameters: [
    { type: 'string32', name: 'to', value: 'USD' },
    { type: 'string32', name: '_type', value: 'int256' },
    { type: 'string32', name: '_path', value: 'result' },
    { type: 'string32', name: '_times', value: '1000000' },
    { type: 'string32', name: 'from', value: 'BTC' },
  ],
});

const createBinanceEthBeacon = (airnodeAddress: string) => ({
  airnodeAddress,
  endpoint: {
    oisTitle: 'Binance API',
    endpointName: 'feeds',
  },
  templateParameters: [
    { type: 'string32', name: 'to', value: 'USD' },
    { type: 'string32', name: '_type', value: 'int256' },
    { type: 'string32', name: '_path', value: 'result' },
    { type: 'string32', name: '_times', value: '1000000' },
    { type: 'string32', name: 'from', value: 'ETH' },
  ],
});

const createBinanceBtcBeacon = (airnodeAddress: string) => ({
  airnodeAddress,
  endpoint: {
    oisTitle: 'Binance API',
    endpointName: 'feeds',
  },
  templateParameters: [
    { type: 'string32', name: 'to', value: 'USD' },
    { type: 'string32', name: '_type', value: 'int256' },
    { type: 'string32', name: '_path', value: 'result' },
    { type: 'string32', name: '_times', value: '1000000' },
    { type: 'string32', name: 'from', value: 'BTC' },
  ],
});

interface RawBeaconData {
  airnodeAddress: string;
  endpoint: {
    oisTitle: string;
    endpointName: string;
  };
  templateParameters: {
    type: string;
    name: string;
    value: string;
  }[];
}

const deriveBeaconData = (beaconData: RawBeaconData) => {
  const { endpoint, templateParameters, airnodeAddress } = beaconData;

  const endpointId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['string', 'string'], [endpoint.oisTitle, endpoint.endpointName])
  );
  const encodedParameters = abi.encode(templateParameters);
  const templateId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointId, encodedParameters]);
  const beaconId = deriveBeaconId(airnodeAddress, templateId)!;

  return { endpointId, templateId, encodedParameters, beaconId };
};

const updateBeacon = async (
  api3ServerV1: Api3ServerV1,
  airnodeWallet: Wallet,
  airseekerSponsorWallet: SignerWithAddress,
  templateId: string,
  apiValue: number
) => {
  const block = await api3ServerV1.provider.getBlock('latest');
  const dataFeedTimestamp = (block.timestamp + 1).toString();
  const encodedValue = ethers.utils.defaultAbiCoder.encode(['uint224'], [ethers.BigNumber.from(apiValue)]);
  const signature = await signData(airnodeWallet, templateId, dataFeedTimestamp, encodedValue);

  await api3ServerV1
    .connect(airseekerSponsorWallet)
    .updateBeaconWithSignedData(airnodeWallet.address, templateId, dataFeedTimestamp, encodedValue, signature);
};

export const deployAndUpdate = async () => {
  const [deployer, manager, airseekerSponsorWallet] = await ethers.getSigners();
  const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';

  // Deploy contracts
  const accessControlRegistryFactory = new AccessControlRegistryFactory(deployer as Signer);
  const accessControlRegistry = await accessControlRegistryFactory.deploy();
  const api3ServerV1Factory = new Api3ServerV1Factory(deployer as Signer);
  const api3ServerV1 = await api3ServerV1Factory.deploy(
    accessControlRegistry.address,
    api3ServerV1AdminRoleDescription,
    manager!.address
  );
  const managerRootRole = ethers.utils.solidityKeccak256(['address'], [manager!.address]);
  await accessControlRegistry
    .connect(manager!)
    .initializeRoleAndGrantToSender(managerRootRole, api3ServerV1AdminRoleDescription);

  // Initialize sponsor wallets
  // TODO: This is the old Airseeker wallet derivation. We should have a dedicated wallet for each dAPI.
  await deployer!.sendTransaction({
    to: airseekerSponsorWallet!.address,
    value: ethers.utils.parseEther('1'),
  });

  // Create templates
  const krakenAirnodeWallet = ethers.Wallet.createRandom();
  const binanceAirnodeWallet = ethers.Wallet.createRandom();
  const krakenBtcBeacon = deriveBeaconData(createKrakenBtcBeacon(krakenAirnodeWallet.address));
  const krakenEthBeacon = deriveBeaconData(createKrakenEthBeacon(krakenAirnodeWallet.address));
  const binanceBtcBeacon = deriveBeaconData(createBinanceBtcBeacon(binanceAirnodeWallet.address));
  const binanceEthBeacon = deriveBeaconData(createBinanceEthBeacon(binanceAirnodeWallet.address));

  // Update beacons with starting values
  await updateBeacon(
    api3ServerV1,
    krakenAirnodeWallet,
    airseekerSponsorWallet!,
    krakenBtcBeacon.templateId,
    Math.floor(740 * 1_000_000)
  );
  await updateBeacon(
    api3ServerV1,
    krakenAirnodeWallet,
    airseekerSponsorWallet!,
    krakenEthBeacon.templateId,
    Math.floor(41_000 * 1_000_000)
  );
  await updateBeacon(
    api3ServerV1,
    binanceAirnodeWallet,
    airseekerSponsorWallet!,
    binanceBtcBeacon.templateId,
    Math.floor(750 * 1_000_000)
  );
  await updateBeacon(
    api3ServerV1,
    binanceAirnodeWallet,
    airseekerSponsorWallet!,
    binanceEthBeacon.templateId,
    Math.floor(41_200 * 1_000_000)
  );

  // Update beacon sets
  await api3ServerV1
    .connect(airseekerSponsorWallet!)
    .updateBeaconSetWithBeacons([binanceBtcBeacon.beaconId, krakenBtcBeacon.beaconId], { gasLimit: 500_000 });
  const lastTx = await api3ServerV1
    .connect(airseekerSponsorWallet!)
    .updateBeaconSetWithBeacons([binanceEthBeacon.beaconId, krakenEthBeacon.beaconId], { gasLimit: 500_000 });

  // Make sure all transactions are mined
  await lastTx.wait();

  // Derive beacon set IDs
  const btcBeaconSetId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [[binanceBtcBeacon.beaconId, krakenBtcBeacon.beaconId]])
  );
  const ethBeaconSetId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [[binanceEthBeacon.beaconId, krakenEthBeacon.beaconId]])
  );

  // TODO: Generate proper config (change sponsor wallet mnemonic, deployed contract addresses, etc...)
  const config = generateTestConfig();

  return {
    accessControlRegistry,
    api3ServerV1,
    btcBeaconSetId,
    ethBeaconSetId,
    config,
  };
};
