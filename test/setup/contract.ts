import * as abi from '@api3/airnode-abi';
import { AccessControlRegistry__factory, type Api3ServerV1, Api3ServerV1__factory } from '@api3/airnode-protocol-v1';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { Signer, Wallet } from 'ethers';
import { ethers } from 'hardhat';

import { deriveBeaconId } from '../../src/utils';
import { DapiDataRegistry__factory, HashRegistry__factory } from '../../typechain-types';
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

export const deriveRootRole = (managerAddress: string) => {
  return ethers.utils.solidityKeccak256(['address'], [managerAddress]);
};

export const deriveRole = (adminRole: string, roleDescription: string) => {
  return ethers.utils.solidityKeccak256(
    ['bytes32', 'bytes32'],
    [adminRole, ethers.utils.solidityKeccak256(['string'], [roleDescription])]
  );
};

const buildEIP712Domain = (name: string, chainId: number, verifyingContract: string) => {
  return {
    name,
    version: '1.0.0',
    chainId,
    verifyingContract,
  };
};

const updateBeacon = async (
  api3ServerV1: Api3ServerV1,
  airnodeWallet: Wallet,
  airseekerSponsorWallet: SignerWithAddress | Wallet,
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
  const [deployer, manager, registryOwner, api3MarketContract, rootSigner1, rootSigner2, rootSigner3, randomPerson] =
    await ethers.getSigners();

  // Deploy contracts
  const accessControlRegistryFactory = new AccessControlRegistry__factory(deployer as Signer);
  const accessControlRegistry = await accessControlRegistryFactory.deploy();
  const api3ServerV1Factory = new Api3ServerV1__factory(deployer as Signer);
  const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
  const api3ServerV1 = await api3ServerV1Factory.deploy(
    accessControlRegistry.address,
    api3ServerV1AdminRoleDescription,
    manager!.address
  );
  const hashRegistryFactory = new HashRegistry__factory(deployer as Signer);
  const hashRegistry = await hashRegistryFactory.deploy();
  await hashRegistry.connect(deployer!).transferOwnership(registryOwner!.address);
  const dapiDataRegistryFactory = new DapiDataRegistry__factory(deployer as Signer);
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
  const registrarRoleDescription = await dapiDataRegistry.REGISTRAR_ROLE_DESCRIPTION();
  const registrarRole = deriveRole(dapiDataRegistryAdminRole, registrarRoleDescription);
  await accessControlRegistry
    .connect(manager!)
    .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
  await accessControlRegistry
    .connect(manager!)
    .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, registrarRoleDescription);
  await accessControlRegistry.connect(manager!).grantRole(registrarRole, api3MarketContract!.address);
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

  // Initialize sponsor wallets
  // TODO: This is the old Airseeker wallet derivation. We should have a dedicated wallet for each dAPI.
  const airseekerSponsorWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  await deployer!.sendTransaction({
    to: airseekerSponsorWallet.address,
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
    airseekerSponsorWallet,
    krakenBtcBeacon.templateId,
    Math.floor(740 * 1_000_000)
  );
  await updateBeacon(
    api3ServerV1,
    krakenAirnodeWallet,
    airseekerSponsorWallet,
    krakenEthBeacon.templateId,
    Math.floor(41_000 * 1_000_000)
  );
  await updateBeacon(
    api3ServerV1,
    binanceAirnodeWallet,
    airseekerSponsorWallet,
    binanceBtcBeacon.templateId,
    Math.floor(750 * 1_000_000)
  );
  await updateBeacon(
    api3ServerV1,
    binanceAirnodeWallet,
    airseekerSponsorWallet,
    binanceEthBeacon.templateId,
    Math.floor(41_200 * 1_000_000)
  );

  // Update beacon sets
  await api3ServerV1
    .connect(airseekerSponsorWallet)
    .updateBeaconSetWithBeacons([binanceBtcBeacon.beaconId, krakenBtcBeacon.beaconId], { gasLimit: 500_000 });
  await api3ServerV1
    .connect(airseekerSponsorWallet)
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
  const { chainId } = await hashRegistry.provider.getNetwork();
  const domain = buildEIP712Domain('HashRegistry', chainId, hashRegistry.address);
  const types = {
    SignedHash: [
      { name: 'hashType', type: 'bytes32' },
      { name: 'hash', type: 'bytes32' },
      { name: 'timestamp', type: 'uint256' },
    ],
  };
  const apiTreeValues = [
    [krakenAirnodeWallet.address, 'https://kraken.com/'],
    [binanceAirnodeWallet.address, 'https://binance.com/'],
  ] as const;
  const apiTree = StandardMerkleTree.of(apiTreeValues as any, ['address', 'string']);
  const apiHashType = ethers.utils.solidityKeccak256(['string'], ['Signed API URL Merkle tree root']);
  const rootSigners = [rootSigner1!, rootSigner2!, rootSigner3!];
  const apiTreeRootSignatures = await Promise.all(
    rootSigners.map(async (rootSigner) =>
      rootSigner._signTypedData(domain, types, {
        hashType: apiHashType,
        hash: apiTree.root,
        timestamp,
      })
    )
  );
  await hashRegistry.connect(registryOwner!).setupSigners(
    apiHashType,
    rootSigners.map((rootSigner) => rootSigner.address)
  );
  await hashRegistry.registerHash(apiHashType, apiTree.root, timestamp, apiTreeRootSignatures);

  // Add dAPIs hashes
  const dapiNamesInfo = [
    ['BTC/USD', btcBeaconSetId, airseekerSponsorWallet.address],
    ['ETH/USD', ethBeaconSetId, airseekerSponsorWallet.address],
  ] as const;
  const dapiTreeValues = dapiNamesInfo.map(([dapiName, beaconSetId, sponsorWalletAddress]) => {
    return [ethers.utils.formatBytes32String(dapiName), beaconSetId, sponsorWalletAddress];
  });
  const dapiTree = StandardMerkleTree.of(dapiTreeValues, ['bytes32', 'bytes32', 'address']);
  const dapiTreeRoot = dapiTree.root;
  const dapiHashType = ethers.utils.solidityKeccak256(['string'], ['dAPI management Merkle tree root']);
  const dapiTreeRootSignatures = await Promise.all(
    rootSigners.map(async (rootSigner) =>
      rootSigner._signTypedData(domain, types, {
        hashType: dapiHashType,
        hash: dapiTreeRoot,
        timestamp,
      })
    )
  );
  await hashRegistry.connect(registryOwner!).setupSigners(
    dapiHashType,
    rootSigners.map((rootSigner) => rootSigner.address)
  );
  await hashRegistry.registerHash(dapiHashType, dapiTreeRoot, timestamp, dapiTreeRootSignatures);

  // Set active dAPIs
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
    },
    {
      airnodes: [binanceAirnodeWallet.address, krakenAirnodeWallet.address],
      templateIds: [binanceEthBeacon.templateId, krakenEthBeacon.templateId],
    },
  ];
  for (const dapiInfo of dapiInfos) {
    const { airnodes, templateIds } = dapiInfo;

    const encodedBeaconSetData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'bytes32[]'],
      [airnodes, templateIds]
    );
    await dapiDataRegistry.connect(randomPerson!).registerDataFeed(encodedBeaconSetData);
    const HUNDRED_PERCENT = 1e8;
    const deviationThresholdInPercentage = ethers.BigNumber.from(HUNDRED_PERCENT / 50); // 2%
    const deviationReference = ethers.constants.Zero; // Not used in Airseeker V1
    const heartbeatInterval = ethers.BigNumber.from(86_400); // 24 hrs
    const [dapiTreeValue] = dapiTreeValues;
    const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue!;
    await dapiDataRegistry
      .connect(api3MarketContract!)
      .addDapi(
        dapiName!,
        beaconSetId!,
        sponsorWallet!,
        deviationThresholdInPercentage,
        deviationReference,
        heartbeatInterval,
        dapiTree.root,
        dapiTree.getProof(dapiTreeValue!)
      );
  }
  // TODO: Generate proper config (change sponsor wallet mnemonic, deployed contract addresses, etc...)
  const config = generateTestConfig();
  config.sponsorWalletMnemonic = airseekerSponsorWallet.mnemonic.phrase;
  config.chains[31_337]!.contracts.Api3ServerV1 = api3ServerV1.address;
  config.chains[31_337]!.contracts.DapiDataRegistry = dapiDataRegistry.address;

  return {
    accessControlRegistry,
    api3ServerV1,
    btcBeaconSetId,
    ethBeaconSetId,
    config,
    dapiDataRegistry,
  };
};
