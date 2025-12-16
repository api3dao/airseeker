import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { encode } from '@api3/airnode-abi';
import {
  deriveBeaconId,
  interpolateSecretsIntoConfig,
  loadConfig,
  loadSecrets,
  type Address,
  type Hex,
} from '@api3/commons';
import {
  AccessControlRegistry__factory as AccessControlRegistryFactory,
  AirseekerRegistry__factory as AirseekerRegistryFactory,
  Api3ServerV1__factory as Api3ServerV1Factory,
} from '@api3/contracts';
import dotenv from 'dotenv';
import { type JsonRpcProvider, NonceManager, ethers } from 'ethers';
import { zip } from 'lodash';

import { HUNDRED_PERCENT } from '../../src/constants';
import { getGasPrice } from '../../src/gas-price';
import { deriveSponsorWallet, encodeDapiName, sleep } from '../../src/utils';

interface RawBeaconData {
  airnodeAddress: Address;
  endpointId: Hex;
  parameters: {
    type: string;
    name: string;
    value: string;
  }[];
}

const deriveBeaconData = (beaconData: RawBeaconData) => {
  const { endpointId, parameters: parameters, airnodeAddress } = beaconData;

  const encodedParameters = encode(parameters);
  const templateId = ethers.solidityPackedKeccak256(['bytes32', 'bytes'], [endpointId, encodedParameters]) as Hex;
  const beaconId = deriveBeaconId(airnodeAddress, templateId);

  return { endpointId, templateId, encodedParameters, beaconId, parameters, airnodeAddress };
};

export const deriveRootRole = (managerAddress: string) => {
  return ethers.solidityPackedKeccak256(['address'], [managerAddress]);
};

export const deriveRole = (adminRole: string, roleDescription: string) => {
  return ethers.solidityPackedKeccak256(
    ['bytes32', 'bytes32'],
    [adminRole, ethers.solidityPackedKeccak256(['string'], [roleDescription])]
  );
};

function encodeUpdateParameters() {
  const deviationThresholdInPercentage = HUNDRED_PERCENT / 100n; // 1%
  const deviationReference = 0;
  const heartbeatInterval = 86_400; // 24 hrs
  const updateParameters = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'int224', 'uint256'],
    [deviationThresholdInPercentage, deviationReference, heartbeatInterval]
  );
  return updateParameters;
}

// NOTE: This function is not used by the initialization script, but you can use it after finishing Airseeker test on a
// public testnet to refund test ETH from sponsor wallets to the funder wallet.
export const refundFunder = async (funderWallet: ethers.NonceManager, provider: JsonRpcProvider) => {
  const configPath = join(__dirname, `/../airseeker`);
  const rawConfig = loadConfig(join(configPath, 'airseeker.json'));
  const airseekerSecrets = dotenv.parse(readFileSync(join(configPath, 'secrets.env'), 'utf8'));
  const airseekerWalletMnemonic = airseekerSecrets.SPONSOR_WALLET_MNEMONIC;
  if (!airseekerWalletMnemonic) throw new Error('SPONSOR_WALLET_MNEMONIC not found in Airseeker secrets');

  // Initialize sponsor wallets
  for (const beaconSetName of getBeaconSetNames()) {
    const dapiName = encodeDapiName(beaconSetName);
    const updateParameters = encodeUpdateParameters();

    const sponsorWallet = deriveSponsorWallet(airseekerWalletMnemonic, {
      ...rawConfig.walletDerivationScheme,
      dapiNameOrDataFeedId: dapiName,
      updateParameters,
    }).connect(provider);
    const sponsorWalletBalance = await provider.getBalance(sponsorWallet);
    console.info('Sponsor wallet balance:', sponsorWallet.address, ethers.formatEther(sponsorWalletBalance.toString()));

    const gasPrice = await getGasPrice(provider);

    // We assume the legacy gas price will always exist. See:
    // https://api3workspace.slack.com/archives/C05TQPT7PNJ/p1699098552350519
    const gasFee = gasPrice * BigInt(21_000);
    if (sponsorWalletBalance < gasFee) {
      console.info('Sponsor wallet balance is too low, skipping refund');
      continue;
    }
    const tx = await sponsorWallet.sendTransaction({
      to: funderWallet,
      gasPrice,
      gasLimit: BigInt(21_000),
      value: sponsorWalletBalance - gasFee,
    });
    await tx.wait();
    await sleep(500); // 0.5 secs delay to allow hardhat node for mining tx

    console.info(`Refunding funder wallet from sponsor wallet`, {
      dapiName,
      sponsorWalletAddress: sponsorWallet.address,
    });
  }
};

const joinUrl = (url: string, path: string) => {
  return new URL(path, url).href;
};

const loadAirnodeFeedConfig = (airnodeFeedDir: 'airnode-feed-1' | 'airnode-feed-2') => {
  const configPath = join(__dirname, `/../`, airnodeFeedDir);
  const rawConfig = loadConfig(join(configPath, 'airnode-feed.json'));
  const rawSecrets = loadSecrets(join(configPath, 'secrets.env'));

  return interpolateSecretsIntoConfig(rawConfig, rawSecrets);
};

const getBeaconSetNames = () => {
  const airnodeFeed = loadAirnodeFeedConfig('airnode-feed-1');
  const airnodeFeedWallet = ethers.Wallet.fromPhrase(airnodeFeed.nodeSettings.airnodeWalletMnemonic);
  const airnodeFeedBeacons = Object.values(airnodeFeed.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: airnodeFeedWallet.address });
  });

  return airnodeFeedBeacons.map((beacon) => beacon.parameters[0]!.value);
};

export const fundAirseekerSponsorWallet = async (funderWallet: ethers.NonceManager) => {
  const configPath = join(__dirname, `/../airseeker`);
  const rawConfig = loadConfig(join(configPath, 'airseeker.json'));
  const airseekerSecrets = dotenv.parse(readFileSync(join(__dirname, `/../airseeker`, 'secrets.env'), 'utf8'));
  const airseekerWalletMnemonic = airseekerSecrets.SPONSOR_WALLET_MNEMONIC;
  if (!airseekerWalletMnemonic) throw new Error('SPONSOR_WALLET_MNEMONIC not found in Airseeker secrets');

  // Initialize sponsor wallets
  for (const beaconSetName of getBeaconSetNames()) {
    const dapiName = encodeDapiName(beaconSetName);
    const updateParameters = encodeUpdateParameters();

    const provider = funderWallet.provider!;
    const sponsorWallet = deriveSponsorWallet(airseekerWalletMnemonic, {
      ...rawConfig.walletDerivationScheme,
      dapiNameOrDataFeedId: dapiName,
      updateParameters,
    });
    const sponsorWalletBalance = await provider.getBalance(sponsorWallet);
    console.info('Sponsor wallet balance:', ethers.formatEther(sponsorWalletBalance.toString()));

    const tx = await funderWallet.sendTransaction({
      to: sponsorWallet,
      value: ethers.parseEther('0.1'),
    });
    await tx.wait();
    await sleep(500);

    console.info(`Funding sponsor wallets`, {
      dapiName,
      decodedDapiName: ethers.decodeBytes32String(dapiName),
      sponsorWalletAddress: sponsorWallet.address,
      balance: ethers.formatEther(await provider.getBalance(sponsorWallet)),
    });
  }
};

export const deploy = async (funderWallet: ethers.NonceManager, provider: ethers.JsonRpcProvider) => {
  // NOTE: It is OK if all of these roles are done via the funder wallet.
  const deployerAndManager = funderWallet;

  const randomPerson = ethers.Wallet.createRandom().connect(deployerAndManager.provider);
  const fundRandomPersonTx = await deployerAndManager.sendTransaction({
    to: randomPerson,
    value: ethers.parseEther('1'),
  });
  await fundRandomPersonTx.wait();
  await sleep(500);

  // Deploy contracts
  const accessControlRegistryFactory = new AccessControlRegistryFactory(deployerAndManager);
  const accessControlRegistry = await accessControlRegistryFactory.deploy();
  await accessControlRegistry.waitForDeployment();
  await sleep(500);

  const api3ServerV1Factory = new Api3ServerV1Factory(deployerAndManager);
  const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
  const api3ServerV1 = await api3ServerV1Factory.deploy(
    accessControlRegistry.getAddress(),
    api3ServerV1AdminRoleDescription,
    deployerAndManager
  );
  await api3ServerV1.waitForDeployment();
  await sleep(500);

  const airseekerRegistryFactory = new AirseekerRegistryFactory(deployerAndManager);
  const airseekerRegistry = await airseekerRegistryFactory.deploy(deployerAndManager, api3ServerV1.getAddress());
  await airseekerRegistry.waitForDeployment();
  await sleep(500);

  // Create templates
  const airnodeFeed1 = loadAirnodeFeedConfig('airnode-feed-1');
  const airnodeFeed2 = loadAirnodeFeedConfig('airnode-feed-2');
  const airnodeFeed1Wallet = ethers.Wallet.fromPhrase(airnodeFeed1.nodeSettings.airnodeWalletMnemonic).connect(
    provider
  );
  const airnodeFeed2Wallet = ethers.Wallet.fromPhrase(airnodeFeed2.nodeSettings.airnodeWalletMnemonic, provider);
  const airnodeFeed1Beacons = Object.values(airnodeFeed1.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: airnodeFeed1Wallet.address });
  });
  const airnodeFeed2Beacons = Object.values(airnodeFeed2.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: airnodeFeed2Wallet.address });
  });

  // Set active dAPIs
  const apiTreeValues = [
    [airnodeFeed1Wallet.address, joinUrl(airnodeFeed1.signedApis[0].url, 'default')], // NOTE: Airnode feed pushes to the "/" of the Signed API, but we need to query it additional path.
    [airnodeFeed2Wallet.address, joinUrl(airnodeFeed2.signedApis[0].url, 'default')], // NOTE: Airnode feed pushes to the "/" of the Signed API, but we need to query it additional path.
  ] as const;
  for (const [airnode, url] of apiTreeValues) {
    const setSignedApiUrlTx = await airseekerRegistry.connect(deployerAndManager).setSignedApiUrl(airnode, url);
    await setSignedApiUrlTx.wait();
    await sleep(500);
  }
  const dapiInfos = zip(airnodeFeed1Beacons, airnodeFeed2Beacons).map(([airnodeFeed1Beacon, airnodeFeed2Beacon]) => {
    return {
      airnodes: [airnodeFeed1Beacon!.airnodeAddress, airnodeFeed2Beacon!.airnodeAddress],
      templateIds: [airnodeFeed1Beacon!.templateId, airnodeFeed1Beacon!.templateId],
      dapiName: encodeDapiName(airnodeFeed1Beacon!.parameters[0]!.value),
      beaconSetId: ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32[]'],
          [[airnodeFeed1Beacon!.beaconId, airnodeFeed2Beacon!.beaconId]]
        )
      ),
    };
  });
  for (const dapiInfo of dapiInfos) {
    const { airnodes, templateIds, dapiName, beaconSetId } = dapiInfo;

    const encodedBeaconSetData = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address[]', 'bytes32[]'],
      [airnodes, templateIds]
    );
    const registerDataFeedTx = await airseekerRegistry.connect(randomPerson).registerDataFeed(encodedBeaconSetData);
    await registerDataFeedTx.wait();
    await sleep(500);

    const updateParameters = encodeUpdateParameters();
    const setDapiNameTx = await api3ServerV1.connect(deployerAndManager).setDapiName(dapiName, beaconSetId);
    await setDapiNameTx.wait();
    await sleep(500);

    const setDapiNameToBeActivatedTx = await airseekerRegistry
      .connect(deployerAndManager)
      .setDapiNameToBeActivated(dapiName);
    await setDapiNameToBeActivatedTx.wait();
    await sleep(500);

    const setDapiNameUpdateParametersTx = await airseekerRegistry
      .connect(deployerAndManager)
      .setDapiNameUpdateParameters(dapiName, updateParameters);
    await setDapiNameUpdateParametersTx.wait();
    await sleep(500);
  }

  return {
    accessControlRegistry,
    api3ServerV1,
    airseekerRegistry,

    airnodeFeed1Wallet,
    airnodeFeed2Wallet,

    airnodeFeed1Beacons,
    airnodeFeed2Beacons,
    beaconSetNames: airnodeFeed1Beacons.map((beacon) => beacon.parameters[0]!.value),
  };
};

async function main() {
  dotenv.config({ path: `${__dirname}/.env`, quiet: true });
  if (!process.env.FUNDER_MNEMONIC) throw new Error('FUNDER_MNEMONIC not found');
  if (!process.env.PROVIDER_URL) throw new Error('PROVIDER_URL not found');

  const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL, undefined, {
    staticNetwork: true,
    polling: true,
    pollingInterval: 100,
  });
  const funderWallet = new NonceManager(ethers.Wallet.fromPhrase(process.env.FUNDER_MNEMONIC, provider));

  await refundFunder(funderWallet, provider);
  const balance = await provider.getBalance(funderWallet);
  console.info('Funder balance:', ethers.formatEther(balance.toString()));
  console.info();

  const { api3ServerV1, airseekerRegistry } = await deploy(funderWallet, provider);
  console.info('Api3ServerV1 deployed at:', await api3ServerV1.getAddress());
  console.info('AirseekerRegistry deployed at:', await airseekerRegistry.getAddress());
  console.info();

  await fundAirseekerSponsorWallet(funderWallet);
}

void main();
