import { HUNDRED_PERCENT } from '../constants';

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
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigInt(10), 560n);

    expect(shouldUpdate).toBe(true);
  });

  it('returns true when api value is lower and deviation threshold is reached', () => {
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigInt(10), 440n);

    expect(shouldUpdate).toBe(true);
  });

  it('returns false when deviation threshold is not reached', () => {
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigInt(10), 480n);

    expect(shouldUpdate).toBe(false);
  });

  it('handles correctly bad JS math', () => {
    expect(() => isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigInt(0.14), 560n)).not.toThrow();
  });

  it('checks all update conditions | heartbeat exceeded', () => {
    const result = isDataFeedUpdatable(
      10n,
      BigInt(Math.floor(Date.now() / 1000) - 60 * 60 * 24),
      10n,
      BigInt(Math.floor(Date.now() / 1000)),
      BigInt(60 * 60 * 23),
      getDeviationThresholdAsBigInt(2)
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
      getDeviationThresholdAsBigInt(2)
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
    const updateInPercentage = calculateDeviationPercentage(10n, 10n);
    expect(updateInPercentage).toStrictEqual(BigInt(0 * HUNDRED_PERCENT));
  });

  it('calculates 100 percent change', () => {
    const updateInPercentage = calculateDeviationPercentage(10n, 20n);
    expect(updateInPercentage).toStrictEqual(BigInt(1 * HUNDRED_PERCENT));
  });

  it('calculates positive to negative change', () => {
    const updateInPercentage = calculateDeviationPercentage(10n, BigInt(-5));
    expect(updateInPercentage).toStrictEqual(BigInt(1.5 * HUNDRED_PERCENT));
  });

  it('calculates negative to positive change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(-5), 5n);
    expect(updateInPercentage).toStrictEqual(BigInt(2 * HUNDRED_PERCENT));
  });

  it('calculates initial zero to positive change', () => {
    const updateInPercentage = calculateDeviationPercentage(0n, 5n);
    expect(updateInPercentage).toStrictEqual(BigInt(5 * HUNDRED_PERCENT));
  });

  it('calculates initial zero to negative change', () => {
    const updateInPercentage = calculateDeviationPercentage(0n, BigInt(-5));
    expect(updateInPercentage).toStrictEqual(BigInt(5 * HUNDRED_PERCENT));
  });

  it('calculates initial positive to zero change', () => {
    const updateInPercentage = calculateDeviationPercentage(5n, 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(1 * HUNDRED_PERCENT));
  });

  it('calculates initial negative to zero change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(-5), 0n);
    expect(updateInPercentage).toStrictEqual(BigInt(1 * HUNDRED_PERCENT));
  });

  it('calculates initial negative to negative change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(-5), BigInt(-1));
    expect(updateInPercentage).toStrictEqual(BigInt(0.8 * HUNDRED_PERCENT));
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
