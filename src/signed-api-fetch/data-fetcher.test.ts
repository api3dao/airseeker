import { setAxios } from './data-fetcher';
import { localDataStore } from '../signed-data-store';

describe('data fetcher', () => {
  const mockAxios = jest.fn();

  beforeAll(() => {
    setAxios(mockAxios);
  });

  beforeEach(() => {
    mockAxios.mockReset();
    localDataStore.clear();
  });
});
