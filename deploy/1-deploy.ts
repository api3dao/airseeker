import { CHAINS, deploymentAddresses } from '@api3/contracts';
import { deployments, ethers, network } from 'hardhat';

module.exports = async function deployApi3ServerV1BuilderTipExtension() {
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const chainId = CHAINS.find((chain) => chain.alias === network.name)?.id;
  const api3ServerV1Address =
    chainId && deploymentAddresses.Api3ServerV1[chainId as keyof typeof deploymentAddresses.Api3ServerV1];
  if (!api3ServerV1Address) {
    throw new Error(`Api3ServerV1 is not deployed on ${network.name}`);
  }

  if (!(await deployments.getOrNull('Api3ServerV1BuilderTipExtension'))) {
    await deploy('Api3ServerV1BuilderTipExtension', {
      from: deployer!.address,
      args: [api3ServerV1Address],
      log: true,
      deterministicDeployment: process.env.DETERMINISTIC ? ethers.ZeroHash : '',
    });
  }
};
module.exports.tags = ['deploy'];
