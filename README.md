# airseeker-v2

> A service powering data feeds using the [signed API](https://github.com/api3dao/signed-api).

The Airseeker is a rework of the [original Airseeker](https://github.com/api3dao/airseeker). The Airseeker v2 is
simplified and only works with signed APIs.

## Flowchart and specification

A render of the flowchart can be found below. To edit this document, use [diagrams.net](https://app.diagrams.net) to
edit `airseeker_v2_pipeline.drawio`, preferably by cloning the repository and loading the file locally.

![Airseeker flowchart](airseeker_v2_pipeline.drawio.svg)

Link to the
[Airseeker specification](https://docs.google.com/document/d/1x5QBOGII8IUGjtoNR6PVE_UeqEjRQj2u3Ysa1FQkHf0/edit).

## Getting started

1. `pnpm install` - To install the dependencies.
2. `cp config/airseeker.example.json config/airseeker.json` - To create the configuration file.
3. `cp config/secrets.example.env config/secrets.env` - To create the secrets file.

## Configuration

Airseeker can be configured via a combination of [environment variables](#environment-variables) and
[configuration files](#configuration-files).

### Environment variables

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

### `LOGGER_ENABLED`

Enables or disables logging. Options:

- `true` - Enables logging.
- `false` - Disables logging.

### `LOG_FORMAT`

The format of the log output. Options:

- `json` - Specifies JSON log format. This is suitable when running in production and streaming logs to other services.
- `pretty` - Logs are formatted in a human-friendly "pretty" way. Ideal, when running the service locally and in
  development.

### `LOG_COLORIZE`

Enables or disables colors in the log output. Options:

- `true` - Enables colors in the log output. The output has special color setting characters that are parseable by CLI.
  Recommended when running locally and in development.
- `false` - Disables colors in the log output. Recommended for production.

### `LOG_LEVEL`

Defines the minimum level of logs. Logs with smaller level (severity) will be silenced. Options:

- `debug` - Enables all logs.
- `info` - Enables logs with level `info`, `warn` and `error`.
- `warn` - Enables logs with level `warn` and `error`.
- `error` - Enables logs with level `error`.

## Configuration files

Airseeker needs two configuration files, `airseeker.json` and `secrets.env`. All expressions of a form `${SECRET_NAME}`
are referring to values from secrets and are interpolated inside the `airseeker.json` at runtime. You are advised to put
sensitive information inside secrets.

### `sponsorWalletMnemonic`

The mnemonic of the wallet used to derive sponsor wallets. Sponsor wallets are derived for each dAPI separately. It is
recommended to interpolate this value from secrets. For example:

```jsonc
// The mnemonic is interpolated from the "SPONSOR_WALLET_MNEMONIC" secret.
"sponsorWalletMnemonic": "${SPONSOR_WALLET_MNEMONIC}",
```

### `chains`

A record of chain configurations. The record key is the chain ID. For example:

```jsonc
{
  // Defines a chain configuration with ID 1 (ETH mainnet).
  "1": {
    "providers": {
      "mainnet": {
        "url": "http://mainnet.com"
      }
    }
  }
}
```

#### `contracts` _(optional)_

A record of contract addresses used by Airseeker. If not specified, the addresses are loaded from
[Airnode protocol v1](https://github.com/api3dao/airnode-protocol-v1).

##### `Api3ServerV1` _(optional)_

The address of the Api3ServerV1 contract. If not specified, the address is loaded from the Airnode protocol v1
repository.

#### `providers`

A record of providers. The record key is the provider name. Provider name is only used for internal purposes and to
uniquely identify the provider for the given chain.

##### `providers[<NAME>]`

A provider configuration.

###### `url`

The URL of the provider.

#### `__Temporary__DapiDataRegistry`

The data needed to make the requests to signed API. This data will in the future be stored on-chain in a
`DapiDataRegistry` contract. For the time being, they are statically defined in the configuration file.

##### `airnodeToSignedApiUrl`

A mapping from Airnode address to signed API URL. When data from particular beacon is needed a request is made to the
signed API corresponding to the beacon address.

##### `activeDapiNames`

An array of dAPI names to execute updates for.

##### `dataFeedIdToBeacons`

A mapping from data feed ID to a list of beacon data.

##### `dataFeedIdToBeacons<DATA_FEED_ID>[n]`

A single element array for a beacon data. If the data feed is a beacon set, the array contains the data for all the
beacons in the beacon set (in correct order).

##### `airnode`

The Airnode address of the beacon.

##### `templateId`

The template ID of the beacon.

#### `gasSettings`

The settings used to calculate gas prices used to submit transactions.

##### `recommendedGasPriceMultiplier`

The multiplier used for the provider recommended gas price.

##### `sanitizationSamplingWindow`

The number of minutes for which to keep historical gas prices.

##### `sanitizationPercentile`

The percentile of gas historical prices to use for sanitization.

##### `scalingWindow`

The number of minutes used to calculate the scaling multiplier if a pending transaction is detected.

##### `maxScalingMultiplier`

The maximum scaling multiplier used when the pending transaction lag exceeds the `scalingWindow`.

### `deviationThresholdCoefficient`

The global coefficient applied to all deviation checks. Used to differentiate alternate deployments. For example:

```jsonc
"deviationThresholdCoefficient": 1,
```

### `fetchInterval`

The fetch interval in seconds between retrievals of signed API data.

## Docker

### Build

The docker image can be built by running the following command from the root directory:

```sh
yarn docker:build
```

### Run

The docker image can be run locally with:

```sh
yarn docker:run
```
