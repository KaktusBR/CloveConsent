# syntax=docker/dockerfile:1
# The hosted app. The build context is the repository ROOT, so the image can build the
# cloveconsent library (used as "cloveconsent": "file:..") before the app:
#   docker build -f cmp/Dockerfile --build-arg PUBLIC_ORIGIN=https://<your origin> -t cloveconsent-cmp .
# PUBLIC_ORIGIN is needed at build time too: prerendered pages carry absolute canonical/hreflang URLs.
# Run the container with the same PUBLIC_ORIGIN.
# One image, two processes:
#   app:    node dist/server/entry.mjs   (default)
#   worker: node dist/worker.js

FROM node:24.22.1-slim AS build
WORKDIR /repo

# 1. The library, from the repository root
COPY package.json package-lock.json .npmrc tsconfig.json tsup.config.ts ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# 2. The app
COPY cmp/package.json cmp/package-lock.json cmp/.npmrc ./cmp/
RUN cd cmp && npm ci
COPY cmp ./cmp
ARG PUBLIC_ORIGIN
RUN cd cmp && PUBLIC_ORIGIN="$PUBLIC_ORIGIN" npm run build && npm prune --omit=dev

FROM node:24.22.1-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321
WORKDIR /repo
# Files stay owned by root and are only readable by the runtime user: the root filesystem can be mounted read-only.
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/dist ./dist
COPY --from=build /repo/src/astro ./src/astro
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/cmp/package.json ./cmp/package.json
COPY --from=build /repo/cmp/node_modules ./cmp/node_modules
COPY --from=build /repo/cmp/dist ./cmp/dist
WORKDIR /repo/cmp
USER node
EXPOSE 4321
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4321) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server/entry.mjs"]
