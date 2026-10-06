# syntax=docker/dockerfile:1

# CI reads this from package.json; local builds must pass --build-arg.
ARG BUN_VERSION
ARG BUILDPLATFORM

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-alpine AS build

WORKDIR /app
ENV HUSKY=0

COPY package.json bun.lock ./
COPY apps/page/package.json apps/page/package.json
COPY apps/server/package.json apps/server/package.json
RUN bun install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json tsconfig.json ./
COPY apps/page apps/page
COPY apps/server apps/server
RUN bun run build

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-alpine AS dependencies
ARG TARGETARCH

WORKDIR /app
ENV HUSKY=0

COPY package.json bun.lock ./
COPY apps/page/package.json apps/page/package.json
COPY apps/server/package.json apps/server/package.json
RUN case "$TARGETARCH" in amd64) cpu=x64 ;; arm64) cpu=arm64 ;; *) exit 1 ;; esac \
    && bun install --filter @bangarr/server --production --frozen-lockfile --ignore-scripts --os=linux --cpu=$cpu

FROM oven/bun:${BUN_VERSION}-alpine
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data
RUN apk add --no-cache nginx s6 \
    && mkdir -p /app/data && chown bun:bun /app/data

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/apps/page/dist ./public
COPY apps/server/src ./apps/server/src
COPY apps/server/package.json apps/server/tsconfig.json ./apps/server/
COPY package.json tsconfig.base.json tsconfig.json LICENSE ./

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/services /etc/bangarr/services
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/bangarr-entrypoint
RUN chmod +x /etc/bangarr/services/*/run

USER bun
EXPOSE 8000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8000/api/health || exit 1
ENTRYPOINT ["bangarr-entrypoint"]
