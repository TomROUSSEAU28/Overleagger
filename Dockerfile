# SchemaBoard — web app + collaboration server in one image.
#   docker compose up -d   →   http://localhost:8787
# Data (accounts, projects, history) lives in the /data volume.

# Base image (override with --build-arg NODE_IMAGE=… to use a registry mirror).
ARG NODE_IMAGE=node:22-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @overleagger/web build \
 && pnpm --filter @overleagger/server build \
 && pnpm --filter @overleagger/server deploy --prod --legacy /out \
 && cp -r apps/server/dist /out/dist \
 && cp -r apps/web/dist /out/web

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=build /out /app
ENV NODE_ENV=production \
    PORT=8787 \
    DB_FILE=/data/schemaboard.sqlite \
    WEB_DIR=/app/web \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
# The server runs as the unprivileged "node" user: it must own the data folder.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "dist/main.js"]
