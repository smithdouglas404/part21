FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm build:temporal
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl -sL https://temporal.download/cli.sh | bash && cp /root/.temporalio/bin/temporal /usr/local/bin/temporal && chmod +x /usr/local/bin/temporal
ENV NODE_ENV=production
ENV PORT=3000
# Sidecar mode is additive: Socra remains the upstream system and Part 21 routes
# are exposed by this service without changing Socra's deployment or database.
ENV STUDIO_GATEWAY_MODE=merged
ENV STUDIO_UPSTREAM_BASE_URL=https://studio.innume.com
ENV STUDIO_UPSTREAM_OPENAPI_URL=https://studio.innume.com/api/v1/openapi.json
ENV STUDIO_BRIDGE_ACCESS=make_changes
ENV TEMPORAL_NAMESPACE=default
ENV TEMPORAL_TASK_QUEUE=part21-clocks
ENV TEMPORAL_TLS=false
ENV TEMPORAL_HEALTH_HOST=127.0.0.1
ENV TEMPORAL_HEALTH_PORT=8090
ENV TEMPORAL_DEPLOYMENT_NAME=part21-prod
ENV TEMPORAL_BUILD_ID=1.0.0
ENV TEMPORAL_USE_WORKER_VERSIONING=false
ENV TEMPORAL_OUTBOX_INTERVAL_MS=100
ENV TEMPORAL_HEALTH_STALE_MS=1000
ENV TEMPORAL_WORKFLOW_BUNDLE_PATH=/app/dist/temporal/workflow-bundle.js
ENV TEMPORAL_WORKER_ENTRY=/app/dist/temporal/worker-entry.js
ENV TEMPORAL_APPLY_MIGRATION=true
EXPOSE 3000
CMD ["bash", "scripts/start-stack.sh"]
