# Operations

## Deployment

See the [Drone configuration](../.drone.yml) for release steps, triggers and concurrency. Serial builds keep the browser gates from sharing the host and migrations and deploys from overlapping.

Production deployment targets Railway Hobby, with `api` and `web` services in **US East Metal (Virginia)** and the database on **Neon AWS us-east-1**. [ADR-0022](adr/0022-host-on-railway-near-neon.md) records the decision.

A release deploys only the commit at the head of `main`. Before changing Railway, [`deploy/deploy.sh`](../deploy/deploy.sh) reads `main` from GitHub. If `main` has moved on, it logs `Release superseded` and exits successfully without deploying anything. The newer commit's own release then deploys it. This also applies when an earlier build is restarted. If the newest commit fails its checks, its release does not run, and an older release that was still waiting is skipped as superseded. The previously deployed release keeps running.

After the [browser gate](#browser-release-gate), [the publish script](../deploy/publish.sh) publishes the tested images. The release sets the API's image through Railway's API, starts a deployment and waits for activation. Only a successful API deployment allows the matching web deployment. A failure or timeout fails the release; no web deployment follows an API failure. The deploy step has no Docker socket or home deployment-directory mount. Production application variables belong only in Railway service settings, not Drone, the images or this repository.

### Railway service settings

Create both services in the same project and production environment, in US East Metal. Use an environment created after 2025-10-16 so private DNS supports IPv4 as well as IPv6. Deploy each service from its public GHCR image; Drone updates the image to each released commit's tag.

| Setting | `api` | `web` |
| --- | --- | --- |
| Listening/health-check port | `PORT=3000`; the image already sets `HOST=0.0.0.0` | `PORT=80`; Nginx listens on 80 |
| Pre-deploy command | `node dist/migrate.js` | None |
| Pre-deploy timeout | 300 seconds | Not applicable |
| Health-check path | `/api/health/ready` | `/index.html` (static; never touches PostgreSQL) |
| Health-check timeout | 300 seconds | 300 seconds |
| Public domain | None; private network only | Railway-generated domain and `sharetally.app` |
| API upstream | Not applicable | `API_UPSTREAM=api.railway.internal:3000` |

Enter the API's production variables using [`deploy/.env.production.example`](../deploy/.env.production.example) as a placeholder reference. `DATABASE_URL` must be the **direct**, non-pooled Neon Virginia endpoint (no `-pooler` suffix), with `sslmode=verify-full` and a URL-encoded password. [`server/src/migrate.ts`](../server/src/migrate.ts) holds a session-level PostgreSQL advisory lock on the migration connection; Neon's transaction-mode pooler does not support that lock. The application already pools at most ten application connections plus one readiness connection per API process. Overlapping releases and the pre-deploy migration can temporarily add connections.

Railway's pre-deploy timeout is separate from its activation health-check timeout and the release script's per-service deadline. See [railway-release.mjs](../deploy/railway-release.mjs) for the per-service deadline; it allows headroom beyond the migration and health-check budgets for image pulls and deployment setup. On timeout or a polling error after receiving a deployment ID, the script requests cancellation before failing. Cancellation has its own bounded request timeout; if cancellation fails, the release still fails and warns that the deployment may still activate. A migration waiting indefinitely for the advisory lock must fail within the configured 300-second limit. A failed pre-deploy command or readiness check prevents activation, keeping the previous API serving. The migration lock also serializes a manual `pnpm db:migrate` with deployment migrations; `server/test/migrate.test.ts` verifies concurrent runs.

The web image renders the shared [`deploy/nginx.conf`](../deploy/nginx.conf) through the official Nginx entrypoint; [`deploy/05-configure-api.envsh`](../deploy/05-configure-api.envsh) supplies the Compose default upstream and container DNS servers. Nginx's shared upstream zone re-resolves the API address so it is not fixed at web startup. Resolution uses IPv4 answers because the API binds `0.0.0.0`. A named upstream with no URI suffix preserves the original request URI without the URI-handling changes of a variable `proxy_pass`. SSE pass-through and static headers are unchanged; the browser harness uses the same configuration source. Retain [`deploy/compose.yml`](../deploy/compose.yml) for local runs.

### Displayed-name rule releases

Migration `0020_profile_name_rule` marks existing name caches with rule version 0, and migration `0021_member_usernames` adds the cached Username column. The API's startup Clerk synchronization rewrites each cache with the Profile-name-first rule, stores the current Username and advances its rule version to 2, publishing the usual rename notifications after commit. Rows already at version 1 are read again so their Usernames are filled in. It retains Clerk's timestamp and row lock, so older reads cannot replace newer data during the rewrite. A row whose displayed name and Username are both unchanged advances its rule version without a notification; a changed Username alone does notify, because it can add or remove a collision tag. The rewrite runs in the background after startup, so names update shortly after release rather than at the moment the API starts. Failed or missing Clerk reads remain pending for the next synchronization; completed rows are not forced again on startup.

### Health endpoints and incident checks

`GET /api/health` is liveness: it succeeds whenever the API process responds. `GET /api/health/ready` is readiness: it returns 503 when PostgreSQL does not answer within its time limit. Railway uses readiness only during deployment activation, not continuous monitoring. See the [Compose health-check configuration](../deploy/compose.yml) for local probes. Neither is evidence that the database remains reachable after activation; check `/api/health/ready` by hand during an incident.

### Rollback

Dashboard rollback is separate from CI: do not restart an old Drone build to roll back, because the head-of-main guard skips it; push a revert to `main` for a gated rollback.

### Browser release gate

The [Drone configuration](../.drone.yml) defines the release ordering and which events reach the host Docker socket and deployment secrets. A failing gate prevents publishing and deployment.

Every push to `main` runs the gate. Pushes to other branches run it too, unless every file changed since the branch left `main` is under `docs/` or `research/` or ends in `.md`; [`deploy/browser-gate-skippable.sh`](../deploy/browser-gate-skippable.sh) decides, runs the gate on any doubt or error, and logs the reason. [`deploy/browser-gate.test.mjs`](../deploy/browser-gate.test.mjs) covers the details. A branch build's gate only reports; publishing and deployment stay limited to `main`.

[`deploy/browser-check.sh`](../deploy/browser-check.sh) builds the `browser-checks` image. It runs each check in a container that shares the host network and Docker socket, the setup described in [Checks and tests](development.md#checks-and-tests). The script collects failures so one failed check does not hide later failures; scenario failures are named in the output. Failure screenshots stay inside the removed container. To get them, [rerun the scenario locally](development.md#rerun-a-failing-release-scenario).

While the step runs, Vite listens on all host interfaces and serves test-only identities, so keep the Drone host's test ports firewalled from the internet.

To rerun the whole gate, restart the Drone build. A gate that failed blocks that commit from release. A later push to `main` that passes releases normally.

## PR automation

See the [PR-size workflow](../.github/workflows/pr-size.yml).
