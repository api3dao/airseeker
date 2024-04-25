export const HUNDRED_PERCENT = 10n ** 8n;

export const AIRSEEKER_PROTOCOL_ID = '5'; // From: https://github.com/api3dao/airnode/blob/ef16c54f33d455a1794e7886242567fc47ee14ef/packages/airnode-protocol/src/index.ts#L46

// Solidity type(int224).min
export const INT224_MIN = 2n ** 223n * -1n;

// Solidity type(int224).max
export const INT224_MAX = 2n ** 223n - 1n;

// Solidity type(uint256).max
export const UINT256_MAX = 2n ** 256n - 1n;

// Intentionally making the message as constant so that it is not accidentally changed. Heartbeat logs subscribers will
// listen for this exact message to parse the heartbeat.
export const HEARTBEAT_LOG_MESSAGE = 'Sending heartbeat log.';
