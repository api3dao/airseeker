# airseeker-v2

> A service powering data feeds using the [Signed API](https://github.com/api3dao/signed-api).

Airseeker v2 is a streamlined redesign of the [original Airseeker](https://github.com/api3dao/airseeker-v1), focused
exclusively on working with Signed APIs for improved efficiency and simplicity.

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
package is published to GitHub, NPM, Docker Hub.

To release a new version:

1. `pnpm create-release:npm [major|minor|patch]` - This will bump the version throughout the repo and commit the
   changes.
2. Push to `main`. This will trigger the `tag-and-release` GitHub Actions job and result in 1) the commit being tagged
   with the new version, 2) the release being created on GitHub and npm, and 3) the Docker image being built and pushed
   to Docker Hub.

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
