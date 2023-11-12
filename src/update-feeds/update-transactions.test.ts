import type { Api3ServerV1 } from '@api3/airnode-protocol-v1';
import { ethers } from 'ethers';

import { generateMockApi3ServerV1 } from '../../test/fixtures/mock-contract';

import { estimateMulticallGasLimit } from './update-transactions';

describe(estimateMulticallGasLimit.name, () => {
  it('estimates the gas limit for a multicall', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockResolvedValueOnce(ethers.BigNumber.from(500_000));

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xbeaconId1Calldata', '0xbeaconId2Calldata', '0xbeaconSetCalldata'],
      ['beaconId1', 'beaconId2']
    );

    expect(gasLimit).toStrictEqual(ethers.BigNumber.from(550_000)); // Note that the gas limit is increased by 10%.
  });

  it('uses dummy data estimation when multicall estimate fails', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockRejectedValue(
      new Error('e.g. one of the beacons has on chain value with higher timestamp')
    );
    mockApi3ServerV1.estimateGas.updateBeaconWithSignedData.mockResolvedValueOnce(ethers.BigNumber.from(50_000));
    mockApi3ServerV1.estimateGas.updateBeaconSetWithBeacons.mockResolvedValueOnce(ethers.BigNumber.from(30_000));

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xbeaconId1Calldata', '0xbeaconId2Calldata', '0xbeaconSetCalldata'],
      ['beaconId1', 'beaconId2']
    );

    expect(gasLimit).toStrictEqual(ethers.BigNumber.from(130_000));
  });

  it('uses fixed gas limit when dummy data estimation fails', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockRejectedValue(
      new Error('e.g. one of the beacons has on chain value with higher timestamp')
    );
    mockApi3ServerV1.estimateGas.updateBeaconWithSignedData.mockRejectedValue(new Error('provider-error'));
    mockApi3ServerV1.estimateGas.updateBeaconSetWithBeacons.mockRejectedValue(new Error('provider-error'));

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xbeaconId1Calldata', '0xbeaconId2Calldata', '0xbeaconSetCalldata'],
      ['beaconId1', 'beaconId2']
    );

    expect(gasLimit).toStrictEqual(ethers.BigNumber.from(2_000_000));
  });
});
