import { ethers } from 'ethers';

import type { ReadDapiWithIndexResponse } from '../../src/update-feeds/dapi-data-registry';
import type { DapiDataRegistry } from '../../typechain-types';
import type { DeepPartial } from '../utils';

export const generateReadDapiWithIndexResponse = (): ReadDapiWithIndexResponse => ({
  dapiName: 'MOCK_FEED',
  updateParameters: {
    deviationThresholdInPercentage: ethers.BigNumber.from(0.5 * 1e8),
    deviationReference: ethers.BigNumber.from(0.5 * 1e8),
    heartbeatInterval: 100,
  },
  dataFeedValue: {
    value: ethers.BigNumber.from(123 * 1e6),
    timestamp: 1_629_811_200,
  },
  dataFeed: '0xebba8507d616ed80766292d200a3598fdba656d9938cecc392765d4a284a69a4',
  signedApiUrls: ['http://localhost:8080'],
});

export const generateMockDapiDataRegistry = () => {
  return {
    interface: {
      encodeFunctionData: jest.fn(),
      decodeFunctionResult: jest.fn(),
    },
    callStatic: {
      tryMulticall: jest.fn(),
    },
    tryMulticall: jest.fn(),
    readDapiWithIndex: jest.fn(),
    dapisCount: jest.fn(),
  } satisfies DeepPartial<DapiDataRegistry>;
};
