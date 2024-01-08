import { encode } from '@api3/airnode-abi';
import {
  AccessControlRegistry__factory as AccessControlRegistryFactory,
  type Api3ServerV1,
  Api3ServerV1__factory as Api3ServerV1Factory,
} from '@api3/airnode-protocol-v1';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import type { Signer, Wallet } from 'ethers';
import { ethers } from 'hardhat';

import { AirseekerRegistry__factory as AirseekerRegistryFactory } from '../../src/typechain-types';
import { deriveBeaconId, deriveSponsorWallet, encodeDapiName } from '../../src/utils';
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
  const encodedParameters = encode(templateParameters);
  const templateId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointId, encodedParameters]);
  const beaconId = deriveBeaconId(airnodeAddress, templateId)!;

  return { endpointId, templateId, encodedParameters, beaconId };
};

export const deriveRootRole = (managerAddress: string) => {
  return ethers.utils.solidityKeccak256(['address'], [managerAddress]);
};

export const deriveRole = (adminRole: string, roleDescription: string) => {
  return ethers.utils.solidityKeccak256(
    ['bytes32', 'bytes32'],
    [adminRole, ethers.utils.solidityKeccak256(['string'], [roleDescription])]
  );
};

const initializeBeacon = async (
  api3ServerV1: Api3ServerV1,
  airnodeWallet: Wallet,
  sponsorWalletMnemonic: SignerWithAddress | Wallet,
  templateId: string,
  apiValue: number
) => {
  const block = await api3ServerV1.provider.getBlock('latest');
  const dataFeedTimestamp = (block.timestamp + 1).toString();
  const encodedValue = ethers.utils.defaultAbiCoder.encode(['uint224'], [ethers.BigNumber.from(apiValue)]);
  const signature = await signData(airnodeWallet, templateId, dataFeedTimestamp, encodedValue);

  await api3ServerV1
    .connect(sponsorWalletMnemonic)
    .updateBeaconWithSignedData(airnodeWallet.address, templateId, dataFeedTimestamp, encodedValue, signature);
};

export const deployAndUpdate = async () => {
  const [deployerAndManager, randomPerson, walletFunder] = await ethers.getSigners();

  // Deploy contracts
  const accessControlRegistryFactory = new AccessControlRegistryFactory(deployerAndManager as Signer);
  const accessControlRegistry = await accessControlRegistryFactory.deploy();
  const api3ServerV1Factory = new Api3ServerV1Factory(deployerAndManager as Signer);
  const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
  const api3ServerV1 = await api3ServerV1Factory.deploy(
    accessControlRegistry.address,
    api3ServerV1AdminRoleDescription,
    deployerAndManager!.address
  );
  const airseekerRegistryFactory = new AirseekerRegistryFactory(deployerAndManager as Signer);
  const airseekerRegistry = await airseekerRegistryFactory.deploy(
    await (deployerAndManager as Signer).getAddress(),
    api3ServerV1.address
  );

  // Initialize special wallet for contract initialization
  const airseekerInitializationWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  await walletFunder!.sendTransaction({
    to: airseekerInitializationWallet.address,
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
  await initializeBeacon(
    api3ServerV1,
    krakenAirnodeWallet,
    airseekerInitializationWallet,
    krakenBtcBeacon.templateId,
    Math.floor(740 * 1_000_000)
  );
  await initializeBeacon(
    api3ServerV1,
    krakenAirnodeWallet,
    airseekerInitializationWallet,
    krakenEthBeacon.templateId,
    Math.floor(41_000 * 1_000_000)
  );
  await initializeBeacon(
    api3ServerV1,
    binanceAirnodeWallet,
    airseekerInitializationWallet,
    binanceBtcBeacon.templateId,
    Math.floor(750 * 1_000_000)
  );
  await initializeBeacon(
    api3ServerV1,
    binanceAirnodeWallet,
    airseekerInitializationWallet,
    binanceEthBeacon.templateId,
    Math.floor(41_200 * 1_000_000)
  );

  // Update beacon sets
  await api3ServerV1
    .connect(airseekerInitializationWallet)
    .updateBeaconSetWithBeacons([binanceBtcBeacon.beaconId, krakenBtcBeacon.beaconId], { gasLimit: 500_000 });
  await api3ServerV1
    .connect(airseekerInitializationWallet)
    .updateBeaconSetWithBeacons([binanceEthBeacon.beaconId, krakenEthBeacon.beaconId], { gasLimit: 500_000 });

  // Derive beacon set IDs
  const btcBeaconSetId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [[binanceBtcBeacon.beaconId, krakenBtcBeacon.beaconId]])
  );
  const ethBeaconSetId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [[binanceEthBeacon.beaconId, krakenEthBeacon.beaconId]])
  );

  // Set active data feeds and initialize sponsor wallets
  const apiTreeValues = [
    [krakenAirnodeWallet.address, 'https://kraken.com/'],
    [binanceAirnodeWallet.address, 'https://binance.com/'],
  ] as const;
  const airseekerWallet = ethers.Wallet.createRandom();
  await Promise.all(
    apiTreeValues.map(async ([airnode, url]) => {
      return airseekerRegistry.connect(deployerAndManager!).setSignedApiUrl(airnode, url);
    })
  );
  const dapiInfos = [
    {
      airnodes: [binanceAirnodeWallet.address, krakenAirnodeWallet.address],
      templateIds: [binanceBtcBeacon.templateId, krakenBtcBeacon.templateId],
      dapiName: encodeDapiName('BTC/USD'),
      beaconSetId: btcBeaconSetId,
    },
    {
      airnodes: [binanceAirnodeWallet.address, krakenAirnodeWallet.address],
      templateIds: [binanceEthBeacon.templateId, krakenEthBeacon.templateId],
      dapiName: encodeDapiName('ETH/USD'),
      beaconSetId: ethBeaconSetId,
    },
  ];
  for (const dapiInfo of dapiInfos) {
    const { airnodes, templateIds, dapiName, beaconSetId } = dapiInfo;

    const encodedBeaconSetData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'bytes32[]'],
      [airnodes, templateIds]
    );
    await airseekerRegistry.connect(randomPerson!).registerDataFeed(encodedBeaconSetData);
    const HUNDRED_PERCENT = 1e8;
    const deviationThresholdInPercentage = ethers.BigNumber.from(HUNDRED_PERCENT / 50); // 2%
    const deviationReference = ethers.constants.Zero; // Not used in Airseeker V1
    const heartbeatInterval = ethers.BigNumber.from(86_400); // 24 hrs
    await airseekerRegistry
      .connect(deployerAndManager!)
      .setDapiNameUpdateParameters(
        dapiName,
        ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'uint256', 'uint256'],
          [deviationThresholdInPercentage, deviationReference, heartbeatInterval]
        )
      );
    await api3ServerV1.connect(deployerAndManager!).setDapiName(dapiName, beaconSetId);
    await airseekerRegistry.connect(deployerAndManager!).setDapiNameToBeActivated(dapiName);

    // Initialize sponsor wallets
    const sponsorWallet = deriveSponsorWallet(airseekerWallet.mnemonic.phrase, dapiName);
    await walletFunder!.sendTransaction({
      to: sponsorWallet.address,
      value: ethers.utils.parseEther('1'),
    });
  }

  // Set up config
  const config = generateTestConfig();
  config.sponsorWalletMnemonic = airseekerWallet.mnemonic.phrase;
  config.chains[31_337]!.contracts.Api3ServerV1 = api3ServerV1.address;
  config.chains[31_337]!.contracts.AirseekerRegistry = airseekerRegistry.address;

  return {
    accessControlRegistry,
    airseekerRegistry,
    api3ServerV1,

    binanceAirnodeWallet,
    krakenAirnodeWallet,

    binanceBtcBeacon,
    btcBeaconSetId,
    krakenBtcBeacon,

    binanceEthBeacon,
    ethBeaconSetId,
    krakenEthBeacon,

    airseekerWallet,
    config,
  };
};
