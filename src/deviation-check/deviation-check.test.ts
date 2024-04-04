import { HUNDRED_PERCENT, UINT256_MAX } from '../constants';

import {
  calculateMedian,
  calculateDeviationPercentage,
  isOnChainDataFresh,
  isDeviationThresholdExceeded,
  isDataFeedUpdatable,
} from './deviation-check';

const getDeviationThresholdAsBigInt = (input: number) => BigInt(Math.trunc(input * HUNDRED_PERCENT)) / 100n;

describe(isDeviationThresholdExceeded.name, () => {
  const onChainValue = 500n;

  it('returns true when api value is higher and deviation threshold is reached', () => {
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigInt(10), 560n, 0n);

    expect(shouldUpdate).toBe(true);
  });

  it('returns true when api value is lower and deviation threshold is reached', () => {
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigInt(10), 440n, 0n);

    expect(shouldUpdate).toBe(true);
  });

  it('returns false when deviation threshold is not reached', () => {
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigInt(10), 480n, 0n);

    expect(shouldUpdate).toBe(false);
  });

  it('handles correctly bad JS math', () => {
    expect(() =>
      isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigInt(0.14), 560n, 0n)
    ).not.toThrow();
  });
});

describe(isDataFeedUpdatable.name, () => {
  it('checks all update conditions | heartbeat exceeded', () => {
    const result = isDataFeedUpdatable(
      10n,
      BigInt(Math.floor(Date.now() / 1000) - 60 * 60 * 24),
      10n,
      BigInt(Math.floor(Date.now() / 1000)),
      BigInt(60 * 60 * 23),
      getDeviationThresholdAsBigInt(2),
      0n
    );

    expect(result).toBe(true);
  });

  it('checks all update conditions | no update', () => {
    const result = isDataFeedUpdatable(
      10n,
      BigInt(Math.floor(Date.now() / 1000)),
      10n,
      BigInt(Date.now() + 60 * 60 * 23),
      BigInt(60 * 60 * 24),
      getDeviationThresholdAsBigInt(2),
      0n
    );

    expect(result).toBe(false);
  });

  it('updates uninitialized data feed', () => {
    const result = isDataFeedUpdatable(0n, 0n, 1n, 1n, 100_000_000_000_000n, getDeviationThresholdAsBigInt(2), -100n);

    expect(result).toBe(true);
  });

  it('does not update if deviation percentage is 0', () => {
    const result = isDataFeedUpdatable(
      10n,
      BigInt(Math.floor(Date.now() / 1000)),
      10n,
      BigInt(Date.now() + 60 * 60 * 23),
      BigInt(60 * 60 * 24),
      getDeviationThresholdAsBigInt(0),
      0n
    );

    expect(result).toBe(false);
  });
});

describe(isOnChainDataFresh.name, () => {
  it('returns true if on chain data timestamp is newer than heartbeat interval', () => {
    const isFresh = isOnChainDataFresh(BigInt(Math.floor(Date.now() / 1000) - 100), 200n);

    expect(isFresh).toBe(true);
  });

  it('returns false if on chain data timestamp is older than heartbeat interval', () => {
    const isFresh = isOnChainDataFresh(BigInt(Math.floor(Date.now() / 1000) - 300), 200n);

    expect(isFresh).toBe(false);
  });
});

describe(calculateDeviationPercentage.name, () => {
  it('calculates zero change', () => {
    const updateInPercentage = calculateDeviationPercentage(10n, 10n, 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(0));
  });

  it('calculates 100 percent change', () => {
    const updateInPercentage = calculateDeviationPercentage(10n, 20n, 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(1 * HUNDRED_PERCENT));
  });

  it('calculates positive to negative change', () => {
    const updateInPercentage = calculateDeviationPercentage(10n, BigInt(-5), 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(1.5 * HUNDRED_PERCENT));
  });

  it('calculates negative to positive change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(-5), 5n, 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(2 * HUNDRED_PERCENT));
  });

  it('calculates initial zero to positive change', () => {
    const updateInPercentage = calculateDeviationPercentage(0n, 5n, 0n);
    expect(updateInPercentage).toStrictEqual(UINT256_MAX);
  });

  it('calculates initial zero to negative change', () => {
    const updateInPercentage = calculateDeviationPercentage(0n, BigInt(-5), 0n);
    expect(updateInPercentage).toStrictEqual(UINT256_MAX);
  });

  it('calculates initial positive to zero change', () => {
    const updateInPercentage = calculateDeviationPercentage(5n, 0n, 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(1 * HUNDRED_PERCENT));
  });

  it('calculates initial negative to zero change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(-5), 0n, 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(1 * HUNDRED_PERCENT));
  });

  it('calculates initial negative to negative change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(-5), BigInt(-1), 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(0.8 * HUNDRED_PERCENT));
  });

  it('respects the deviation reference', () => {
    // These tests are inspired by https://github.com/api3dao/airnode-protocol-v1/blob/65a77cdc23dc5434e143357a506327b9f0ccb7ef/test/api3-server-v1/extensions/DataFeedServerFull.sol.js
    let updateInPercentage: bigint;

    updateInPercentage = calculateDeviationPercentage(BigInt(100), BigInt(91), -100n);
    expect(updateInPercentage).toStrictEqual(BigInt(0.045 * HUNDRED_PERCENT));

    updateInPercentage = calculateDeviationPercentage(BigInt(100), BigInt(109), -100n);
    expect(updateInPercentage).toStrictEqual(BigInt(0.045 * HUNDRED_PERCENT));

    updateInPercentage = calculateDeviationPercentage(BigInt(100), BigInt(80), -100n);
    expect(updateInPercentage).toStrictEqual(BigInt(0.1 * HUNDRED_PERCENT));

    updateInPercentage = calculateDeviationPercentage(BigInt(100), BigInt(120), -100n);
    expect(updateInPercentage).toStrictEqual(BigInt(0.1 * HUNDRED_PERCENT));
  });

  it('returns 0 if there is no value change', () => {
    const updateInPercentage = calculateDeviationPercentage(10n, 10n, 10n);
    expect(updateInPercentage).toBe(0n);
  });
});

describe(calculateMedian.name, () => {
  describe('for array with odd number of elements', () => {
    it('calculates median for sorted array', () => {
      const arr = [10n, 11n, 24n, 30n, 47n];
      expect(calculateMedian(arr)).toBe(24n);
    });

    it('calculates median for unsorted array', () => {
      const arr = [24n, 11n, 10n, 47n, 30n];
      expect(calculateMedian(arr)).toBe(24n);
    });
  });

  describe('for array with even number of elements', () => {
    it('calculates median for sorted array', () => {
      const arr = [10n, 11n, 24n, 30n];
      expect(calculateMedian(arr)).toBe(17n);
    });

    it('calculates median for unsorted array', () => {
      const arr = [24n, 11n, 10n, 30n];
      expect(calculateMedian(arr)).toBe(17n);
    });
  });
});
