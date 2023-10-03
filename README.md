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

The mnemonic of the wallet used to derive sponsor wallets. Sponsor wallets are derived from dAPI name. It is recommended
to interpolate this value from secrets. For example:

```jsonc
// The mnemonic is interpolated from the "SPONSOR_WALLET_MNEMONIC" secret.
"sponsorWalletMnemonic": "${SPONSOR_WALLET_MNEMONIC}",
```

### `chains`

A record of chain configurations. The record key is the chain ID. For example:

```jsonc
{
  // Defines a chain with ID 1 (ETH mainnet).
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

##### `providers[<name>]`

A provider configuration.

###### `url`

The URL of the provider.
