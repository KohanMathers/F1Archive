ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=12.17.0

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/

FROM manifests AS build
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @f1archive/api build \
    && pnpm --filter @f1archive/worker build \
    && pnpm --filter @f1archive/web build

FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter "@f1archive/api..." --filter "@f1archive/worker..."

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
RUN mkdir -p /data/exports /data/radio && chown -R node:node /data
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production MIGRATIONS_DIR=/repo/packages/db/migrations
WORKDIR /repo
COPY --from=prod-deps /repo /repo
COPY packages/db/migrations /repo/packages/db/migrations
COPY --from=build /repo/apps/worker/dist /repo/apps/worker/dist
RUN mkdir -p /data/exports /data/radio /data/source && chown -R node:node /data
WORKDIR /repo/apps/worker
USER node
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
