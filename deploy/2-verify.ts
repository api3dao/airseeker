import { CHAINS } from '@api3/contracts';
import { deployments, network, run } from 'hardhat';

module.exports = async function verifyApi3ServerV1BuilderTipExtension() {
  const verificationApiType = CHAINS.find((chain) => chain.alias === network.name)?.verificationApi?.type;

  if (verificationApiType === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`⚠️ Attention: Verification API type is not defined for ${network.name}, skipping verification.`);
    return;
  }

  const verifyTask = verificationApiType === 'other' ? 'verify:blockscout' : `verify:${verificationApiType}`;

  const api3ServerV1BuilderTipExtension = await deployments.get('Api3ServerV1BuilderTipExtension');
  await run(verifyTask, {
    address: api3ServerV1BuilderTipExtension.address,
    constructorArgsParams: api3ServerV1BuilderTipExtension.args,
  });
};
module.exports.tags = ['verify'];
