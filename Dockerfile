FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS node-base
RUN npm install --global pnpm@12.3.4
WORKDIR /app

FROM node-base AS server-build
WORKDIR /app/server
COPY packages/domain/ /app/packages/domain/
COPY scripts/build-domain.mjs /app/scripts/build-domain.mjs
COPY server/package.json server/pnpm-lock.yaml server/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY server/ ./
RUN pnpm typecheck && pnpm build

FROM node-base AS client-lint
WORKDIR /app/client
COPY packages/domain/ /app/packages/domain/
COPY scripts/build-domain.mjs /app/scripts/build-domain.mjs
COPY client/package.json client/pnpm-lock.yaml client/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY client/ ./
RUN pnpm lint && pnpm test:unit && touch /client-lint-passed

# Run this image with the host Docker socket, so tests can create disposable DBs.
FROM server-build AS checks
# Depend on the client lint stage even when only --target checks is built.
COPY --from=client-lint /client-lint-passed /client-lint-passed
# Correction regressions exercise the browser adapter against the real API.
COPY client/src/ /app/client/src/
RUN mkdir -p /app/client/node_modules/@share-tally && \
    ln -s /app/packages/domain /app/client/node_modules/@share-tally/domain
CMD ["pnpm", "test"]

# Browser scenarios need the client and server sources with dev dependencies.
# Run with the host network and Docker socket; see deploy/browser-check.sh.
FROM client-lint AS browser-checks
# The infrastructure tests inspect containers with the Docker CLI (static binary).
COPY --from=public.ecr.aws/docker/library/docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=server-build /app/server/ /app/server/
# The SSE soak scenarios proxy through the production Nginx configuration.
COPY deploy/nginx.conf /app/deploy/nginx.conf

FROM server-build AS server-production-deps
RUN pnpm prune --prod

FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS api
WORKDIR /app/server
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=server-production-deps /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/drizzle ./drizzle
COPY --from=server-build /app/packages/domain/package.json /app/packages/domain/package.json
COPY --from=server-build /app/packages/domain/dist /app/packages/domain/dist
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]

FROM client-lint AS client-build
# Vite embeds this PUBLIC key in browser assets. Never pass the Clerk secret here.
ARG VITE_CLERK_PUBLISHABLE_KEY
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" && pnpm build

FROM public.ecr.aws/docker/library/nginx:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=client-build /app/client/dist /usr/share/nginx/html
EXPOSE 80
