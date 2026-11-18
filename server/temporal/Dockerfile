FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY server/temporal ./server/temporal
COPY server/deadline-store.ts ./server/deadline-store.ts
RUN pnpm exec tsx server/temporal/build.ts

FROM node:22-bookworm
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist/temporal ./dist/temporal
USER node
CMD ["node", "dist/temporal/worker-entry.js"]
