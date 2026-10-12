# Host on Railway near the Neon database

The owner chose Railway Hobby for the API and web services, both in **US East Metal (Virginia)**, with the production database remaining on **Neon AWS us-east-1 (N. Virginia)** ([issue #246](https://github.com/SimianW/share-tally/issues/246)). This replaces the home-server production topology reached through a public VPS and FRP. The home server still hosts Drone CI; moving CI, photos, DNS and the actual production cutover are separate work.

## Rationale

Railway manages container placement, deployment health checks and public TLS, avoiding the OS patching, reverse-proxy/TLS maintenance and production incident work of a self-managed VPS. Separating production from the development/CI machine removes home power, connectivity, disk and experiment failures from the application's hosting path. Hobby is the selected budget, not a guarantee that measured resource usage will fit its included allowance.

Virginia keeps the API near the existing Neon database. Several sequential SQL statements, especially within a transaction, amplify the home server's approximately 20 ms database round trip; the selected regions reduce that network distance. They are in the same geographic area, not necessarily the same datacenter or network. Query latency must be measured from the Railway API before cutover rather than inferred from the region names.

## Release and service boundaries

Drone keeps the existing server, client and browser release gates and publishes public GHCR API/web images tagged with the tested commit SHA. Only the release at the head of `main` proceeds. The deploy step uses Railway's public API to set and deploy that exact API image, waits for success, then sets and deploys the matching web image. It does not mount the home server's Docker socket or deployment directory. Production application variables stay in Railway, outside CI and the images.

The API has no public domain. A bounded pre-deploy migration command must succeed before startup; `/api/health/ready` must pass before Railway activates it. Activation health checks are not continuous database probes. The web service exposes the public domain and proxies same-origin `/api/` traffic over the project's private network. Its configurable Nginx upstream defaults to `api:3000` for Docker Compose and uses `api.railway.internal:3000` on Railway. Use the official Nginx image's template entrypoint and container DNS resolvers with a shared upstream zone, `server ... resolve`, a five-second DNS validity interval and IPv4 answers (the API binds `0.0.0.0`). This is supported in open-source Nginx 1.28 and avoids a variable `proxy_pass`'s URI handling: the named upstream passes the original URI unchanged. It re-resolves after an API-only redeploy while retaining SSE pass-through and the existing static delivery rules. Production and browser tests share one proxy configuration source. A Docker test verifies a changed upstream address without restarting web; actual Railway resolver reachability and redeploy behavior still need staging verification.

## Direct database sessions

Use Neon's **direct**, non-pooled endpoint with `sslmode=verify-full`. `server/src/migrate.ts` acquires a session-level PostgreSQL advisory lock and runs migrations on that same connection; Neon's transaction-mode PgBouncer does not support session-level advisory locks. The application already has a node-postgres pool of at most ten connections plus a separate one-connection readiness pool, so one API process uses at most eleven connections. Overlapping releases and the separate pre-deploy migration process can temporarily add connections; eleven is not a deployment-wide ceiling.

## Consequences

Keep one API replica: realtime notifications are process-local and horizontal scaling requires shared delivery first. Retain Docker Compose for local use and the initial fallback; it is no longer Drone's production deployment target. Dashboard setup, an API-only redeploy, failed-migration rollback behavior, real authentication, streaming, scanning and database latency need live Railway verification before the owner changes the public route.

References: [Railway regions](https://docs.railway.com/reference/regions), [pre-deploy commands and timeout](https://docs.railway.com/guides/pre-deploy-command), [activation health checks](https://docs.railway.com/guides/healthchecks), [Neon pooling limitations](https://neon.com/docs/connect/connection-pooling), [node-postgres pool defaults](https://node-postgres.com/apis/pool), [Nginx upstream DNS resolution](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server), [Nginx proxy URI handling](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).
