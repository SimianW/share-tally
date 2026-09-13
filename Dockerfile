FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS node-base
RUN npm install --global pnpm@12.3.4
WORKDIR /app

FROM node-base AS server-build
COPY server/package.json server/pnpm-lock.yaml server/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY server/ ./
RUN pnpm typecheck && pnpm build

# Run this image with the host Docker socket, so tests can create disposable DBs.
FROM server-build AS checks
CMD ["pnpm", "test"]

FROM server-build AS server-production-deps
RUN pnpm prune --prod

FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=server-production-deps /app/node_modules ./node_modules
COPY --from=server-build /app/package.json ./package.json
COPY --from=server-build /app/dist ./dist
COPY --from=server-build /app/drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]

FROM node-base AS client-build
COPY client/package.json client/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY client/ ./
# Vite embeds this PUBLIC key in browser assets. Never pass the Clerk secret here.
ARG VITE_CLERK_PUBLISHABLE_KEY
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" && pnpm lint && pnpm build

FROM public.ecr.aws/docker/library/nginx:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=client-build /app/dist /usr/share/nginx/html
EXPOSE 80
