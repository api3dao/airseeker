import { BigNumber, ethers } from 'ethers';
import {
  calculateMedian,
  calculateUpdateInPercentage,
  checkFulfillmentDataTimestamp,
  checkOnchainDataFreshness,
  checkDeviationThresholdExceeded,
  checkUpdateConditions,
} from './condition-check';
import { getUnixTimestamp } from '../../test/fixtures/utils';
import { HUNDRED_PERCENT } from '../constants';

describe('checkUpdateCondition', () => {
  const onChainValue = ethers.BigNumber.from(500);

  it('returns true when api value is higher and deviation threshold is reached', () => {
    const shouldUpdate = checkDeviationThresholdExceeded(onChainValue, 10, ethers.BigNumber.from(560));

    expect(shouldUpdate).toBe(true);
  });

  it('returns true when api value is lower and deviation threshold is reached', () => {
    const shouldUpdate = checkDeviationThresholdExceeded(onChainValue, 10, ethers.BigNumber.from(440));

    expect(shouldUpdate).toBe(true);
  });

  it('returns false when deviation threshold is not reached', () => {
    const shouldUpdate = checkDeviationThresholdExceeded(onChainValue, 10, ethers.BigNumber.from(480));

    expect(shouldUpdate).toBe(false);
  });

  it('handles correctly bad JS math', () => {
    expect(() => checkDeviationThresholdExceeded(onChainValue, 0.14, ethers.BigNumber.from(560))).not.toThrow();
  });

  it('checks all update conditions | heartbeat exceeded', () => {
    const result = checkUpdateConditions(
      BigNumber.from(10),
      Date.now() / 1000 - 60 * 60 * 24,
      BigNumber.from(10),
      Date.now() / 1000,
      60 * 60 * 23,
      2
    );

    expect(result).toBe(true);
  });

  it('checks all update conditions | no update', () => {
    const result = checkUpdateConditions(
      BigNumber.from(10),
      Date.now() / 1000,
      BigNumber.from(10),
      Date.now() + 60 * 60 * 23,
      86_400,
      2
    );

    expect(result).toBe(false);
  });
});

describe('checkFulfillmentDataTimestamp', () => {
  const onChainData = {
    value: ethers.BigNumber.from(10),
    timestamp: getUnixTimestamp('2019-4-28'),
  };

  it('returns true if fulfillment data is newer than on-chain record', () => {
    const isFresh = checkFulfillmentDataTimestamp(onChainData.timestamp, getUnixTimestamp('2019-4-29'));
    expect(isFresh).toBe(true);
  });

  it('returns false if fulfillment data is older than on-chain record', () => {
    const isFresh = checkFulfillmentDataTimestamp(onChainData.timestamp, getUnixTimestamp('2019-4-27'));
    expect(isFresh).toBe(false);
  });

  it('returns false if fulfillment data has same timestamp with on-chain record', () => {
    const isFresh = checkFulfillmentDataTimestamp(onChainData.timestamp, onChainData.timestamp);
    expect(isFresh).toBe(false);
  });
});

describe('checkOnchainDataFreshness', () => {
  it('returns true if on chain data timestamp is newer than heartbeat interval', () => {
    const isFresh = checkOnchainDataFreshness(Date.now() / 1000 - 100, 200);

    expect(isFresh).toBe(true);
  });

  it('returns false if on chain data timestamp is older than heartbeat interval', () => {
    const isFresh = checkOnchainDataFreshness(Date.now() / 1000 - 300, 200);

    expect(isFresh).toBe(false);
  });
});

describe('calculateUpdateInPercentage', () => {
  it('calculates zero change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(10), ethers.BigNumber.from(10));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(0 * HUNDRED_PERCENT));
  });

  it('calculates 100 percent change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(10), ethers.BigNumber.from(20));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(1 * HUNDRED_PERCENT));
  });

  it('calculates positive to negative change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(10), ethers.BigNumber.from(-5));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(1.5 * HUNDRED_PERCENT));
  });

  it('calculates negative to positive change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(-5), ethers.BigNumber.from(5));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(2 * HUNDRED_PERCENT));
  });

  it('calculates initial zero to positive change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(0), ethers.BigNumber.from(5));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(5 * HUNDRED_PERCENT));
  });

  it('calculates initial zero to negative change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(0), ethers.BigNumber.from(-5));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(5 * HUNDRED_PERCENT));
  });

  it('calculates initial positive to zero change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(5), ethers.BigNumber.from(0));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(1 * HUNDRED_PERCENT));
  });

  it('calculates initial negative to zero change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(-5), ethers.BigNumber.from(0));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(1 * HUNDRED_PERCENT));
  });

  it('calculates initial negative to negative change', () => {
    const updateInPercentage = calculateUpdateInPercentage(ethers.BigNumber.from(-5), ethers.BigNumber.from(-1));
    expect(updateInPercentage).toEqual(ethers.BigNumber.from(0.8 * HUNDRED_PERCENT));
  });
});

describe('calculateMedian', () => {
  describe('for array with odd number of elements', () => {
    it('calculates median for sorted array', () => {
      const arr = [BigNumber.from(10), BigNumber.from(11), BigNumber.from(24), BigNumber.from(30), BigNumber.from(47)];
      expect(calculateMedian(arr)).toEqual(BigNumber.from(24));
    });

    it('calculates median for unsorted array', () => {
      const arr = [BigNumber.from(24), BigNumber.from(11), BigNumber.from(10), BigNumber.from(47), BigNumber.from(30)];
      expect(calculateMedian(arr)).toEqual(BigNumber.from(24));
    });
  });

  describe('for array with even number of elements', () => {
    it('calculates median for sorted array', () => {
      const arr = [BigNumber.from(10), BigNumber.from(11), BigNumber.from(24), BigNumber.from(30)];
      expect(calculateMedian(arr)).toEqual(BigNumber.from(17));
    });

    it('calculates median for unsorted array', () => {
      const arr = [BigNumber.from(24), BigNumber.from(11), BigNumber.from(10), BigNumber.from(30)];
      expect(calculateMedian(arr)).toEqual(BigNumber.from(17));
    });
  });
});
