# Configuration

Airseeker can be configured via a combination of [environment variables](#environment-variables) and
[configuration files](#configuration-files).

## Environment variables

All of the environment variables are optional and or set with default values for convenience.

For example:

```sh
# Defines a logger suitable for production.
LOGGER_ENABLED=true
LOG_COLORIZE=false
LOG_FORMAT=json
LOG_LEVEL=info
```

or

```sh
# Defines a logger suitable for local development or testing.
LOGGER_ENABLED=true
LOG_COLORIZE=false
LOG_FORMAT=json
LOG_LEVEL=info
```

### `LOGGER_ENABLED` _(optional)_

Enables or disables logging. Options:

- `true` - Enables logging.
- `false` - Disables logging.

Default: `true`.

### `LOG_FORMAT` _(optional)_

The format of the log output. Options:

- `json` - Specifies JSON log format. This is suitable when running in production and streaming logs to other services.
- `pretty` - Logs are formatted in a human-friendly "pretty" way. Ideal, when running the service locally and in
  development.

Default: `json`.

### `LOG_COLORIZE` _(optional)_

Enables or disables colors in the log output. Options:

- `true` - Enables colors in the log output. The output has special color setting characters that are parseable by CLI.
  Recommended when running locally and in development.
- `false` - Disables colors in the log output. Recommended for production.

Default: `false`.

### `LOG_LEVEL` _(optional)_

Defines the minimum level of logs. Logs with smaller level (severity) will be silenced. Options:

- `debug` - Enables all logs.
- `info` - Enables logs with level `info`, `warn` and `error`.
- `warn` - Enables logs with level `warn` and `error`.
- `error` - Enables logs with level `error`.

Default: `info`.

### `LOG_HEARTBEAT` _(optional)_

Enables or disables the heartbeat log. The heartbeat log is a cryptographically secure log that is emitted every 60
seconds to indicate that the service is running. The log includes useful information such as the configuration hash.
Options:

- `true` - Enables the heartbeat log.
- `false` - Disables the heartbeat log.

## Configuration files

Airseeker needs two configuration files, `airseeker.json` and `secrets.env`. All expressions of a form `${SECRET_NAME}`
are referring to values from secrets and are interpolated inside the `airseeker.json` at runtime. You are advised to put
sensitive information inside secrets.

### `chains`

A record of chain configurations. The record key is the chain ID. For example:

```jsonc
{
  // Defines a chain configuration with ID 1 (ETH mainnet).
  "1": {
    "providers": {
      "mainnet": {
        "url": "http://mainnet.com",
      },
    },
  },
}
```

#### `alias` _(optional)_

The optional alias to identify the chain in logs. If not provided, the chain alias from `@api3/contracts` is used. If
there is no record in `@api3/contracts` for the given chain ID, falls back to using `unknown`.

#### `contracts`

A record of contract addresses used by Airseeker.

##### `Api3ServerV1` _(optional)_

The address of the Api3ServerV1 contract. If not specified, the address is loaded from `@api3/contracts`.

##### `AirseekerRegistry`

The address of the AirseekerRegistry contract.

##### `Api3ServerV1BuilderTipExtension` _(optional)_

The address of the Api3ServerV1BuilderTipExtension contract. The contract is not part of `@api3/contracts` and is
expected to be deployed manually by whoever wants to utilize it. The reference implementation is provided in this
repository under `contracts/` and can be compiled with `pnpm hardhat compile`. Specifying the address opts the chain in
for tipping the block builder and must be done together with specifying `builderTipSettings`.

#### `providers`

A record of providers. The record key is the provider name. Provider name is only used for internal purposes and to
uniquely identify the provider for the given chain.

##### `providers[<NAME>]`

A provider configuration.

###### `url`

The URL of the provider.

#### `gasSettings`

The settings used to calculate gas prices used to submit transactions. The gas oracle is stateful and maintains
historical gas prices for a specific sampling window. It computes the gas price to be used based on the latest gas
price. In case the transaction is a retry of a pending transaction, the latest gas price is linearly scaled by a factor
up to a specified maximum. In case the transaction is not a retry, the latest gas price is multiplied only by the
recommended gas price multiplier. The sanitization cap is computed as a percentile chosen from the historical gas prices
multiplied by a specified gas price multiplier. The sanitization cap provides the upper bound for the computed gas
price.

Example of a scaling computation:

```js
// Parameters:
// - recommendedGasPriceMultiplier = 1.2
// - maxScalingMultiplier = 2
// - scalingWindow = 300
//
// Say there is a pending transaction for 150 seconds.
//
// The scaling factor is calculated as:
1.2 + (2 - 1.2) * (2.5 / 5) = 1.6
```

##### `recommendedGasPriceMultiplier`

The base multiplier used to compute the gas price. Used to multiply the latest gas price.

##### `sanitizationSamplingWindow`

The number of seconds for which to keep historical gas prices.

##### `sanitizationPercentile`

The percentile of gas historical prices to use for sanitization of the latest gas price.

##### `scalingWindow`

The period in seconds used to scale the retry of a pending update transaction. The transaction is scaled linearly up to
the `maxScalingMultiplier`.

##### `maxScalingMultiplier`

The maximum scaling multiplier. The gas price will not be scaled by a larger factor independently of how long is the
update pending.

##### `sanitizationMultiplier`

The multiplier used during sanitization. The percentile gas price computed during sanitization is multiplied by this
factor and the result is used to cap the gas price.

#### `builderTipSettings` _(optional)_

The settings used to tip the block builder through the Api3ServerV1BuilderTipExtension contract. Some block builders do
not order transactions strictly by their effective gas price and instead optimize for the total value that a block
generates for them, which means an update transaction may remain pending even with a competitive (and possibly
sanitized) gas price. When a submitted update transaction remains pending and its data feed has been updatable for more
than `consecutivelyUpdatableCountThreshold` consecutive attempts (counting the attempt that submitted the transaction),
Airseeker resubmits it through the Api3ServerV1BuilderTipExtension contract, which transfers the value sent along with
the transaction to `block.coinbase` as a tip to the block builder. Since the tip is computed from the gas price, which
is scaled while the transaction is pending and capped by sanitization, the tip scales in tandem and is bounded per
transaction.

Tipping is best-effort. Before tipping, Airseeker verifies that the extension wraps the configured Api3ServerV1
contract, and when any part of the tipped flow fails (the verification, the gas estimation — `fallbackGasLimit` is
deliberately not used for tipped updates — or the submission, e.g. because the sponsor wallet cannot cover the tip on
top of the transaction fee), the update is submitted without a tip instead. Note that the tip is transferred whenever
the tipped transaction itself does not revert, even if all of the batched calls revert (e.g. because another party
landed the same update first).

Only specify these settings (together with the `Api3ServerV1BuilderTipExtension` contract address) on chains whose block
builders account for `block.coinbase` transfers in transaction ordering (e.g., Ethereum). Note that the tip is paid on
top of the transaction fee, so the sponsor wallets need to be funded accordingly.

Example of a tip computation:

```js
// Parameters:
// - consecutivelyUpdatableCountThreshold = 3
// - multiplier = 1.5
//
// Say a data feed has been updatable for 4 consecutive attempts (exceeding the threshold) with an update transaction
// submitted on the first attempt, and the tipped replacement uses a gas limit of 500000 and a gas price of 10 gwei
// (which is the already scaled and sanitized gas price that the transaction is submitted with, not the one recommended
// by the provider).
//
// The tip amount is calculated as:
1.5 * 10e9 * 500000 = 0.0075e18; // 0.0075 ETH
```

##### `consecutivelyUpdatableCountThreshold`

The number of consecutive attempts for which the data feed is allowed to remain updatable before the update transactions
start tipping the block builder. The count includes the attempt that submitted the original update transaction, so with
a threshold of N, the first tipped submission happens on attempt N + 1. Attempts that did not manage to submit a
transaction (e.g. because of RPC failures) still increase the count, but tipping only activates after a transaction has
actually been submitted during the pending period.

##### `multiplier`

The multiplier used to compute the tip amount from the transaction fee (i.e., the gas price multiplied by the gas limit)
of the update transaction. A maximum of 2 decimals are supported.

Note that this is the fee that the transaction actually pays, so the gas price it is based on has already been
multiplied by `recommendedGasPriceMultiplier` (or the scaling multiplier of the pending transaction) and capped by
sanitization. The multipliers therefore compound: the tip is at most
`multiplier * min(maxScalingMultiplier * gasPrice, sanitizationGasPriceCap) * gasLimit`, and with a
`recommendedGasPriceMultiplier` of 1.5 and a `multiplier` of 1.5 the tip of an unscaled transaction is 2.25 times the
gas price recommended by the provider multiplied by the gas limit. This also means that the tip stops growing once the
gas price is capped by sanitization; use `maxTip` to bound it further, and pick `multiplier` against the gas settings of
the chain rather than against the raw gas price.

##### `maxTip` _(optional)_

The maximum tip amount in wei, as a string. While the gas price component of the tip is capped by sanitization, the gas
limit is based on the estimate of the RPC provider, so the cap guards against a misbehaving provider inflating the tip.
If not specified, the tip amount is not capped.

#### `deviationThresholdCoefficient` _(optional)_

The global coefficient applied to all deviation checks. Used to differentiate alternate deployments. For example:

```jsonc
"deviationThresholdCoefficient": 1,
```

Defaults to `1`.

#### `heartbeatIntervalModifier` _(optional)_

The global modifier applied to all heartbeat checks. The value is specified in seconds and can be positive or negative.
The resulting interval is calculated by adding this modifier as an offset and clamped to a minimum of 0, ensuring it
never goes negative. Used to differentiate alternate deployments. For example:

```jsonc
"heartbeatIntervalModifier": -120,
```

Defaults to `0`.

#### `individualBeaconUpdateSettings`

The global settings applied to individual beacon updates. When configured, these settings will be used on beacon sets
that don't require an update but some of their beacon constituents do. The object has the following properties:

- `deviationThresholdCoefficient`: The deviation coefficient applied to individual beacon updates deviation checks. For
  instance, if a beacon set has a 1% deviation threshold, Airseeker will update its beacons only when the deviation of
  each beacon exceeds (1 \* individualBeaconUpdateSettings.deviationThresholdCoefficient)%. Defaults to `1`.
- `heartbeatIntervalModifier`: The modifier applied to the heartbeat interval for individual beacon updates. This can be
  used to adjust the heartbeat interval for individual beacons. Defaults to `0`.

Example:

```jsonc
"individualBeaconUpdateSettings": {
  "deviationThresholdCoefficient": 5,
  "heartbeatIntervalModifier": 0
}
```

Defaults to `null`.

This configuration allows asynchronous updates of beacons, providing resiliency against unavailability at the cost of
some redundant updates. However, be aware that a single beacon can malfunction, potentially draining the sponsor wallet.
Therefore, this should only be enabled on the main or fallback (fixed walletDerivationScheme type) Airseeker
configurations.

#### `dataFeedUpdateInterval`

The interval specifying how often to run the data feed update loop. In seconds.

#### `dataFeedBatchSize`

The batch size of active data feeds that are to be fetched in a single RPC call.

#### `fallbackGasLimit` _(optional)_

The fallback gas limit used when the gas limit estimation using the RPC provider fails. If not specified, Airseeker will
only rely on the RPC provider for gas limit estimation and will skip an update if this fails.

### `signedDataFetchInterval`

The fetch interval in seconds between retrievals of Signed API data.

### `signedApiUrls`

A list of Signed API URLs to call along with URLs fetched from the chain.

### `useSignedApiUrlsFromContract` _(optional)_

A boolean flag that determines whether to use Signed API URLs from the AirseekerRegistry contract. When set to `true`,
Airseeker will use both the URLs from the configuration and from the contract. When set to `false`, only the URLs from
the configuration will be used.

```jsonc
"useSignedApiUrlsFromContract": true,
```

Defaults to `true`.

### `walletDerivationScheme`

The derivation scheme configuration used to derive sponsor wallets.

#### `type`

The following options are available:

- `self-funded` - The sponsor wallet is derived from the hash of the encoded beacon ID together with the update
  parameters. This is the scheme that was originally used by Nodary for self-funded data feeds.
- `managed` - Derives the wallet from the hash of the dAPI name (or data feed ID). This means the wallet derivation is
  agnostic to update parameters, and the same wallet is used when the dAPI is upgraded/downgraded.
- `fixed` - Derives the wallet from the specified `sponsorAddress`. All data feed updates will be done via this single
  wallet.
- `keycard` - Uses a Keycard hardware wallet to sign transactions.

#### `sponsorWalletMnemonic`

The mnemonic of the wallet used to derive sponsor wallets. Sponsor wallets are derived for each data feed separately. It
is recommended to interpolate this value from secrets. Required for `self-funded`, `managed`, and `fixed` types. For
example:

```jsonc
// The mnemonic is interpolated from the "SPONSOR_WALLET_MNEMONIC" secret.
"walletDerivationScheme": { "type": "managed", "sponsorWalletMnemonic": "${SPONSOR_WALLET_MNEMONIC}" },
```

#### `sponsorAddress`

The address used to derive the sponsor wallet. Required only when `type` is set to `fixed`. All data feed updates will
use a wallet derived from this address. For example:

```jsonc
"walletDerivationScheme": {
  "type": "fixed",
  "sponsorAddress": "0x1234567890123456789012345678901234567890",
  "sponsorWalletMnemonic": "${SPONSOR_WALLET_MNEMONIC}"
},
```

#### `pin` _(optional)_

The PIN for the Keycard hardware wallet. Only applicable when `type` is set to `keycard`. If not provided, the PIN will
be requested interactively at startup. For example:

```jsonc
"walletDerivationScheme": { "type": "keycard", "pin": "${KEYCARD_PIN}" },
```

Or without specifying a PIN (will prompt interactively):

```jsonc
"walletDerivationScheme": { "type": "keycard" },
```

### `stage`

An identifier of the deployment stage. This is used to distinguish between different deployments, for example `dev`,
`prod-1` or `prod-2`. The stage value can have 256 characters at maximum and can only include lowercase alphanumeric
characters and hyphens.

### `version`

The version specified in the config must match the version of the Airseeker Docker image at deployment time.
