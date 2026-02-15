FROM node:24-alpine AS builder

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm ci --omit=dev

FROM node:24-alpine

ARG USER_ID=1000
ARG GROUP_ID=1000

RUN deluser node 2>/dev/null || true && \
    delgroup node 2>/dev/null || true && \
    addgroup -g ${GROUP_ID} appuser && \
    adduser -D -u ${USER_ID} -G appuser appuser

WORKDIR /app

COPY --from=builder /build/package*.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/bin ./bin
COPY --from=builder /build/server ./server
COPY --from=builder /build/dist ./dist

RUN chown -R appuser:appuser /app && \
    mkdir -p /home/appuser/.claude && \
    chown -R appuser:appuser /home/appuser/.claude

USER appuser

EXPOSE 3000

ENTRYPOINT ["node", "bin/cli.js"]
CMD []
