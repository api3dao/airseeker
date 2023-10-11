ARG build=local

FROM node:18.14.0-alpine3.17 AS environment

ENV name="airseekerv2" \
    appDir="/app" \
    buildDir="/build"   
ENV packageDir="${buildDir}/package"

# Build preparation
FROM environment AS preparation

WORKDIR ${buildDir}

RUN apk add --update --no-cache git

# Install pnpm
RUN npm install -g pnpm

# Source preparation - local
FROM preparation as sourcelocal

COPY . ${buildDir}

# Source preparation - git
FROM preparation as sourcegit

ARG branch=main
ARG repository=https://github.com/api3dao/airseeker-v2.git

RUN git clone --single-branch --branch ${branch} ${repository} ${buildDir}

# Production dependencies
FROM source${build} AS deps

RUN pnpm install --prod --no-optional --ignore-scripts

# Production source code
FROM source${build} AS build

RUN pnpm install && \
    pnpm build && \
    pnpm pack && \
    mkdir -p ${packageDir} && \
    tar -xf *.tgz -C ${packageDir} --strip-components 1

# Result image
FROM environment

WORKDIR ${appDir}

LABEL application=${name} \
    description="AirseekerV2 container"


COPY --from=deps ${buildDir}/node_modules ./node_modules
COPY --from=build ${packageDir} .

# Create Airseeker user
RUN addgroup -S ${name} && \
    adduser -h ${appDir} -s /bin/false -S -D -H -G ${name} ${name} && \
    chown -R ${name} ${appDir}

USER ${name}

CMD ["node", "dist/index.js"]