import { logger } from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { RateLimitedProvider } from './providers';
import * as state from './state';
import { shortenAddress } from './utils';
import { Config } from './validation';
import * as wallets from './wallets';
import { hasEnoughBalance } from './wallets';

jest.mock('@api3/airnode-utilities', () => {
  const original = jest.requireActual('@api3/airnode-utilities');
  return {
    ...original,
    getGasPrice() {
      return Promise.resolve([
        [{ message: 'mocked-get-gas-price-message' }],
        {
          type: 0,
          gasPrice: {
            type: 'BigNumber',
            hex: '0x02540be400',
          },
          gasLimit: {
            type: 'BigNumber',
            hex: '0x030d40',
          },
        },
      ]);
    },
  };
});

const config = {
  log: {
    format: 'plain',
    level: 'DEBUG',
  },
  airseekerWalletMnemonic: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
  triggers: {
    dataFeedUpdates: {
      1: {
        '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC': {
          beacons: [],
          beaconSets: [],
          updateInterval: 30,
        },
      },
      3: {
        '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC': {
          beacons: [],
          beaconSets: [],
          updateInterval: 30,
        },
        '0x150700e52ba22fe103d60981c97bc223ac40dd4e': {
          beacons: [],
          beaconSets: [],
          updateInterval: 30,
        },
      },
    },
  },
} as unknown as Config;

beforeEach(() => {
  state.initializeState(config);
  wallets.initializeWallets();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('initializeWallets', () => {
  // This test ensures the initialization of the wallets and their private keys.
  it('initialize wallets', () => {
    const { airseekerWalletPrivateKey, sponsorWalletsPrivateKey } = state.getState();

    expect(typeof airseekerWalletPrivateKey).toBe('string');
    expect(airseekerWalletPrivateKey).toBe('0xd627c727db73ed7067cbc1e15295f7004b83c01d243aa90711d549cda6bd5bca');

    // Because 2 unique sponsorAddresses are placed, following test is expected to be 2.
    expect(Object.keys(sponsorWalletsPrivateKey)).toHaveLength(2);
    expect(typeof sponsorWalletsPrivateKey['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC']).toBe('string');
    expect(typeof sponsorWalletsPrivateKey['0x150700e52ba22fe103d60981c97bc223ac40dd4e']).toBe('string');
    expect(sponsorWalletsPrivateKey['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC']).toBe(
      '0xcda66e77ae4eaab188a15717955f23cb7ee2a15f024eb272a7561cede1be427c'
    );
    expect(sponsorWalletsPrivateKey['0x150700e52ba22fe103d60981c97bc223ac40dd4e']).toBe(
      '0xf719b37066cff1e60726cfc8e656da47d509df3608d5ce38d94b6db93f03a54c'
    );
  });
});

describe('retrieveSponsorWallet', () => {
  beforeEach(() => {
    jest.spyOn(state, 'getState');
  });

  // This test checks if the function retrieves the correct wallet address for a given sponsor address.
  it('should return the wallet address corresponding to the sponsor address', () => {
    const sponsorAddress = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    const expectedWalletAddress = '0x1129eEDf4996cF133e0e9555d4c9d305c9918EC5';

    const wallet = wallets.retrieveSponsorWallet(sponsorAddress);

    expect(wallet.address).toBe(expectedWalletAddress);
    expect(state.getState).toHaveBeenCalledTimes(1);
  });

  // This test checks if the function throws an error when the sponsor address does not have an associated private key.
  it('should throw if private key of sponsor wallet not found for the sponsor', () => {
    const sponsorAddress = '0x0000000000000000000000000000000000000000';
    const expectedErrorMessage = `Pre-generated private key not found for sponsor ${sponsorAddress}`;
    expect(() => wallets.retrieveSponsorWallet(sponsorAddress)).toThrow(expectedErrorMessage);
  });
});

describe('hasEnoughBalance', () => {
  const logOptions = { format: 'plain', level: 'INFO', meta: {} };

  it('should return true if balance is enough (using fulfillmentGasLimit)', async () => {
    const sponsorWallet = {
      provider: {
        getBlock: jest.fn().mockResolvedValue({
          timestamp: Math.floor(Date.now() / 1000),
        }),
        network: {
          chainId: '1',
          name: 'mainnet',
        },
        getGasPrice: jest.fn().mockResolvedValue(ethers.utils.parseUnits('10', 'gwei')),
      },
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1')),
    };
    const dummyAirnode = {
      signMessage: jest.fn().mockResolvedValue('mockedSignature'),
    };
    const updateBeaconWithSignedDataMock = jest.fn().mockResolvedValue(ethers.BigNumber.from(10000));
    const api3ServerV1 = {
      connect() {
        return this;
      },
      estimateGas: {
        updateBeaconWithSignedData: updateBeaconWithSignedDataMock,
      },
    };
    const fulfillmentGasLimit = 500_000;

    const result = await hasEnoughBalance(
      sponsorWallet as any,
      dummyAirnode as any,
      api3ServerV1 as any,
      fulfillmentGasLimit,
      logOptions
    );

    expect(result).toBeTruthy();
    expect(updateBeaconWithSignedDataMock).not.toHaveBeenCalled();
  });

  it('should return true if balance is enough (calling estimateGas)', async () => {
    const sponsorWallet = {
      provider: {
        getBlock: jest.fn().mockResolvedValue({
          timestamp: Math.floor(Date.now() / 1000),
        }),
        network: {
          chainId: '1',
          name: 'mainnet',
        },
        getGasPrice: jest.fn().mockResolvedValue(ethers.utils.parseUnits('10', 'gwei')),
      },
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1')),
    };
    const dummyAirnode = {
      signMessage: jest.fn().mockResolvedValue('mockedSignature'),
    };
    const api3ServerV1 = {
      connect() {
        return this;
      },
      estimateGas: {
        updateBeaconWithSignedData: jest.fn().mockResolvedValue(ethers.BigNumber.from(10_000)),
      },
    };

    const result = await hasEnoughBalance(
      sponsorWallet as any,
      dummyAirnode as any,
      api3ServerV1 as any,
      undefined,
      logOptions
    );

    expect(result).toBeTruthy();
  });

  it('should return false if balance is not enough', async () => {
    const sponsorWallet = {
      provider: {
        getBlock: jest.fn().mockResolvedValue({
          timestamp: Math.floor(Date.now() / 1000),
        }),
        network: {
          chainId: '1',
          name: 'mainnet',
        },
        getGasPrice: jest.fn().mockResolvedValue(ethers.utils.parseUnits('10', 'gwei')),
      },
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseUnits('1', 'wei')),
    };
    const dummyAirnode = {
      signMessage: jest.fn().mockResolvedValue('mockedSignature'),
    };
    const api3ServerV1 = {
      connect() {
        return this;
      },
      estimateGas: {
        updateBeaconWithSignedData: jest.fn().mockResolvedValue(ethers.BigNumber.from(10_000)),
      },
    };

    const result = await hasEnoughBalance(
      sponsorWallet as any,
      dummyAirnode as any,
      api3ServerV1 as any,
      undefined,
      logOptions
    );

    expect(result).toBeFalsy();
  });

  it('should throw an error when failed to get sponsorWallet balance', async () => {
    const sponsorWallet = {
      provider: {
        getBlock: jest.fn().mockResolvedValue({
          timestamp: Math.floor(Date.now() / 1000),
        }),
        network: {
          chainId: '1',
          name: 'mainnet',
        },
        getGasPrice: jest.fn().mockResolvedValue(ethers.utils.parseUnits('10', 'gwei')),
      },
      getBalance: jest.fn().mockRejectedValue(new Error('getBalance: Unexpected')),
    };

    await expect(hasEnoughBalance(sponsorWallet as any, {} as any, {} as any, undefined, logOptions)).rejects.toThrow(
      'getBalance: Unexpected'
    );
  });

  it('should throw an error when failed to get gas price', async () => {
    const sponsorWallet = {
      provider: {
        getBlock: jest.fn().mockResolvedValue({
          timestamp: Math.floor(Date.now() / 1000),
        }),
        network: {
          chainId: '1',
          name: 'mainnet',
        },
        getGasPrice: jest.fn().mockRejectedValue(new Error('getGasPrice: Unexpected')),
      },
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1')),
    };

    await expect(hasEnoughBalance(sponsorWallet as any, {} as any, {} as any, undefined, logOptions)).rejects.toThrow(
      'getGasPrice: Unexpected'
    );
  });

  it('should throw an error when failed to estimate gas', async () => {
    const sponsorWallet = {
      provider: {
        getBlock: jest.fn().mockResolvedValue({
          timestamp: Math.floor(Date.now() / 1000),
        }),
        network: {
          chainId: '1',
          name: 'mainnet',
        },
        getGasPrice: jest.fn().mockResolvedValue(ethers.utils.parseUnits('10', 'gwei')),
      },
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1')),
    };
    const dummyAirnode = {
      signMessage: jest.fn().mockResolvedValue('mockedSignature'),
    };
    const api3ServerV1 = {
      connect() {
        return this;
      },
      estimateGas: {
        updateBeaconWithSignedData: jest.fn().mockRejectedValue(new Error('estimateGas:Unexpected')),
      },
    };

    await expect(
      hasEnoughBalance(sponsorWallet as any, dummyAirnode as any, api3ServerV1 as any, undefined, logOptions)
    ).rejects.toThrow('estimateGas:Unexpected');
  });
});

describe('getSponsorBalanceStatus', () => {
  // This test checks if the function can correctly check the balance status when at least one provider is successful.
  it('should return the SponsorBalanceStatus if one of providers returns successfully', async () => {
    const chainSponsorGroup: wallets.ChainSponsorGroup = {
      chainId: 'chainId1',
      sponsorAddress: 'sponsorAddress1',
      providers: [
        {
          rpcProvider: {} as unknown as RateLimitedProvider,
          chainId: 'chainId1',
          providerName: 'provider1',
        },
        {
          rpcProvider: {} as unknown as RateLimitedProvider,
          chainId: 'chainId1',
          providerName: 'provider2',
        },
      ],
      api3ServerV1Address: '0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76',
    };

    const retrieveSponsorWalletMock = jest.spyOn(wallets, 'retrieveSponsorWallet').mockImplementation(
      () =>
        ({
          address: 'sponsorWalletAddress1',
          connect(_signerOrProvider: ethers.Signer | ethers.providers.Provider | string) {
            return { ...this, provider: _signerOrProvider };
          },
        } as any)
    );
    const hasEnoughBalanceMock = jest
      .spyOn(wallets, 'hasEnoughBalance')
      .mockResolvedValue(false)
      .mockResolvedValue(true);

    const dummyAirnode = ethers.Wallet.createRandom();

    const expectedSponsorBalanceStatus = {
      sponsorAddress: 'sponsorAddress1',
      chainId: 'chainId1',
      hasEnoughBalance: true,
    };

    const sponsorBalanceStatus = await wallets.getSponsorBalanceStatus(chainSponsorGroup, dummyAirnode);

    expect(retrieveSponsorWalletMock).toHaveBeenCalledTimes(1);
    expect(retrieveSponsorWalletMock).toHaveBeenCalledWith('sponsorAddress1');
    expect(hasEnoughBalanceMock).toHaveBeenCalledTimes(2);
    expect(hasEnoughBalanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'sponsorWalletAddress1',
        provider: chainSponsorGroup.providers[0].rpcProvider,
      }),
      dummyAirnode,
      expect.any(ethers.Contract),
      undefined,
      expect.anything()
    );
    expect(wallets.hasEnoughBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'sponsorWalletAddress1',
        provider: chainSponsorGroup.providers[1].rpcProvider,
      }),
      dummyAirnode,
      expect.any(ethers.Contract),
      undefined,
      expect.anything()
    );
    expect(sponsorBalanceStatus).toEqual(expectedSponsorBalanceStatus);
  });

  // This test checks if the function returns null when all providers fail to check the balance.
  it('should return null if balance retrieval fails for all providers', async () => {
    const chainSponsorGroup: wallets.ChainSponsorGroup = {
      chainId: 'chainId1',
      sponsorAddress: 'sponsorAddress1',
      providers: [
        {
          rpcProvider: {} as unknown as RateLimitedProvider,
          chainId: 'chainId1',
          providerName: 'provider1',
        },
        {
          rpcProvider: {} as unknown as RateLimitedProvider,
          chainId: 'chainId1',
          providerName: 'provider2',
        },
      ],
      api3ServerV1Address: '0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76',
    };

    const retrieveSponsorWalletMock = jest.spyOn(wallets, 'retrieveSponsorWallet').mockImplementation(
      () =>
        ({
          address: 'sponsorWalletAddress1',
          connect(_signerOrProvider: ethers.Signer | ethers.providers.Provider | string) {
            return { ...this, provider: _signerOrProvider };
          },
        } as any)
    );

    const hasEnoughBalanceMock = jest.spyOn(wallets, 'hasEnoughBalance').mockRejectedValue(new Error('Unexpected'));

    jest.spyOn(logger, 'warn');

    const dummyAirnode = ethers.Wallet.createRandom();

    const expectedSponsorBalanceStatus = null;

    const sponsorBalanceStatus = await wallets.getSponsorBalanceStatus(chainSponsorGroup, dummyAirnode);

    expect(retrieveSponsorWalletMock).toHaveBeenCalledTimes(1);
    expect(retrieveSponsorWalletMock).toHaveBeenCalledWith('sponsorAddress1');
    expect(hasEnoughBalanceMock).toHaveBeenCalledTimes(2);
    expect(sponsorBalanceStatus).toEqual(expectedSponsorBalanceStatus);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to check if sponsor wallet balance is enough for sponsorWalletAddress1. No provider was resolved',
      expect.objectContaining({
        meta: expect.objectContaining({
          'Chain-ID': chainSponsorGroup.chainId,
          Sponsor: shortenAddress(chainSponsorGroup.sponsorAddress),
        }),
      })
    );
  });

  // This test checks if the function returns null when the retrieval of the sponsor wallet fails.
  it('should return null if sponsor wallet retrieval fails', async () => {
    const chainSponsorGroup: wallets.ChainSponsorGroup = {
      chainId: 'chainId1',
      sponsorAddress: 'sponsorAddress1',
      providers: [
        {
          rpcProvider: {} as unknown as RateLimitedProvider,
          chainId: 'chainId1',
          providerName: 'provider1',
        },
      ],
      api3ServerV1Address: '0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76',
    };

    const innerErrMsg = 'Pre-generated private key not found';
    jest.spyOn(wallets, 'retrieveSponsorWallet').mockImplementation(() => {
      throw new Error(innerErrMsg);
    });
    jest.spyOn(logger, 'warn');

    const dummyAirnode = ethers.Wallet.createRandom();

    const expectedSponsorBalanceStatus = null;

    const sponsorBalanceStatus = await wallets.getSponsorBalanceStatus(chainSponsorGroup, dummyAirnode);

    expect(sponsorBalanceStatus).toEqual(expectedSponsorBalanceStatus);
    expect(logger.warn).toHaveBeenCalledWith(
      `Failed to retrieve wallet address for sponsor ${chainSponsorGroup.sponsorAddress}. Skipping. Error: ${innerErrMsg}`,
      expect.objectContaining({
        meta: expect.objectContaining({
          'Chain-ID': chainSponsorGroup.chainId,
          Sponsor: shortenAddress(chainSponsorGroup.sponsorAddress),
        }),
      })
    );
  });
});

describe('filterSponsorWallets', () => {
  // This test checks if the function correctly updates the state configuration.
  it('should update the state to include only funded sponsors', async () => {
    const stateProviders: state.Providers = {
      1: [
        {
          rpcProvider: {} as unknown as RateLimitedProvider,
          chainId: '1',
          providerName: 'provider1',
        },
      ],
      3: [
        {
          rpcProvider: {} as unknown as RateLimitedProvider,
          chainId: '3',
          providerName: 'provider2',
        },
      ],
    };
    state.updateState((state) => ({
      ...state,
      providers: stateProviders,
      config: {
        ...config,
        chains: {
          '1': {
            contracts: { Api3ServerV1: '0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76' },
            options: {},
          } as any,
          '3': {
            contracts: { Api3ServerV1: '0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76' },
            options: {},
          } as any,
        },
      },
    }));

    const expectedConfig = {
      log: {
        format: 'plain',
        level: 'DEBUG',
      },
      airseekerWalletMnemonic: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
      chains: {
        '1': {
          contracts: { Api3ServerV1: '0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76' },
          options: {},
        } as any,
        '3': {
          contracts: { Api3ServerV1: '0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76' },
          options: {},
        } as any,
      },
      triggers: {
        dataFeedUpdates: {
          1: {
            '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC': {
              beacons: [],
              beaconSets: [],
              updateInterval: 30,
            },
          },
        },
      },
    };

    const expectedSponsorWalletsPrivateKey = {
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC':
        '0xcda66e77ae4eaab188a15717955f23cb7ee2a15f024eb272a7561cede1be427c',
    };

    const getSponsorBalanceStatusMock = jest
      .spyOn(wallets, 'getSponsorBalanceStatus')
      .mockResolvedValueOnce({
        sponsorAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        chainId: '1',
        hasEnoughBalance: true,
      })
      .mockResolvedValueOnce({
        sponsorAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        chainId: '3',
        hasEnoughBalance: false,
      })
      .mockResolvedValueOnce({
        sponsorAddress: '0x150700e52ba22fe103d60981c97bc223ac40dd4e',
        chainId: '3',
        hasEnoughBalance: false,
      });

    jest.spyOn(logger, 'info');
    jest.spyOn(state, 'updateState');
    jest.spyOn(state, 'getState');

    await wallets.filterSponsorWallets();

    expect(getSponsorBalanceStatusMock).toHaveBeenCalledTimes(3);

    const { config: resultedConfig, sponsorWalletsPrivateKey: resultedSponsorWalletsPrivateKey } = state.getState();

    expect(state.updateState).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Fetched balances for 3/3 sponsor wallets. Continuing with 1 funded sponsor(s)',
      expect.anything()
    );
    expect(resultedConfig).toStrictEqual(expectedConfig);
    expect(resultedSponsorWalletsPrivateKey).toStrictEqual(expectedSponsorWalletsPrivateKey);
  });
});
