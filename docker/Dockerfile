FROM node:20-alpine
ENV name="airseeker"
LABEL application="airseeker" description="Airseeker container"
WORKDIR /app

# Install pnpm globally (needs root privileges).
RUN npm install -g pnpm@9

# Copy just the "pnpm-lock.yaml" file and use "pnpm fetch" to download all dependencies just from the lockfile. This
# command is specifically designed to improve building a docker image because it only installs the dependencies if the
# lockfile has changed (otherwise uses the cached value).
COPY pnpm-lock.yaml /app
RUN pnpm fetch
# Copies all of the contents (without files listed in .dockerignore) of the monorepo into the image.
COPY . /app
# Ideally, we would use "--offline" option, but it seems pnpm has a bug. Fortunately, the instalation times are similar.
# See: https://github.com/pnpm/pnpm/issues/6058 for details.
RUN pnpm install --prefer-offline
RUN pnpm run build

RUN chown --recursive node:node /app
# "node" Docker images come with a built-in, least-privileged user called "node"
USER node
# Start the Airseeker.
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/src/index.js"]
