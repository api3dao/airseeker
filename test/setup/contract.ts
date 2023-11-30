import { encode } from '@api3/airnode-abi';
import {
  AccessControlRegistry__factory as AccessControlRegistryFactory,
  type Api3ServerV1,
  Api3ServerV1__factory as Api3ServerV1Factory,
} from '@api3/airnode-protocol-v1';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { Signer, Wallet } from 'ethers';
import { ethers } from 'hardhat';

import {
  DapiDataRegistry__factory as DapiDataRegistryFactory,
  HashRegistry__factory as HashRegistryFactory,
} from '../../src/typechain-types';
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
  const [
    deployer,
    manager,
    registryOwner,
    api3MarketContract,
    rootSigner1,
    rootSigner2,
    rootSigner3,
    randomPerson,
    walletFunder,
  ] = await ethers.getSigners();

  // Deploy contracts
  const accessControlRegistryFactory = new AccessControlRegistryFactory(deployer as Signer);
  const accessControlRegistry = await accessControlRegistryFactory.deploy();
  const api3ServerV1Factory = new Api3ServerV1Factory(deployer as Signer);
  const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
  const api3ServerV1 = await api3ServerV1Factory.deploy(
    accessControlRegistry.address,
    api3ServerV1AdminRoleDescription,
    manager!.address
  );
  const hashRegistryFactory = new HashRegistryFactory(deployer as Signer);
  const hashRegistry = await hashRegistryFactory.deploy();
  await hashRegistry.connect(deployer!).transferOwnership(registryOwner!.address);
  const dapiDataRegistryFactory = new DapiDataRegistryFactory(deployer as Signer);
  const dapiDataRegistryAdminRoleDescription = 'DapiDataRegistry admin';
  const dapiDataRegistry = await dapiDataRegistryFactory.deploy(
    accessControlRegistry.address,
    dapiDataRegistryAdminRoleDescription,
    manager!.address,
    hashRegistry.address,
    api3ServerV1.address
  );

  // Set up roles
  const rootRole = deriveRootRole(manager!.address);
  const dapiDataRegistryAdminRole = deriveRole(rootRole, dapiDataRegistryAdminRoleDescription);
  const dapiAdderRoleDescription = await dapiDataRegistry.DAPI_ADDER_ROLE_DESCRIPTION();
  const dapiAdderRole = deriveRole(dapiDataRegistryAdminRole, dapiAdderRoleDescription);
  const dapiRemoverRoleDescription = await dapiDataRegistry.DAPI_REMOVER_ROLE_DESCRIPTION();
  await accessControlRegistry
    .connect(manager!)
    .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
  await accessControlRegistry
    .connect(manager!)
    .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, dapiAdderRoleDescription);
  await accessControlRegistry
    .connect(manager!)
    .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, dapiRemoverRoleDescription);
  await accessControlRegistry.connect(manager!).grantRole(dapiAdderRole, api3MarketContract!.address);
  await accessControlRegistry
    .connect(manager!)
    .initializeRoleAndGrantToSender(rootRole, api3ServerV1AdminRoleDescription);
  await accessControlRegistry
    .connect(manager!)
    .initializeRoleAndGrantToSender(
      await api3ServerV1.adminRole(),
      await api3ServerV1.DAPI_NAME_SETTER_ROLE_DESCRIPTION()
    );
  await accessControlRegistry
    .connect(manager!)
    .grantRole(await api3ServerV1.dapiNameSetterRole(), dapiDataRegistry.address);

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

  // Register merkle tree hashes
  const timestamp = Math.floor(Date.now() / 1000);
  const apiTreeValues = [
    [krakenAirnodeWallet.address, 'https://kraken.com/'],
    [binanceAirnodeWallet.address, 'https://binance.com/'],
  ] as const;
  const apiTree = StandardMerkleTree.of(apiTreeValues as any, ['address', 'string']);
  const apiHashType = ethers.utils.solidityKeccak256(['string'], ['Signed API URL Merkle tree root']);
  const rootSigners = [rootSigner1!, rootSigner2!, rootSigner3!];
  const apiMessages = ethers.utils.arrayify(
    ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [apiHashType, apiTree.root, timestamp])
  );
  const apiTreeRootSignatures = await Promise.all(
    rootSigners.map(async (rootSigner) => rootSigner.signMessage(apiMessages))
  );
  await hashRegistry.connect(registryOwner!).setupSigners(
    apiHashType,
    rootSigners.map((rootSigner) => rootSigner.address)
  );
  await hashRegistry.registerHash(apiHashType, apiTree.root, timestamp, apiTreeRootSignatures);

  // Add dAPIs hashes
  const dapiNamesInfo = [
    ['BTC/USD', btcBeaconSetId, airseekerInitializationWallet.address],
    ['ETH/USD', ethBeaconSetId, airseekerInitializationWallet.address],
  ] as const;
  const dapiTreeValues = dapiNamesInfo.map(([decodedDapiName, beaconSetId, sponsorWalletAddress]) => {
    return [encodeDapiName(decodedDapiName), beaconSetId, sponsorWalletAddress];
  });
  const dapiTree = StandardMerkleTree.of(dapiTreeValues, ['bytes32', 'bytes32', 'address']);
  const dapiTreeRoot = dapiTree.root;
  const dapiHashType = ethers.utils.solidityKeccak256(['string'], ['dAPI management Merkle tree root']);
  const dapiMessages = ethers.utils.arrayify(
    ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [dapiHashType, dapiTreeRoot, timestamp])
  );
  const dapiTreeRootSignatures = await Promise.all(
    rootSigners.map(async (rootSigner) => rootSigner.signMessage(dapiMessages))
  );
  await hashRegistry.connect(registryOwner!).setupSigners(
    dapiHashType,
    rootSigners.map((rootSigner) => rootSigner.address)
  );
  await hashRegistry.registerHash(dapiHashType, dapiTreeRoot, timestamp, dapiTreeRootSignatures);

  // Set active dAPIs and initialize sponsor wallets
  const airseekerWallet = ethers.Wallet.createRandom();
  const apiTreeRoot = apiTree.root;
  await Promise.all(
    apiTreeValues.map(async ([airnode, url]) => {
      const apiTreeProof = apiTree.getProof([airnode, url]);
      return dapiDataRegistry
        .connect(api3MarketContract!)
        .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
    })
  );
  const dapiInfos = [
    {
      airnodes: [binanceAirnodeWallet.address, krakenAirnodeWallet.address],
      templateIds: [binanceBtcBeacon.templateId, krakenBtcBeacon.templateId],
      dapiTreeValue: dapiTreeValues[0]!,
    },
    {
      airnodes: [binanceAirnodeWallet.address, krakenAirnodeWallet.address],
      templateIds: [binanceEthBeacon.templateId, krakenEthBeacon.templateId],
      dapiTreeValue: dapiTreeValues[1]!,
    },
  ];
  for (const dapiInfo of dapiInfos) {
    const { airnodes, templateIds, dapiTreeValue } = dapiInfo;

    const encodedBeaconSetData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'bytes32[]'],
      [airnodes, templateIds]
    );
    await dapiDataRegistry.connect(randomPerson!).registerDataFeed(encodedBeaconSetData);
    const HUNDRED_PERCENT = 1e8;
    const deviationThresholdInPercentage = ethers.BigNumber.from(HUNDRED_PERCENT / 50); // 2%
    const deviationReference = ethers.constants.Zero; // Not used in Airseeker V1
    const heartbeatInterval = ethers.BigNumber.from(86_400); // 24 hrs
    const [dapiName, beaconSetId, sponsorWalletMnemonic] = dapiTreeValue;
    await dapiDataRegistry
      .connect(api3MarketContract!)
      .addDapi(
        dapiName!,
        beaconSetId!,
        sponsorWalletMnemonic!,
        deviationThresholdInPercentage,
        deviationReference,
        heartbeatInterval,
        dapiTree.root,
        dapiTree.getProof(dapiTreeValue)
      );

    // Initialize sponsor wallets
    const sponsorWallet = deriveSponsorWallet(airseekerWallet.mnemonic.phrase, dapiName!);
    await walletFunder!.sendTransaction({
      to: sponsorWallet.address,
      value: ethers.utils.parseEther('1'),
    });
  }

  // Set up config
  const config = generateTestConfig();
  config.sponsorWalletMnemonic = airseekerWallet.mnemonic.phrase;
  config.chains[31_337]!.contracts.Api3ServerV1 = api3ServerV1.address;
  config.chains[31_337]!.contracts.DapiDataRegistry = dapiDataRegistry.address;

  return {
    accessControlRegistry,
    api3ServerV1,
    dapiDataRegistry,

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
