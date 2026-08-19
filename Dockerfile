ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=misty-rain-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS builder
ARG APP_BASE_PATH=/misty-rain/
COPY . .
RUN APP_BASE_PATH="$APP_BASE_PATH" pnpm build

FROM ghcr.io/holt230/misty-rain-video:search-amd64 AS resource-search

FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.js ./server.js
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=resource-search --chown=node:node /app/pansou ./bin/pansou

RUN mkdir -p /app/data /app/bin && chown -R node:node /app/data /app/bin

USER node
EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
