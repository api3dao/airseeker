# airseeker-v2

> A service powering data feeds using the [signed API](https://github.com/api3dao/signed-api).

The Airseeker is a rework of the [original Airseeker](https://github.com/api3dao/airseeker). The Airseeker v2 is
simplified and only works with signed APIs.

## Getting started

1. `pnpm install` - To install the dependencies.
2. `cp config/airseeker.example.json config/airseeker.json` - To create the configuration file.
3. `cp config/secrets.example.env config/secrets.env` - To create the secrets file.

## Configuration

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

##### Api3ServerV1 _(optional)_

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

##### `dataFeedIdToBeacons`

A mapping from data feed ID to a list of beacon data.

##### `dataFeedIdToBeacons<DATA_FEED_ID>`

A single element array for a beacon data. If the data feed is a beacon set, the array contains the data for all the
beacons in the beacon set (in correct order).

###### `dataFeedIdToBeacons<DATA_FEED_ID>[n]`

A beacon data.

`airnode`

The Airnode address of the beacon.

`templateId`

The template ID of the beacon.

### `deviationThresholdCoefficient`

The global coefficient applied to all deviation checks. Used to differentiate alternate deployments. For example:

```jsonc
"deviationThresholdCoefficient": 1,
```

## Docker

### Build

The docker image can be built by running the following command from the root directory:

```sh
yarn docker:build
```

### Run

The docker image can be ran locally with:

```sh
yarn docker:run



```
