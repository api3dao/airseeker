import { deriveBeaconId, type Hex } from '@api3/commons';

import { generateTestConfig, initializeState } from '../../test/fixtures/mock-config';

import { getState, updateState, type State } from './state';

const timestampMock = 1_696_930_907_351;
const beaconId = deriveBeaconId(
  '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
  '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183'
) as Hex;
const stateMock: State = {
  config: generateTestConfig(),
  gasPrices: {
    '31337': {
      hardhat: [{ price: 10n, timestamp: timestampMock }],
    },
  },
  pendingTransactionsInfo: {
    '31337': {
      hardhat: {
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266': {
          [beaconId]: {
            consecutivelyUpdatableCount: 1,
            firstUpdatableTimestamp: timestampMock,
            onChainTimestamp: 1_696_930_907n,
          },
        },
      },
    },
  },
  signedDatas: {
    [beaconId]: {
      airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
      encodedValue: '0x000000000000000000000000000000000000000000000065954b143faff77440',
      templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
      signature:
        '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
      timestamp: 'something-silly',
    },
  },
  signedApiUrlsFromConfig: {
    '31337': { hardhat: ['http://127.0.0.1:8090/0xC04575A2773Da9Cd23853A69694e02111b2c4182'] },
  },
  signedApiUrlsFromContract: { '31337': { hardhat: [] } },
  derivedSponsorWallets: {},
  deploymentTimestamp: '1687850583',
  activeDataFeedBeaconIds: { '31337': { hardhat: [] } },
};

beforeAll(() => {
  initializeState();
});

describe('state', () => {
  beforeEach(() => {
    updateState(() => stateMock);
  });

  const signedDataSample = {
    airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
    encodedValue: '0x000000000000000000000000000000000000000000000065954b143faff77440',
    templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
    signature:
      '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
    timestamp: '1687850583',
  } as const;

  it('should update the state correctly', () => {
    const stateBefore = getState();

    updateState((draft) => {
      draft.signedDatas[beaconId] = signedDataSample;
    });

    const stateAfter = getState();
    expect(stateBefore).toStrictEqual(stateMock);
    expect(stateBefore).not.toStrictEqual(stateAfter);
    expect(stateAfter).toStrictEqual({
      ...stateBefore,
      signedDatas: {
        ...stateBefore.signedDatas,
        [beaconId]: signedDataSample,
      },
    });
  });
});
