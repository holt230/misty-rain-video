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

# PanSou 2026-10-12, source revision 221665fb2c9279f22af4684ea2d8c0c331eac1cc.
# Pin the amd64 manifest: the old search-amd64 mirror predates erxiaopan.
FROM ghcr.io/fish2018/pansou@sha256:bc674b73255b89a634faac37461ba8789486b4c92b2a3a7b09a366e2b6ea68bd AS resource-search

FROM base AS runner

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=misty-rain-pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.js ./server.js
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=resource-search --chown=node:node /app/pansou ./bin/pansou
COPY --from=builder --chown=node:node /app/scripts/verify-search-runtime.mjs ./scripts/verify-search-runtime.mjs
COPY --from=builder --chown=node:node /app/scripts/verify-official-catalog.mjs ./scripts/verify-official-catalog.mjs

RUN mkdir -p /app/data /app/bin && chown -R node:node /app/data /app/bin

USER node
# Verify the exact binary in the production runtime before publishing an image.
# This checks local startup and plugin registration, without searching the web.
RUN node scripts/verify-search-runtime.mjs
EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
