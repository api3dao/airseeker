import axios from 'axios';
import { produce } from 'immer';

import { init } from '../../test/fixtures/mock-config';
import * as localDataStore from '../signed-data-store';
import { getState, setState } from '../state';

import { runDataFetcher, stopDataFetcher } from './data-fetcher';

const mockedAxios = axios as jest.MockedFunction<typeof axios>;
jest.mock('axios');

describe('data fetcher', () => {
  beforeEach(() => {
    init();
    localDataStore.clear();
    setState(
      produce(getState(), (draft) => {
        draft.signedApiUrlStore = {
          '31337': {
            '0xbF3137b0a7574563a23a8fC8badC6537F98197CC': 'http://127.0.0.1:8090/',
            '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4': 'https://pool.nodary.io',
          },
        };
      })
    );
  });

  it('retrieves signed data from urls', async () => {
    const setStoreDataPointSpy = jest.spyOn(localDataStore, 'setStoreDataPoint');

    mockedAxios.mockResolvedValue(
      Promise.resolve({
        status: 200,
        data: {
          count: 3,
          data: {
            '0x91be0acf2d58a15c7cf687edabe4e255fdb27fbb77eba2a52f3bb3b46c99ec04': {
              signature:
                '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
              timestamp: '1687850583',
              templateId: '0x154c34adf151cf4d91b7abe7eb6dcd193104ef2a29738ddc88020a58d6cf6183',
              encodedValue: '0x000000000000000000000000000000000000000000000065954b143faff77440',
              airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
            },
            '0xddc6ca9cc6f5768d9bfa8cc59f79bde8cf97a6521d0b95835255951ce06f19e6': {
              signature:
                '0x1f8993bae330ff73f050aeb8221207f80d22c43174e56079663d520fd2ccaec52b87f56d2fb2184f99d0c37dabd78cf7ff4f2cd27f7fd337d06ebfe590e09a7d1c',
              timestamp: '1687850583',
              templateId: '0x55d08a477d28519c8bc889b0be4f4d08625cfec5369f047258a1a4d7e1e405f3',
              encodedValue: '0x00000000000000000000000000000000000000000000066e419d6bdc61e19680',
              airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
            },
            '0x5dd8d9e1429f69ba4bd76df5709155110429857d19670cc157632f66a48ee1f7': {
              signature:
                '0x48c9c53645b5e69c986ab02fcae88ddd5247ce000bf1fddb2cd83ac6af8553e554164d3f6d5906fa8d24ce9224484a2664a70bb75893e9cf18bcffadee4345bc1c',
              timestamp: '1687850583',
              templateId: '0x96504241fb9ae9a5941f97c9561dcfcd7cee77ee9486a58c8e78551c1268ddec',
              encodedValue: '0x0000000000000000000000000000000000000000000000000e461510ad9d8678',
              airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
            },
          },
        },
      })
    );

    const dataFetcherPromise = runDataFetcher();

    await expect(dataFetcherPromise).resolves.toBeDefined();

    stopDataFetcher();

    expect(mockedAxios).toHaveBeenCalledTimes(2);
    expect(setStoreDataPointSpy).toHaveBeenCalledTimes(6);
  });
});
