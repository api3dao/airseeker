import type { Api3ServerV1 } from '@api3/airnode-protocol-v1';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { AIRSEEKER_PROTOCOL_ID } from '../constants';
import { getAirseekerRecommendedGasPrice } from '../gas-price/gas-price';
import { logger } from '../logger';
import { getState } from '../state';
import type { SignedData, ChainId, Provider } from '../types';

import type { ReadDapiWithIndexResponse } from './dapi-data-registry';

export interface UpdateableBeacon {
  beaconId: string;
  signedData: SignedData;
}

export interface UpdateableDapi {
  dapiInfo: ReadDapiWithIndexResponse;
  updateableBeacons: UpdateableBeacon[];
}

export const updateFeeds = async (
  chainId: ChainId,
  providerName: Provider,
  provider: ethers.providers.StaticJsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updateableDapis: UpdateableDapi[]
) => {
  const state = getState();
  const {
    config: { chains, sponsorWalletMnemonic },
  } = state;

  // Update all of the dAPIs in parallel.
  await Promise.all(
    updateableDapis.map(async (dapi) => {
      const { dapiInfo, updateableBeacons } = dapi;
      const {
        dapiName,
        decodedDataFeed: { dataFeedId },
      } = dapiInfo;

      await logger.runWithContext({ dapiName, dataFeedId }, async () => {
        const goUpdate = await go(async () => {
          // Create calldata for all beacons of the particular data feed the dAPI points to.
          const beaconUpdateCalls = updateableBeacons.map((beacon) => {
            const { signedData } = beacon;

            return api3ServerV1.interface.encodeFunctionData('updateBeaconWithSignedData', [
              signedData.airnode,
              signedData.templateId,
              signedData.timestamp,
              signedData.encodedValue,
              signedData.signature,
            ]);
          });

          // If there are multiple beacons in the data feed it's a beacons set which we need to update as well.
          const dataFeedUpdateCalldatas =
            beaconUpdateCalls.length > 1
              ? [
                  ...beaconUpdateCalls,
                  api3ServerV1.interface.encodeFunctionData('updateBeaconSetWithBeacons', [
                    updateableBeacons.map(({ beaconId }) => beaconId),
                  ]),
                ]
              : beaconUpdateCalls;

          logger.debug('Estimating gas limit');
          const gasLimit = await estimateMulticallGasLimit(
            api3ServerV1,
            dataFeedUpdateCalldatas,
            updateableBeacons.map((beacon) => beacon.beaconId)
          );

          logger.debug('Deriving sponsor wallet');
          // TODO: These wallets could be persisted as a performance optimization.
          const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dapiName);

          const gasPrice = await getAirseekerRecommendedGasPrice(
            chainId,
            providerName,
            provider,
            chains[chainId]!.gasSettings,
            sponsorWallet.address
          );

          logger.debug('Updating dAPI', { gasPrice, gasLimit });
          await api3ServerV1
            // When we add the sponsor wallet (signer) without connecting it to the provider, the provider of the
            // contract will be set to "null". We need to connect the sponsor wallet to the provider of the contract.
            .connect(sponsorWallet.connect(api3ServerV1.provider))
            .tryMulticall(dataFeedUpdateCalldatas, { gasPrice, gasLimit });
          logger.debug('Successfully updated dAPI');
        });

        if (!goUpdate.success) {
          logger.error(`Failed to update a dAPI`, goUpdate.error);
        }
      });
    })
  );
};

export const estimateMulticallGasLimit = async (
  api3ServerV1: Api3ServerV1,
  calldatas: string[],
  beaconIds: string[]
) => {
  const goEstimateGas = await go(async () => api3ServerV1.estimateGas.multicall(calldatas));
  if (goEstimateGas.success) {
    // Adding a extra 10% because multicall consumes less gas than tryMulticall
    return goEstimateGas.data.mul(ethers.BigNumber.from(Math.round(1.1 * 100))).div(ethers.BigNumber.from(100));
  }
  logger.warn(`Unable to estimate gas for multicall`, goEstimateGas.error);

  const goEstimateDummyBeaconUpdateGas = await go(async () => {
    const { dummyAirnode, dummyBeaconTemplateId, dummyBeaconTimestamp, dummyBeaconData, dummyBeaconSignature } =
      await createDummyBeaconUpdateData();
    return [
      await api3ServerV1.estimateGas.updateBeaconWithSignedData(
        dummyAirnode.address,
        dummyBeaconTemplateId,
        dummyBeaconTimestamp,
        dummyBeaconData,
        dummyBeaconSignature
      ),
      await api3ServerV1.estimateGas.updateBeaconSetWithBeacons(beaconIds),
    ] as const;
  });
  if (goEstimateDummyBeaconUpdateGas.success) {
    const [updateBeaconWithSignedDataGas, updateBeaconSetWithBeaconsGas] = goEstimateDummyBeaconUpdateGas.data;
    return updateBeaconWithSignedDataGas.mul(beaconIds.length).add(updateBeaconSetWithBeaconsGas);
  }

  return ethers.BigNumber.from(2_000_000);
};

export const deriveSponsorWallet = (sponsorWalletMnemonic: string, dapiName: string) => {
  // Take first 20 bytes of dapiName as sponsor address together with the "0x" prefix.
  const sponsorAddress = ethers.utils.getAddress(dapiName.slice(0, 42));
  const sponsorWallet = ethers.Wallet.fromMnemonic(
    sponsorWalletMnemonic,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress)}`
  );
  logger.debug('Derived sponsor wallet', { sponsorAddress, sponsorWalletAddress: sponsorWallet.address });

  return sponsorWallet;
};

export function deriveWalletPathFromSponsorAddress(sponsorAddress: string) {
  const sponsorAddressBN = ethers.BigNumber.from(sponsorAddress);
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `${AIRSEEKER_PROTOCOL_ID}/${paths.join('/')}`;
}

export const createDummyBeaconUpdateData = async (dummyAirnode: ethers.Wallet = ethers.Wallet.createRandom()) => {
  const dummyBeaconTemplateId = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const dummyBeaconTimestamp = Math.floor(Date.now() / 1000);
  const randomBytes = ethers.utils.randomBytes(Math.floor(Math.random() * 27) + 1);
  const dummyBeaconData = ethers.utils.defaultAbiCoder.encode(
    ['int224'],
    // Any random number that fits into an int224
    [ethers.BigNumber.from(randomBytes)]
  );
  const dummyBeaconSignature = await dummyAirnode.signMessage(
    ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(
        ['bytes32', 'uint256', 'bytes'],
        [dummyBeaconTemplateId, dummyBeaconTimestamp, dummyBeaconData]
      )
    )
  );
  return { dummyAirnode, dummyBeaconTemplateId, dummyBeaconTimestamp, dummyBeaconData, dummyBeaconSignature };
};
