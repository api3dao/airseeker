// NOTE: The function is currently returning static data, because the contract is not yet finalized, but we mark it as
// async in advance.
//
// eslint-disable-next-line @typescript-eslint/require-await
export const getStaticActiveDapis = async (_offset: number, _limit: number) => {
  return {
    totalCount: 1,
    dapiNames: ['MOCK_FEED'],
    dataFeedIds: ['0xebba8507d616ed80766292d200a3598fdba656d9938cecc392765d4a284a69a4'],
    updateParameters: [{ deviationThresholdInPercentage: 0.5, deviationReference: 0.5, heartbeatInterval: 100 }],
    // NOTE: We will need to decode this from the contract, because it will store the template IDs as encoded bytes.
    dataFeedTemplateIds: [['0xcc35bd1800c06c12856a87311dd95bfcbb3add875844021d59a929d79f3c99bd']],
    signedApiUrls: [['http://localhost:8080']],
    airnodeAddresses: ['0xbF3137b0a7574563a23a8fC8badC6537F98197CC'],
  };
};

export type ActiveDapisBatch = Awaited<ReturnType<typeof getStaticActiveDapis>>;
