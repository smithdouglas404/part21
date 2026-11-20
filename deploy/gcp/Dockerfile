# Cloud Run image for the Part 21 Assurance OS.
#
# Differences from the repository root Dockerfile: no Temporal CLI, no embedded
# Temporal dev server, no start-stack.sh. Cloud Run runs one process per container,
# so the application and the clock worker are deployed as two services from this
# single image, selected by container command:
#
#   application:  node dist/index.js
#   worker:       node dist/temporal/worker-entry.js
#
# A stateful Temporal server must never run inside a Cloud Run container; use
# Temporal Cloud or a separate GKE deployment.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm build:mcp

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/scripts ./scripts
USER app
EXPOSE 8080
# Cloud Run overrides this for the worker service.
CMD ["node", "dist/index.js"]
