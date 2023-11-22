import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as abi from '@api3/airnode-abi';
import {
  AccessControlRegistry__factory as AccessControlRegistryFactory,
  Api3ServerV1__factory as Api3ServerV1Factory,
} from '@api3/airnode-protocol-v1';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import dotenv from 'dotenv';
import type { ContractTransaction, Signer } from 'ethers';
import { ethers } from 'ethers';
import { zip } from 'lodash';

import { interpolateSecrets, parseSecrets } from '../../src/config/utils';
import {
  DapiDataRegistry__factory as DapiDataRegistryFactory,
  HashRegistry__factory as HashRegistryFactory,
} from '../../src/typechain-types';
import { deriveBeaconId, deriveSponsorWallet } from '../../src/utils';

interface RawBeaconData {
  airnodeAddress: string;
  endpointId: string;
  parameters: {
    type: string;
    name: string;
    value: string;
  }[];
}

const deriveBeaconData = (beaconData: RawBeaconData) => {
  const { endpointId, parameters: parameters, airnodeAddress } = beaconData;

  const encodedParameters = abi.encode(parameters);
  const templateId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointId, encodedParameters]);
  const beaconId = deriveBeaconId(airnodeAddress, templateId)!;

  return { endpointId, templateId, encodedParameters, beaconId, parameters, airnodeAddress };
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

const loadPusherConfig = (pusherDir: 'pusher-1' | 'pusher-2') => {
  const configPath = join(__dirname, `/../`, pusherDir);
  const rawConfig = JSON.parse(readFileSync(join(configPath, 'pusher.json'), 'utf8'));
  const rawSecrets = dotenv.parse(readFileSync(join(configPath, 'secrets.env'), 'utf8'));

  const secrets = parseSecrets(rawSecrets);
  return interpolateSecrets(rawConfig, secrets);
};

const getBeaconSetNames = () => {
  const pusher = loadPusherConfig('pusher-1');
  const pusherWallet = ethers.Wallet.fromMnemonic(pusher.nodeSettings.airnodeWalletMnemonic);
  const pusherBeacons = Object.values(pusher.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: pusherWallet.address });
  });

  return pusherBeacons.map((beacon) => beacon.parameters[0]!.value);
};

export const fundAirseekerSponsorWallet = async (funderWallet: ethers.Wallet) => {
  const airseekerSecrets = dotenv.parse(readFileSync(join(__dirname, `/../airseeker`, 'secrets.env'), 'utf8'));
  const airseekerWalletMnemonic = airseekerSecrets.SPONSOR_WALLET_MNEMONIC;
  if (!airseekerWalletMnemonic) throw new Error('SPONSOR_WALLET_MNEMONIC not found in Airseeker secrets');

  // Initialize sponsor wallets
  for (const beaconSetName of getBeaconSetNames()) {
    const dapiName = ethers.utils.formatBytes32String(beaconSetName);

    const sponsorWallet = deriveSponsorWallet(airseekerWalletMnemonic, dapiName);
    const sponsorWalletBalance = await funderWallet.provider.getBalance(sponsorWallet.address);
    console.info('Sponsor wallet balance:', ethers.utils.formatEther(sponsorWalletBalance.toString()));

    const tx = await funderWallet.sendTransaction({
      to: sponsorWallet.address,
      value: ethers.utils.parseEther('1'),
    });
    await tx.wait();

    console.info(`Funding sponsor wallets`, {
      dapiName,
      sponsorWalletAddress: sponsorWallet.address,
    });
  }
};

export const deploy = async (funderWallet: ethers.Wallet, provider: ethers.providers.JsonRpcProvider) => {
  // NOTE: It is OK if all of these roles are done via the funder wallet.
  const deployer = funderWallet,
    manager = funderWallet,
    registryOwner = funderWallet,
    api3MarketContract = funderWallet,
    rootSigner1 = funderWallet,
    randomPerson = funderWallet;

  // Deploy contracts
  const accessControlRegistryFactory = new AccessControlRegistryFactory(deployer as Signer);
  const accessControlRegistry = await accessControlRegistryFactory.deploy();
  await accessControlRegistry.deployTransaction.wait();
  const api3ServerV1Factory = new Api3ServerV1Factory(deployer as Signer);
  const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
  const api3ServerV1 = await api3ServerV1Factory.deploy(
    accessControlRegistry.address,
    api3ServerV1AdminRoleDescription,
    manager.address
  );
  await api3ServerV1.deployTransaction.wait();
  const hashRegistryFactory = new HashRegistryFactory(deployer as Signer);
  const hashRegistry = await hashRegistryFactory.deploy();
  await hashRegistry.deployTransaction.wait();
  const transferOwnershipTx = await hashRegistry.connect(deployer).transferOwnership(registryOwner.address);
  await transferOwnershipTx.wait();
  const dapiDataRegistryFactory = new DapiDataRegistryFactory(deployer as Signer);
  const dapiDataRegistryAdminRoleDescription = 'DapiDataRegistry admin';
  const dapiDataRegistry = await dapiDataRegistryFactory.deploy(
    accessControlRegistry.address,
    dapiDataRegistryAdminRoleDescription,
    manager.address,
    hashRegistry.address,
    api3ServerV1.address
  );
  await dapiDataRegistry.deployTransaction.wait();

  // Set up roles
  const rootRole = deriveRootRole(manager.address);
  const dapiDataRegistryAdminRole = deriveRole(rootRole, dapiDataRegistryAdminRoleDescription);
  const dapiAdderRoleDescription = await dapiDataRegistry.DAPI_ADDER_ROLE_DESCRIPTION();
  const dapiAdderRole = deriveRole(dapiDataRegistryAdminRole, dapiAdderRoleDescription);
  const dapiRemoverRoleDescription = await dapiDataRegistry.DAPI_REMOVER_ROLE_DESCRIPTION();
  let tx: ContractTransaction;
  tx = await accessControlRegistry
    .connect(manager)
    .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
  await tx.wait();
  tx = await accessControlRegistry
    .connect(manager)
    .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, dapiAdderRoleDescription);
  await tx.wait();
  tx = await accessControlRegistry
    .connect(manager)
    .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, dapiRemoverRoleDescription);
  await tx.wait();
  tx = await accessControlRegistry.connect(manager).grantRole(dapiAdderRole, api3MarketContract.address);
  await tx.wait();
  tx = await accessControlRegistry
    .connect(manager)
    .initializeRoleAndGrantToSender(rootRole, api3ServerV1AdminRoleDescription);
  await tx.wait();
  tx = await accessControlRegistry
    .connect(manager)
    .initializeRoleAndGrantToSender(
      await api3ServerV1.adminRole(),
      await api3ServerV1.DAPI_NAME_SETTER_ROLE_DESCRIPTION()
    );
  await tx.wait();
  tx = await accessControlRegistry
    .connect(manager)
    .grantRole(await api3ServerV1.dapiNameSetterRole(), dapiDataRegistry.address);
  await tx.wait();

  // Create templates
  const pusher1 = loadPusherConfig('pusher-1');
  const pusher2 = loadPusherConfig('pusher-2');
  const pusher1Wallet = ethers.Wallet.fromMnemonic(pusher1.nodeSettings.airnodeWalletMnemonic).connect(provider);
  const pusher2Wallet = ethers.Wallet.fromMnemonic(pusher2.nodeSettings.airnodeWalletMnemonic).connect(provider);
  const pusher1Beacons = Object.values(pusher1.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: pusher1Wallet.address });
  });
  const pusher2Beacons = Object.values(pusher2.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: pusher2Wallet.address });
  });

  // Derive beacon set IDs and names
  const beaconSetIds = zip(pusher1Beacons, pusher2Beacons).map(([beacon1, beacon2]) =>
    ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [[beacon1!.beaconId, beacon2!.beaconId]]))
  );
  const beaconSetNames = pusher1Beacons.map((beacon) => beacon.parameters[0]!.value);

  // Register merkle tree hashes
  const timestamp = Math.floor(Date.now() / 1000);
  const apiTreeValues = [
    [pusher1Wallet.address, `${pusher1.signedApis[0].url}/default`], // NOTE: Pusher pushes to the "/" of the signed API, but we need to query it additional path.
    [pusher2Wallet.address, `${pusher2.signedApis[0].url}/default`], // NOTE: Pusher pushes to the "/" of the signed API, but we need to query it additional path.
  ] as const;
  const apiTree = StandardMerkleTree.of(apiTreeValues as any, ['address', 'string']);
  const apiHashType = ethers.utils.solidityKeccak256(['string'], ['Signed API URL Merkle tree root']);
  const rootSigners = [rootSigner1];
  const apiMessages = ethers.utils.arrayify(
    ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [apiHashType, apiTree.root, timestamp])
  );
  const apiTreeRootSignatures = await Promise.all(
    rootSigners.map(async (rootSigner) => rootSigner.signMessage(apiMessages))
  );
  tx = await hashRegistry.connect(registryOwner).setupSigners(
    apiHashType,
    rootSigners.map((rootSigner) => rootSigner.address)
  );
  await tx.wait();
  tx = await hashRegistry.registerHash(apiHashType, apiTree.root, timestamp, apiTreeRootSignatures);
  await tx.wait();

  // Add dAPIs hashes
  const airseekerSecrets = dotenv.parse(readFileSync(join(__dirname, `/../airseeker`, 'secrets.env'), 'utf8'));
  const airseekerWalletMnemonic = airseekerSecrets.SPONSOR_WALLET_MNEMONIC;
  if (!airseekerWalletMnemonic) throw new Error('SPONSOR_WALLET_MNEMONIC not found in Airseeker secrets');
  const dapiNamesInfo = zip(beaconSetNames, beaconSetIds).map(([beaconSetName, beaconSetId]) => {
    const sponsorWallet = deriveSponsorWallet(airseekerWalletMnemonic, beaconSetName!);
    return [beaconSetName!, beaconSetId!, sponsorWallet.address] as const;
  });
  const dapiTreeValues = dapiNamesInfo.map(([dapiName, beaconSetId, sponsorWalletAddress]) => {
    return [ethers.utils.formatBytes32String(dapiName), beaconSetId, sponsorWalletAddress];
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
  tx = await hashRegistry.connect(registryOwner).setupSigners(
    dapiHashType,
    rootSigners.map((rootSigner) => rootSigner.address)
  );
  await tx.wait();
  tx = await hashRegistry.registerHash(dapiHashType, dapiTreeRoot, timestamp, dapiTreeRootSignatures);
  await tx.wait();

  // Set active dAPIs
  const apiTreeRoot = apiTree.root;
  for (const [airnode, url] of apiTreeValues) {
    const apiTreeProof = apiTree.getProof([airnode, url]);
    tx = await dapiDataRegistry
      .connect(api3MarketContract)
      .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
    await tx.wait();
  }
  const dapiInfos = zip(pusher1Beacons, pusher2Beacons).map(([pusher1Beacon, pusher2Beacon], i) => {
    return {
      airnodes: [pusher1Beacon!.airnodeAddress, pusher2Beacon!.airnodeAddress],
      templateIds: [pusher1Beacon!.templateId, pusher1Beacon!.templateId],
      dapiTreeValue: dapiTreeValues[i]!,
    };
  });
  for (const dapiInfo of dapiInfos) {
    const { airnodes, templateIds, dapiTreeValue } = dapiInfo;

    const encodedBeaconSetData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'bytes32[]'],
      [airnodes, templateIds]
    );
    tx = await dapiDataRegistry.connect(randomPerson).registerDataFeed(encodedBeaconSetData);
    await tx.wait();
    const HUNDRED_PERCENT = 1e8;
    const deviationThresholdInPercentage = ethers.BigNumber.from(HUNDRED_PERCENT / 100); // 1%
    const deviationReference = ethers.constants.Zero; // Not used in Airseeker V1
    const heartbeatInterval = ethers.BigNumber.from(86_400); // 24 hrs
    const [dapiName, beaconSetId, sponsorWalletMnemonic] = dapiTreeValue;
    tx = await dapiDataRegistry
      .connect(api3MarketContract)
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
    await tx.wait();
  }

  return {
    accessControlRegistry,
    api3ServerV1,
    dapiDataRegistry,

    pusher1Wallet,
    pusher2Wallet,

    pusher1Beacons,
    pusher2Beacons,
    beaconSetNames,
  };
};

async function main() {
  dotenv.config({ path: `${__dirname}/.env` });
  if (!process.env.FUNDER_MNEMONIC) throw new Error('FUNDER_MNEMONIC not found');
  if (!process.env.PROVIDER_URL) throw new Error('PROVIDER_URL not found');

  const provider = new ethers.providers.StaticJsonRpcProvider(process.env.PROVIDER_URL);
  const funderWallet = ethers.Wallet.fromMnemonic(process.env.FUNDER_MNEMONIC).connect(provider);

  const balance = await funderWallet.getBalance();
  console.info('Funder balance:', ethers.utils.formatEther(balance.toString()));
  console.info();

  const { api3ServerV1, dapiDataRegistry } = await deploy(funderWallet, provider);
  console.info('Api3ServerV1 deployed at:', api3ServerV1.address);
  console.info('DapiDataRegistry deployed at:', dapiDataRegistry.address);
  console.info();

  await fundAirseekerSponsorWallet(funderWallet);
}

void main();
