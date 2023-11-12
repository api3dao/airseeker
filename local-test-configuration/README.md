# Local Airseeker test

The idea was to use the Docker images for Pusher, Signed API and Airseeker and run them locally. Specifically, I opted
for the following setup:

- Use 2 pushers with Nodary API and reasonable fetch limits. Each pusher has a different Airnode mnemonic to mimick a
  different API. One of the APIs is delayed so that the beacons have different values.
- Use 2 signed APIs and each Pusher pushes to a separate Signed API.
- We run Airseeker only on Hardhat network for setup simplicity. Initially, I wanted to have a Polygon testnet as well,
  but gave up on that idea for now.

All configurations are based on the example files, but have been slightly modified. I had to also choose a more volatile
assets from Nodary API to see Airseeker updates.

## Instructions

- Create each configuration file from `*.example*` in all folders. Inspect each env file, read the comments and fill in
  missing secrets. Some of the secrets are the deployed contract addresses, which you'll get by following the next
  instructions.

- Build all of the Docker containers. Do build containers for Pusher and Signed API you need to run
  [this command](https://github.com/api3dao/signed-api/blob/0bad6fc8dd6aaffaa12cf099ab6bbf7c98d487c8/package.json#L11)
  from the signed-api repository. For Airseeker, you can run `pnpm docker:build` from the root of this repository.

- Start Signed API 1 on port `4001` (in a separate terminal):

```sh
docker run --publish 4001:8090 -it --init --volume $(pwd)/local-test-configuration/signed-api-1:/app/config --env-file ./local-test-configuration/signed-api-1/.env --rm --memory=256m api3/signed-api:latest
```

- Start Signed API 2 on port `4002` (in a separate terminal):

```sh
docker run --publish 4002:8090 -it --init --volume $(pwd)/local-test-configuration/signed-api-2:/app/config --env-file ./local-test-configuration/signed-api-2/.env --rm --memory=256m api3/signed-api:latest
```

You can go to `http://localhost:4001/` and `http://localhost:4002/` to see the Signed API 1 and 2 respectively.

- Start Pusher 1 (in a separate terminal):

```sh
docker run -it --init --volume $(pwd)/local-test-configuration/pusher-1:/app/config --network host --env-file ./local-test-configuration/pusher-1/.env --rm --memory=256m api3/pusher:latest
```

- Start Pusher 2 (in a separate terminal):

```sh
docker run -it --init --volume $(pwd)/local-test-configuration/pusher-2:/app/config --network host --env-file ./local-test-configuration/pusher-2/.env --rm --memory=256m api3/pusher:latest
```

- Start Hardhat node (in a separate terminal):

```sh
pnpm run dev:eth-node
```

- Deploy the test contracts and fund respective Airseeker sponsor wallets:

```sh
pnpm ts-node -T ./local-test-configuration/scripts/initialize-chain.ts
```

This command gives you the addresses of the deployed contracts. These need to be put to Airseeker secrets and are
required also for the monitoring page.

- Open the monitoring page located in `local-test-configuration/monitoring/index.html` in a browser with the following
  query parameters appended
  `api3ServerV1Address=<DEPLOYED_API3_SERVER_V1_ADDRESS>&dapiDataRegistryAddress=<DEPLOYED_DAPI_DATA_REGISTRY_ADDRESS>`
  and open console.

Initially, you should see errors because the beacons are not initialized. After you run Airseeker, it will do the
updates and the errors should be gone. The page constantly polls the chain and respective signed APIs and compares the
on-chain and off-chain values. If the deviation exceeds the treshold, the value is marked bold and should be updated by
Airseeker shortly.

- Run the Airseeker:

```sh
docker run -it --init --volume $(pwd)/local-test-configuration/airseeker:/app/config --network host --env-file .env --rm api3/airseeker-v2:latest
```

## Final notes

- Monitor the logs of each service, pay attention to errors, warnings and possible improvements.
- Use the monitoring page to see if the feeds update when they should.
- I also tried changing the batch size in Airseeker to 1 and Airseeker worked as expected (but was more chattier).
