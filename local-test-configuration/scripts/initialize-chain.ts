import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { encode } from '@api3/airnode-abi';
import {
  AccessControlRegistry__factory as AccessControlRegistryFactory,
  Api3ServerV1__factory as Api3ServerV1Factory,
} from '@api3/airnode-protocol-v1';
import dotenv from 'dotenv';
import type { ContractTransaction, Signer } from 'ethers';
import { ethers } from 'ethers';
import { zip } from 'lodash';

import { interpolateSecrets, parseSecrets } from '../../src/config/utils';
import { AirseekerRegistry__factory as AirseekerRegistryFactory } from '../../src/typechain-types';
import { deriveBeaconId, deriveSponsorWallet, encodeDapiName } from '../../src/utils';

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

  const encodedParameters = encode(parameters);
  const templateId = ethers.solidityPackedKeccak256(['bytes32', 'bytes'], [endpointId, encodedParameters]);
  const beaconId = deriveBeaconId(airnodeAddress, templateId)!;

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

// NOTE: This function is not used by the initialization script, but you can use it after finishing Airseeker test on a
// public testnet to refund test ETH from sponsor wallets to the funder wallet.
export const refundFunder = async (funderWallet: ethers.Wallet) => {
  const airseekerSecrets = dotenv.parse(readFileSync(join(__dirname, `/../airseeker`, 'secrets.env'), 'utf8'));
  const airseekerWalletMnemonic = airseekerSecrets.SPONSOR_WALLET_MNEMONIC;
  if (!airseekerWalletMnemonic) throw new Error('SPONSOR_WALLET_MNEMONIC not found in Airseeker secrets');

  // Initialize sponsor wallets
  for (const beaconSetName of getBeaconSetNames()) {
    const dapiName = encodeDapiName(beaconSetName);

    const sponsorWallet = deriveSponsorWallet(airseekerWalletMnemonic, dapiName).connect(funderWallet.provider);
    const sponsorWalletBalance = await funderWallet.provider.getBalance(sponsorWallet.address);
    console.info('Sponsor wallet balance:', ethers.utils.formatEther(sponsorWalletBalance.toString()));

    const gasPrice = await sponsorWallet.provider.getGasPrice();
    const gasFee = gasPrice.mul(BigInt(21_000));
    if (sponsorWalletBalance.sub(gasFee).lt(0n)) {
      console.info('Sponsor wallet balance is too low, skipping refund');
      continue;
    }
    const tx = await sponsorWallet.sendTransaction({
      to: funderWallet.address,
      gasPrice,
      gasLimit: BigInt(21_000),
      value: sponsorWalletBalance.sub(gasFee),
    });
    await tx.wait();

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
  const rawConfig = JSON.parse(readFileSync(join(configPath, 'airnode-feed.json'), 'utf8'));
  const rawSecrets = dotenv.parse(readFileSync(join(configPath, 'secrets.env'), 'utf8'));

  const secrets = parseSecrets(rawSecrets);
  return interpolateSecrets(rawConfig, secrets);
};

const getBeaconSetNames = () => {
  const airnodeFeed = loadAirnodeFeedConfig('airnode-feed-1');
  const airnodeFeedWallet = ethers.Wallet.fromMnemonic(airnodeFeed.nodeSettings.airnodeWalletMnemonic);
  const airnodeFeedBeacons = Object.values(airnodeFeed.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: airnodeFeedWallet.address });
  });

  return airnodeFeedBeacons.map((beacon) => beacon.parameters[0]!.value);
};

export const fundAirseekerSponsorWallet = async (funderWallet: ethers.Wallet) => {
  const airseekerSecrets = dotenv.parse(readFileSync(join(__dirname, `/../airseeker`, 'secrets.env'), 'utf8'));
  const airseekerWalletMnemonic = airseekerSecrets.SPONSOR_WALLET_MNEMONIC;
  if (!airseekerWalletMnemonic) throw new Error('SPONSOR_WALLET_MNEMONIC not found in Airseeker secrets');

  // Initialize sponsor wallets
  for (const beaconSetName of getBeaconSetNames()) {
    const dapiName = encodeDapiName(beaconSetName);

    const sponsorWallet = deriveSponsorWallet(airseekerWalletMnemonic, dapiName);
    const sponsorWalletBalance = await funderWallet.provider.getBalance(sponsorWallet.address);
    console.info('Sponsor wallet balance:', ethers.utils.formatEther(sponsorWalletBalance.toString()));

    const tx = await funderWallet.sendTransaction({
      to: sponsorWallet.address,
      value: ethers.parseEther('1'),
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
  const deployerAndManager = funderWallet,
    randomPerson = funderWallet;

  // Deploy contracts
  const accessControlRegistryFactory = new AccessControlRegistryFactory(deployerAndManager as Signer);
  const accessControlRegistry = await accessControlRegistryFactory.deploy();
  await accessControlRegistry.deployTransaction.wait();
  const api3ServerV1Factory = new Api3ServerV1Factory(deployerAndManager as Signer);
  const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
  const api3ServerV1 = await api3ServerV1Factory.deploy(
    accessControlRegistry.address,
    api3ServerV1AdminRoleDescription,
    deployerAndManager.address
  );
  await api3ServerV1.deployTransaction.wait();
  const airseekerRegistryFactory = new AirseekerRegistryFactory(deployerAndManager as Signer);
  const airseekerRegistry = await airseekerRegistryFactory.deploy(
    await (deployerAndManager as Signer).getAddress(),
    api3ServerV1.address
  );
  await airseekerRegistry.deployTransaction.wait();

  // Create templates
  const airnodeFeed1 = loadAirnodeFeedConfig('airnode-feed-1');
  const airnodeFeed2 = loadAirnodeFeedConfig('airnode-feed-2');
  const airnodeFeed1Wallet = ethers.Wallet.fromMnemonic(airnodeFeed1.nodeSettings.airnodeWalletMnemonic).connect(
    provider
  );
  const airnodeFeed2Wallet = ethers.Wallet.fromMnemonic(airnodeFeed2.nodeSettings.airnodeWalletMnemonic).connect(
    provider
  );
  const airnodeFeed1Beacons = Object.values(airnodeFeed1.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: airnodeFeed1Wallet.address });
  });
  const airnodeFeed2Beacons = Object.values(airnodeFeed2.templates).map((template: any) => {
    return deriveBeaconData({ ...template, airnodeAddress: airnodeFeed2Wallet.address });
  });

  // Set active dAPIs
  const apiTreeValues = [
    [airnodeFeed1Wallet.address, joinUrl(airnodeFeed1.signedApis[0].url, 'default')], // NOTE: Airnode feed pushes to the "/" of the signed API, but we need to query it additional path.
    [airnodeFeed2Wallet.address, joinUrl(airnodeFeed2.signedApis[0].url, 'default')], // NOTE: Airnode feed pushes to the "/" of the signed API, but we need to query it additional path.
  ] as const;
  let tx: ContractTransaction;
  for (const [airnode, url] of apiTreeValues) {
    tx = await airseekerRegistry.connect(deployerAndManager).setSignedApiUrl(airnode, url);
    await tx.wait();
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
    tx = await airseekerRegistry.connect(randomPerson).registerDataFeed(encodedBeaconSetData);
    await tx.wait();
    const HUNDRED_PERCENT = 1e8;
    const deviationThresholdInPercentage = BigInt(HUNDRED_PERCENT / 100); // 1%
    const deviationReference = 0n; // Not used in Airseeker V2
    const heartbeatInterval = BigInt(86_400); // 24 hrs
    tx = await api3ServerV1.connect(deployerAndManager).setDapiName(dapiName, beaconSetId);
    await tx.wait();
    await airseekerRegistry.connect(deployerAndManager).setDapiNameToBeActivated(dapiName);
    await tx.wait();
    tx = await airseekerRegistry
      .connect(deployerAndManager)
      .setDapiNameUpdateParameters(
        dapiName,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256', 'uint256'],
          [deviationThresholdInPercentage, deviationReference, heartbeatInterval]
        )
      );
    await tx.wait();
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
  dotenv.config({ path: `${__dirname}/.env` });
  if (!process.env.FUNDER_MNEMONIC) throw new Error('FUNDER_MNEMONIC not found');
  if (!process.env.PROVIDER_URL) throw new Error('PROVIDER_URL not found');

  const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL, undefined, { staticNetwork: true });
  const funderWallet = ethers.Wallet.fromMnemonic(process.env.FUNDER_MNEMONIC).connect(provider);

  await refundFunder(funderWallet);
  const balance = await funderWallet.getBalance();
  console.info('Funder balance:', ethers.utils.formatEther(balance.toString()));
  console.info();

  const { api3ServerV1, airseekerRegistry } = await deploy(funderWallet, provider);
  console.info('Api3ServerV1 deployed at:', api3ServerV1.address);
  console.info('AirseekerRegistry deployed at:', airseekerRegistry.address);
  console.info();

  await fundAirseekerSponsorWallet(funderWallet);
}

void main();
