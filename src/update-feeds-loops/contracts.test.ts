import { encodeBeaconDetails, encodeBeaconSetDetails } from '../../test/utils';

import { decodeDataFeedDetails } from './contracts';

describe('helper functions', () => {
  it('decodes dataFeed bytes into objects', () => {
    const single = encodeBeaconDetails({
      beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
      airnodeAddress: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
      templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
    });

    const multiple = encodeBeaconSetDetails([
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        airnodeAddress: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
        templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        airnodeAddress: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
        templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
      },
    ]);

    const decodedResultSingle = decodeDataFeedDetails(single);
    const decodedResultMultiple = decodeDataFeedDetails(multiple);

    expect(decodedResultSingle).toStrictEqual({
      beacons: [
        {
          airnodeAddress: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
          beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
          templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
        },
      ],
    });
    expect(decodedResultMultiple).toStrictEqual({
      beacons: [
        {
          airnodeAddress: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
          beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
          templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
        },
        {
          airnodeAddress: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
          beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
          templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
        },
      ],
    });
  });
});
