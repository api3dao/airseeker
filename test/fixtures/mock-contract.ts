import type { Api3ServerV1 } from '@api3/airnode-protocol-v1';
import { ethers } from 'ethers';

import type { DapiDataRegistry } from '../../src/typechain-types';
import { type DeepPartial, encodeBeaconFeed } from '../utils';

export const generateReadDapiWithIndexResponse = () => ({
  dapiName: ethers.utils.formatBytes32String('MOCK_FEED'),
  updateParameters: {
    deviationThresholdInPercentage: ethers.BigNumber.from(0.5 * 1e8),
    deviationReference: ethers.BigNumber.from(0.5 * 1e8),
    heartbeatInterval: 100,
  },
  dataFeedValue: {
    value: ethers.BigNumber.from(123 * 1e6),
    timestamp: 1_629_811_200,
  },
  dataFeed: encodeBeaconFeed({
    beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
    airnodeAddress: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
    templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
  }),
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

export const generateMockApi3ServerV1 = () => {
  return {
    estimateGas: {
      multicall: jest.fn(),
      updateBeaconWithSignedData: jest.fn(),
      updateBeaconSetWithBeacons: jest.fn(),
    },
    interface: {
      encodeFunctionData: jest.fn(),
    },
  } satisfies DeepPartial<Api3ServerV1>;
};
