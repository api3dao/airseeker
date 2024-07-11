# airseeker-v2

> A service powering data feeds using the [signed API](https://github.com/api3dao/signed-api).

The Airseeker is a rework of the [original Airseeker](https://github.com/api3dao/airseeker). The Airseeker v2 is
simplified and only works with signed APIs.

## Getting started

1. `pnpm install` - To install the dependencies.
2. `cp config/airseeker.example.json config/airseeker.json` - To create the configuration file.
3. `cp config/secrets.example.env config/secrets.env` - To create the secrets file.

## Flowchart and specification

A render of the flowchart can be found below. To edit this document, use [diagrams.net](https://app.diagrams.net) to
edit `airseeker_v2_pipeline.drawio`, preferably by cloning the repository and loading the file locally.

![Airseeker flowchart](airseeker_v2_pipeline.drawio.svg)

Link to the
[Airseeker specification](https://docs.google.com/document/d/1x5QBOGII8IUGjtoNR6PVE_UeqEjRQj2u3Ysa1FQkHf0/edit).

## Configuration

See [configuration](./config/configuration.md) for details.

## Versioning and release

Airseeker uses [semantic versioning](https://semver.org/). The version is specified in the `package.json` file. The
package is not published to NPM, but instead dockerized and published to Docker Hub.

To release a new version:

1. `pnpm create-release:npm [major|minor|patch]` - Choose the right version bump. This will bump the version, create a
   git tag and commit it.
2. `pnpm publish --access public` - Publish the package to NPM.
3. `git push --follow-tags` - Push the tagged commit upstream.
4. Create a GitHub release for the specific tag.
5. `pnpm run create-release:docker` - To build the Docker image and tag it correctly. The script uses the current
   package.json version so it expects the NPM release is done first.
6. The command outputs the publish instructions to push the images.

## Docker

### Build

The docker image can be built by running the following commands from the root directory:

```sh
pnpm run docker:build
```

### Run

Create a `.env` file using `cp .env.example .env` and run the docker image locally with:

```sh
pnpm run docker:run
```
