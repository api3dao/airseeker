import { deriveBeaconId, type Address, type Hex } from '@api3/commons';
import {
  AccessControlRegistry__factory as AccessControlRegistryFactory,
  Api3ServerV1__factory as Api3ServerV1Factory,
} from '@api3/contracts';
import { ethers, type Signer } from 'ethers';
import { ethers as hardhatEthers } from 'hardhat';

import { getApi3ServerV1BuilderTipExtension } from '../../src/update-feeds-loops/contracts';
import { generateRandomBytes, generateSignedData } from '../utils';

// Exercises the reference Api3ServerV1BuilderTipExtension contract (compiled from the "contracts" directory) through
// the hand-written production ABI, so that a drift between the two, or a regression in the contract itself, fails in
// CI instead of on-chain.
it('updates data feeds and tips the block builder through the reference extension contract', async () => {
  const [deployer, updater] = await hardhatEthers.getSigners();

  // Deploy Api3ServerV1 and the reference extension.
  const accessControlRegistry = await new AccessControlRegistryFactory(deployer as unknown as Signer).deploy();
  const api3ServerV1 = await new Api3ServerV1Factory(deployer as unknown as Signer).deploy(
    accessControlRegistry.getAddress(),
    'Api3ServerV1 admin',
    deployer!.address
  );
  const api3ServerV1BuilderTipExtensionFactory = await hardhatEthers.getContractFactory(
    'Api3ServerV1BuilderTipExtension',
    deployer
  );
  const deployedApi3ServerV1BuilderTipExtension = await api3ServerV1BuilderTipExtensionFactory.deploy(
    api3ServerV1.getAddress()
  );

  // Use the production helper (and thus the hand-written ABI) against the deployed bytecode.
  const api3ServerV1BuilderTipExtension = getApi3ServerV1BuilderTipExtension(
    await deployedApi3ServerV1BuilderTipExtension.getAddress(),
    updater!
  );

  // The wrapped Api3ServerV1 address is readable (used by the pre-tip verification).
  expect(await api3ServerV1BuilderTipExtension.api3ServerV1.staticCall()).toBe(await api3ServerV1.getAddress());

  // Prepare an Airseeker-style beacon update calldata batch.
  const airnode = ethers.Wallet.createRandom();
  const templateId = generateRandomBytes(32);
  const beaconId = deriveBeaconId(airnode.address as Address, templateId) as Hex;
  const timestamp = ((await hardhatEthers.provider.getBlock('latest'))!.timestamp + 1).toString();
  const signedData = await generateSignedData(airnode, templateId, timestamp, 123n);
  const calldata = [
    api3ServerV1.interface.encodeFunctionData('updateBeaconWithSignedData', [
      signedData.airnode,
      signedData.templateId,
      signedData.timestamp,
      signedData.encodedValue,
      signedData.signature,
    ]),
  ];

  // The strict variant estimates with the 1 wei placeholder tip (the production gas estimation path).
  const gasEstimate = await api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas(calldata, { value: 1n });
  expect(gasEstimate).toBeGreaterThan(0n);

  // A zero-value tip is rejected.
  await expect(api3ServerV1BuilderTipExtension.tryMulticallAndTip.send(calldata, { value: 0 })).rejects.toThrow(
    'Tip amount zero'
  );

  // The tipped submission updates the beacon and transfers exactly the tip to the coinbase. A zero priority fee is
  // used so that the coinbase balance delta equals the tip.
  const coinbase = (await hardhatEthers.provider.getBlock('latest'))!.miner;
  const coinbaseBalance = await hardhatEthers.provider.getBalance(coinbase);
  const tipAmount = ethers.parseEther('0.01');
  const transactionResponse = await api3ServerV1BuilderTipExtension.tryMulticallAndTip.send(calldata, {
    value: tipAmount,
    maxFeePerGas: ethers.parseUnits('100', 'gwei'),
    maxPriorityFeePerGas: 0,
  });
  await transactionResponse.wait();
  const dataFeed = await api3ServerV1.dataFeeds(beaconId);
  expect(dataFeed.value).toBe(123n);
  expect(dataFeed.timestamp).toBe(BigInt(timestamp));
  expect((await hardhatEthers.provider.getBalance(coinbase)) - coinbaseBalance).toBe(tipAmount);

  // With the beacon already updated, the strict variant reverts with the message that the gas estimation failure
  // handling detects to skip unnecessary updates.
  await expect(api3ServerV1BuilderTipExtension.multicallAndTip.estimateGas(calldata, { value: 1n })).rejects.toThrow(
    'Does not update timestamp'
  );
});
