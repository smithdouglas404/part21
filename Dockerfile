FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV NODE_ENV=production
ENV PORT=3000
# Sidecar mode is additive: Socra remains the upstream system and Part 21 routes
# are exposed by this service without changing Socra's deployment or database.
ENV STUDIO_GATEWAY_MODE=merged
ENV STUDIO_UPSTREAM_BASE_URL=https://studio.innume.com
ENV STUDIO_UPSTREAM_OPENAPI_URL=https://studio.innume.com/api/v1/openapi.json
ENV STUDIO_BRIDGE_ACCESS=make_changes
EXPOSE 3000
CMD ["node", "dist/index.js"]
