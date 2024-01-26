import { ethers } from 'ethers';

import { HUNDRED_PERCENT } from '../constants';

import {
  calculateMedian,
  calculateDeviationPercentage,
  isOnChainDataFresh,
  isDeviationThresholdExceeded,
  isDataFeedUpdatable,
} from './deviation-check';

const getDeviationThresholdAsBigNumber = (input: number) =>
  BigInt(Math.trunc(input * HUNDRED_PERCENT)).div(BigInt(100));

describe(isDeviationThresholdExceeded.name, () => {
  const onChainValue = BigInt(500);

  it('returns true when api value is higher and deviation threshold is reached', () => {
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigNumber(10), BigInt(560));

    expect(shouldUpdate).toBe(true);
  });

  it('returns true when api value is lower and deviation threshold is reached', () => {
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigNumber(10), BigInt(440));

    expect(shouldUpdate).toBe(true);
  });

  it('returns false when deviation threshold is not reached', () => {
    const shouldUpdate = isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigNumber(10), BigInt(480));

    expect(shouldUpdate).toBe(false);
  });

  it('handles correctly bad JS math', () => {
    expect(() =>
      isDeviationThresholdExceeded(onChainValue, getDeviationThresholdAsBigNumber(0.14), BigInt(560))
    ).not.toThrow();
  });

  it('checks all update conditions | heartbeat exceeded', () => {
    const result = isDataFeedUpdatable(
      BigInt(10),
      Date.now() / 1000 - 60 * 60 * 24,
      BigInt(10),
      Date.now() / 1000,
      BigInt(60 * 60 * 23),
      getDeviationThresholdAsBigNumber(2)
    );

    expect(result).toBe(true);
  });

  it('checks all update conditions | no update', () => {
    const result = isDataFeedUpdatable(
      BigInt(10),
      Date.now() / 1000,
      BigInt(10),
      Date.now() + 60 * 60 * 23,
      BigInt(60 * 60 * 24),
      getDeviationThresholdAsBigNumber(2)
    );

    expect(result).toBe(false);
  });
});

describe(isOnChainDataFresh.name, () => {
  it('returns true if on chain data timestamp is newer than heartbeat interval', () => {
    const isFresh = isOnChainDataFresh(Date.now() / 1000 - 100, BigInt(200));

    expect(isFresh).toBe(true);
  });

  it('returns false if on chain data timestamp is older than heartbeat interval', () => {
    const isFresh = isOnChainDataFresh(Date.now() / 1000 - 300, BigInt(200));

    expect(isFresh).toBe(false);
  });
});

describe(calculateDeviationPercentage.name, () => {
  it('calculates zero change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(10), BigInt(10));
    expect(updateInPercentage).toStrictEqual(BigInt(0 * HUNDRED_PERCENT));
  });

  it('calculates 100 percent change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(10), BigInt(20));
    expect(updateInPercentage).toStrictEqual(BigInt(1 * HUNDRED_PERCENT));
  });

  it('calculates positive to negative change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(10), BigInt(-5));
    expect(updateInPercentage).toStrictEqual(BigInt(1.5 * HUNDRED_PERCENT));
  });

  it('calculates negative to positive change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(-5), BigInt(5));
    expect(updateInPercentage).toStrictEqual(BigInt(2 * HUNDRED_PERCENT));
  });

  it('calculates initial zero to positive change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(0), BigInt(5));
    expect(updateInPercentage).toStrictEqual(BigInt(5 * HUNDRED_PERCENT));
  });

  it('calculates initial zero to negative change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(0), BigInt(-5));
    expect(updateInPercentage).toStrictEqual(BigInt(5 * HUNDRED_PERCENT));
  });

  it('calculates initial positive to zero change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(5), BigInt(0));
    expect(updateInPercentage).toStrictEqual(BigInt(1 * HUNDRED_PERCENT));
  });

  it('calculates initial negative to zero change', () => {
    const updateInPercentage = calculateDeviationPercentage(BigInt(-5), BigInt(0));
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
      const arr = [BigInt(10), BigInt(11), BigInt(24), BigInt(30), BigInt(47)];
      expect(calculateMedian(arr)).toStrictEqual(BigInt(24));
    });

    it('calculates median for unsorted array', () => {
      const arr = [BigInt(24), BigInt(11), BigInt(10), BigInt(47), BigInt(30)];
      expect(calculateMedian(arr)).toStrictEqual(BigInt(24));
    });
  });

  describe('for array with even number of elements', () => {
    it('calculates median for sorted array', () => {
      const arr = [BigInt(10), BigInt(11), BigInt(24), BigInt(30)];
      expect(calculateMedian(arr)).toStrictEqual(BigInt(17));
    });

    it('calculates median for unsorted array', () => {
      const arr = [BigInt(24), BigInt(11), BigInt(10), BigInt(30)];
      expect(calculateMedian(arr)).toStrictEqual(BigInt(17));
    });
  });
});
