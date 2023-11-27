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
      undefined
    );

    expect(gasLimit).toStrictEqual(ethers.BigNumber.from(550_000)); // Note that the gas limit is increased by 10%.
  });

  it('uses fallback gas limit when dummy data estimation fails', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockRejectedValue(new Error('some-error'));

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xbeaconId1Calldata', '0xbeaconId2Calldata', '0xbeaconSetCalldata'],
      2_000_000
    );

    expect(gasLimit).toBe(2_000_000);
  });

  it('throws an error if no fallback is provided', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockRejectedValue(new Error('some-error'));

    await expect(async () =>
      estimateMulticallGasLimit(
        mockApi3ServerV1 as unknown as Api3ServerV1,
        ['0xbeaconId1Calldata', '0xbeaconId2Calldata', '0xbeaconSetCalldata'],
        undefined
      )
    ).rejects.toStrictEqual(new Error('Unable to estimate gas limit'));
  });
});
