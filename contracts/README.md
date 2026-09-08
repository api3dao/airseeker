# Api3ServerV1BuilderTipExtension

The reference implementation of the contract through which Airseeker tips block builders, see
[configuration](../config/configuration.md) for how Airseeker uses it. The contract is not part of
[@api3/contracts](https://github.com/api3dao/contracts) and needs to be deployed by whoever wants to use it.

1. `cp .env.example .env` and set `MNEMONIC` to the deployer account, and `ETHERSCAN_API_KEY` to have the contract
   verified. The chain is reached through its public RPC URL from `@api3/contracts` unless
   `HARDHAT_HTTP_RPC_URL_<CHAIN_ALIAS>` names another one, e.g. `HARDHAT_HTTP_RPC_URL_BASE_SEPOLIA_TESTNET` for
   `base-sepolia-testnet`.
2. `NETWORK=<chain-alias> pnpm deploy:deterministic`, or `pnpm deploy:undeterministic` on chains without the
   deterministic deployment proxy.

Chain aliases come from `@api3/contracts`, as does the Api3ServerV1 address that the contract is deployed against. The
contract is verified on whichever of Etherscan, Blockscout and Sourcify the chain supports, and the deployment is
recorded under `deployments/<chain-alias>/`, so rerunning only reruns the verification. Add the resulting address to the
chain's `contracts.Api3ServerV1BuilderTipExtension` in the Airseeker configuration.

A deterministic deployment only shares its address across chains on which Api3ServerV1 itself has the same address,
since that address is a constructor argument.
