FROM node:24-slim AS builder

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm ci --omit=dev

FROM node:24-slim

ARG USER_ID=1000
ARG GROUP_ID=1000

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && groupmod -g ${GROUP_ID} node \
    && usermod -u ${USER_ID} -g ${GROUP_ID} node

WORKDIR /app

COPY --from=builder /build/package*.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/bin ./bin
COPY --from=builder /build/server ./server
COPY --from=builder /build/dist ./dist

RUN chown -R node:node /app && \
    mkdir -p /home/node/.claude && \
    chown -R node:node /home/node/.claude

ENV SHELL=/bin/bash

USER node

EXPOSE 3000

ENTRYPOINT ["node", "bin/cli.js"]
CMD []
