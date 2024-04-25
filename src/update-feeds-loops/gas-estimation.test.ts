import type { Api3ServerV1 } from '@api3/contracts';

import { generateMockApi3ServerV1 } from '../../test/fixtures/mock-contract';
import { logger } from '../logger';

import { estimateMulticallGasLimit, estimateSingleBeaconGasLimit, handleRpcGasLimitFailure } from './gas-estimation';

describe(estimateMulticallGasLimit.name, () => {
  it('estimates the gas limit for a multicall', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.multicall.estimateGas.mockResolvedValueOnce(BigInt(500_000));

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xBeaconId1Calldata', '0xBeaconId2Calldata', '0xBeaconSetCalldata'],
      undefined
    );

    expect(gasLimit).toStrictEqual(BigInt(550_000)); // Note that the gas limit is increased by 10%.
  });

  it('uses fallback gas limit when dummy data estimation fails', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.multicall.estimateGas.mockRejectedValue(new Error('some-error'));
    jest.spyOn(logger, 'warn');

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xBeaconId1Calldata', '0xBeaconId2Calldata', '0xBeaconSetCalldata'],
      2_000_000
    );

    expect(gasLimit).toStrictEqual(BigInt(2_000_000));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Unable to estimate gas using provider.', {
      errorMessage: 'some-error',
    });
  });

  it('returns null if no fallback is provided', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.multicall.estimateGas.mockRejectedValue(new Error('some-error'));
    jest.spyOn(logger, 'info');
    jest.spyOn(logger, 'warn');

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xBeaconId1Calldata', '0xBeaconId2Calldata', '0xBeaconSetCalldata'],
      undefined
    );

    expect(gasLimit).toBeNull();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('No fallback gas limit provided. No gas limit to use.');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Unable to estimate gas using provider.', {
      errorMessage: 'some-error',
    });
  });

  it('detects a contract revert due to timestamp check', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.multicall.estimateGas.mockRejectedValue(new Error('Does not update timestamp'));
    jest.spyOn(logger, 'info');
    jest.spyOn(logger, 'warn');

    const gasLimit = await estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xBeaconId1Calldata', '0xBeaconId2Calldata', '0xBeaconSetCalldata'],
      2_000_000
    );

    expect(gasLimit).toBe(2_000_000n);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Gas estimation failed because of a contract revert.', {
      errorMessage: 'Does not update timestamp',
    });
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });
});

describe(handleRpcGasLimitFailure.name, () => {
  it('uses a fallback gas limit', () => {
    expect(handleRpcGasLimitFailure(new Error('some-error'), 2_000_000)).toStrictEqual(BigInt(2_000_000));
  });

  it('returns null if no gas limit is provided', () => {
    expect(handleRpcGasLimitFailure(new Error('some-error'), undefined)).toBeNull();
  });

  it('logs a warning for unknown rpc error', () => {
    jest.spyOn(logger, 'warn');

    handleRpcGasLimitFailure(new Error('some-error'), 2_000_000);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Unable to estimate gas using provider.', { errorMessage: 'some-error' });
  });

  it('logs info message when on contract revert error', () => {
    jest.spyOn(logger, 'info');

    handleRpcGasLimitFailure(new Error('Does not update timestamp'), 2_000_000);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Gas estimation failed because of a contract revert.', {
      errorMessage: 'Does not update timestamp',
    });
  });
});

describe(estimateSingleBeaconGasLimit.name, () => {
  it('estimates the gas limit for a single beacon update', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.updateBeaconWithSignedData.estimateGas.mockResolvedValueOnce(BigInt(500_000));

    const gasLimit = await estimateSingleBeaconGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      {
        beaconId: '0xBeaconId',
        signedData: {
          airnode: '0xAirnode',
          templateId: '0xTemplateId',
          timestamp: '1000000',
          encodedValue: '0xEncodedValue',
          signature: '0xSignature',
        },
      },
      undefined
    );

    expect(gasLimit).toStrictEqual(BigInt(500_000));
  });
});
