import { BigNumber } from 'ethers';

import { getConfig } from '../../test/fixtures/mock-config';
import { deriveBeaconId } from '../utils';

import { updateState, getState, setState } from './state';

const timestampMock = 1_696_930_907_351;
const stateMock = {
  config: getConfig(),

  gasPriceStore: {
    '31337': {
      localhost: {
        gasPrices: [{ price: BigNumber.from(10), timestampMs: timestampMock }],
        sponsorLastUpdateTimestampMs: { '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266': timestampMock },
      },
    },
  },
  signedApiStore: {
    [deriveBeaconId(
      '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
      '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183'
    )!]: {
      airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
      encodedValue: '0x000000000000000000000000000000000000000000000065954b143faff77440',
      templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
      signature:
        '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
      timestamp: 'something-silly',
    },
  },
  signedApiUrlStore: {
    '31337': {
      hardhat: [
        'http://127.0.0.1:8090/0xbF3137b0a7574563a23a8fC8badC6537F98197CC',
        'https://pool.nodary.io/0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
      ],
    },
  },
  derivedSponsorWallets: {},
  dapis: {},
};

describe('state', () => {
  beforeEach(() => {
    setState(stateMock);
  });

  const beaconId = deriveBeaconId(
    '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
    '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183'
  )!;

  const signedDataSample = {
    airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
    encodedValue: '0x000000000000000000000000000000000000000000000065954b143faff77440',
    templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
    signature:
      '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
    timestamp: '1687850583',
  };

  it('should update the state correctly', () => {
    const stateBefore = getState();
    updateState((draft) => {
      draft.signedApiStore[beaconId] = signedDataSample;
    });

    const stateAfter = getState();

    expect(stateBefore).toStrictEqual(stateMock);
    expect(stateBefore).not.toStrictEqual(stateAfter);
    expect(stateAfter).toStrictEqual({
      ...stateBefore,
      signedApiStore: {
        ...stateBefore.signedApiStore,
        [beaconId]: signedDataSample,
      },
    });
  });
});
