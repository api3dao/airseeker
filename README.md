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

## Versioning and release

Airseeker uses [semantic versioning](https://semver.org/). The version is specified in the `package.json` file. The
package is not published to NPM, but instead dockerized and published to Docker Hub.

To release a new version:

1. `git checkout main` - Always version from `main` branch. Also, ensure that the working directory is clean (has no
   uncommitted changes).
2. `contracts:compile:force` - Build the latest Typechain artifacts.
3. `pnpm version [major|minor|patch]` - Choose the right version bump. This will bump the version, create a git tag and
   commit it.
4. Build the docker image with tag `api3/airseeker:latest`. If running on Linux, use `pnpm run docker:build` otherwise
   use `pnpm run docker:build:amd64`.
5. `docker tag api3/airseeker:latest api3/airseeker:<MAJOR.MINOR.PATCH>` - Tag the image with the version. Replace the
   `<MAJOR.MINOR.PATCH>` with the version you just bumped (copy it from `package.json`).
6. `docker push api3/airseeker:latest && docker push api3/airseeker:<MAJOR.MINOR.PATCH>` - Push the image upstream. Both
   the latest and the versioned tag should be published.
7. `git push --follow-tags` - Push the tagged commit upstream.

## Configuration

Airseeker can be configured via a combination of [environment variables](#environment-variables) and
[configuration files](#configuration-files).

### Environment variables

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

#### `LOGGER_ENABLED` _(optional)_

Enables or disables logging. Options:

- `true` - Enables logging.
- `false` - Disables logging.

Default: `true`.

#### `LOG_FORMAT` _(optional)_

The format of the log output. Options:

- `json` - Specifies JSON log format. This is suitable when running in production and streaming logs to other services.
- `pretty` - Logs are formatted in a human-friendly "pretty" way. Ideal, when running the service locally and in
  development.

Default: `json`.

#### `LOG_COLORIZE` _(optional)_

Enables or disables colors in the log output. Options:

- `true` - Enables colors in the log output. The output has special color setting characters that are parseable by CLI.
  Recommended when running locally and in development.
- `false` - Disables colors in the log output. Recommended for production.

Default: `false`.

#### `LOG_LEVEL` _(optional)_

Defines the minimum level of logs. Logs with smaller level (severity) will be silenced. Options:

- `debug` - Enables all logs.
- `info` - Enables logs with level `info`, `warn` and `error`.
- `warn` - Enables logs with level `warn` and `error`.
- `error` - Enables logs with level `error`.

Default: `info`.

### Configuration files

Airseeker needs two configuration files, `airseeker.json` and `secrets.env`. All expressions of a form `${SECRET_NAME}`
are referring to values from secrets and are interpolated inside the `airseeker.json` at runtime. You are advised to put
sensitive information inside secrets.

#### `sponsorWalletMnemonic`

The mnemonic of the wallet used to derive sponsor wallets. Sponsor wallets are derived for each data feed separately. It
is recommended to interpolate this value from secrets. For example:

```jsonc
// The mnemonic is interpolated from the "SPONSOR_WALLET_MNEMONIC" secret.
"sponsorWalletMnemonic": "${SPONSOR_WALLET_MNEMONIC}",
```

#### `chains`

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

##### `contracts`

A record of contract addresses used by Airseeker.

###### `Api3ServerV1` _(optional)_

The address of the Api3ServerV1 contract. If not specified, the address is loaded from the
[Airnode protocol v1](https://github.com/api3dao/airnode-protocol-v1) repository.

###### `AirseekerRegistry`

The address of the AirseekerRegistry contract.

##### `providers`

A record of providers. The record key is the provider name. Provider name is only used for internal purposes and to
uniquely identify the provider for the given chain.

###### `providers[<NAME>]`

A provider configuration.

`url`

The URL of the provider.

##### `gasSettings`

The settings used to calculate gas prices used to submit transactions.

###### `recommendedGasPriceMultiplier`

The multiplier used for the provider recommended gas price.

###### `sanitizationSamplingWindow`

The number of seconds for which to keep historical gas prices.

###### `sanitizationPercentile`

The percentile of gas historical prices to use for sanitization.

###### `scalingWindow`

The number of seconds used to calculate the scaling multiplier if a pending transaction is detected.

###### `maxScalingMultiplier`

The maximum scaling multiplier used when the pending transaction lag exceeds the `scalingWindow`.

##### `deviationThresholdCoefficient` _(optional)_

The global coefficient applied to all deviation checks. Used to differentiate alternate deployments. For example:

```jsonc
"deviationThresholdCoefficient": 1,
```

Defaults to `1`.

##### `dataFeedUpdateInterval`

The interval specifying how often to run the data feed update loop. In seconds.

##### `dataFeedBatchSize`

The batch size of active data feeds that are to be fetched in a single RPC call.

##### `fallbackGasLimit` _(optional)_

The fallback gas limit used when the gas limit estimation using the RPC provider fails. If not specified, Airseeker will
only rely on the RPC provider for gas limit estimation and will skip an update if this fails.

#### `signedDataFetchInterval`

The fetch interval in seconds between retrievals of signed API data.

#### `signedApiUrls`

A list of signed API URLs to call along with URLs fetched from the chain.

#### `walletDerivationScheme`

The derivation scheme used to derive sponsor wallets. The following options are available:

- `self-funded` - The sponsor wallet is derived from the hash of the encoded beacon ID together with the update
  parameters. This is the scheme that was originally used by Nodary for self-funded data feeds.
- `managed-dapis` - Derives the wallet from the hash of the dAPI name (or data feed ID). This means the wallet
  derivation is agnostic to update parameters, and the same wallet is used when the dAPI is upgraded/downgraded.

## Docker

### Build

The docker image can be built by running the following commands from the root directory:

```sh
pnpm run contracts:compile # The Typechain artifacts are copied over to the Docker image.
pnpm run docker:build
```

### Run

The docker image can be run locally with:

```sh
pnpm run docker:run
```
