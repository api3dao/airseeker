import { generateTestConfig, initializeState } from '../../test/fixtures/mock-config';
import { getState } from '../state';

import {
  clearFirstMarkedUpdatableTimestamp,
  initializeFirstMarkedUpdatableTimestamp,
  setFirstMarkedUpdatableTimestamp,
} from './updatability-timestamp';

const chainId = '31337';
const providerName = 'localhost';
const dateNowMock = 1_696_930_907_351;
const timestampMock = Math.floor(dateNowMock / 1000);
const sponsorWalletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

beforeEach(() => {
  initializeState(generateTestConfig());
  initializeFirstMarkedUpdatableTimestamp(chainId, providerName);
});

describe(setFirstMarkedUpdatableTimestamp.name, () => {
  it('sets the last update timestamp for the sponsor', () => {
    setFirstMarkedUpdatableTimestamp(chainId, providerName, sponsorWalletAddress, timestampMock);

    expect(getState().firstMarkedUpdatableTimestamps[chainId]![providerName]![sponsorWalletAddress]).toStrictEqual(
      timestampMock
    );
  });
});

describe(clearFirstMarkedUpdatableTimestamp.name, () => {
  it('clears the last update timestamp for the sponsor', () => {
    setFirstMarkedUpdatableTimestamp(chainId, providerName, sponsorWalletAddress, timestampMock);

    clearFirstMarkedUpdatableTimestamp(chainId, providerName, sponsorWalletAddress);

    expect(getState().firstMarkedUpdatableTimestamps[chainId]![providerName]![sponsorWalletAddress]).toBeNull();
  });
});
