# Development

## Run locally

You need Node.js 24, pnpm 12.3.4, PostgreSQL, and a Clerk application with Google sign-in enabled.

Install dependencies:

```bash
pnpm --dir server install --frozen-lockfile
pnpm --dir client install --frozen-lockfile
```

Create `server/.env` with your local database connection and Clerk keys:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/share_tally
CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
CLERK_SECRET_KEY=sk_test_REPLACE_ME
```

Create `client/.env.local` using the same Clerk application's publishable key:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
```

Create the database, then run migrations and start the backend:

```bash
cd server
pnpm db:migrate
pnpm dev
```

Start the frontend in another terminal:

```bash
cd client
pnpm dev
```

Open <http://localhost:5173>. The frontend forwards `/api` requests to the backend on local port `3000`.

Receipt extraction also needs Azure and item-name service settings. Add the receipt variables from the [production environment example](../deploy/.env.production.example) to `server/.env`. Keep secret keys on the server. Do not put them in `VITE_*` variables or commit them to Git.

## Checks and tests

Use the checks and test commands in [client/package.json](../client/package.json) and [server/package.json](../server/package.json). The [CI check script](../deploy/check.sh) defines the checks required before release.

Heavy checks queue on one host-wide lock, so runs from different worktrees on one machine do not overlap: browser scenarios (not `--list`), `test:environment`, `test:network-isolation`, the server's `pnpm test`, both deploy check scripts and the local gate. A waiting run prints the holder's PID, start time, directory and command, and starts only once the holder exits, which can take many minutes, so run heavy checks in the background or with a long tool timeout. `cat /tmp/share-tally-heavy-checks.lock` shows the current or last holder; `flock -n /tmp/share-tally-heavy-checks.lock true` fails while the lock is held. [`scripts/heavy-lock.mjs`](../scripts/heavy-lock.mjs) describes how the lock works. Drone builds do not take it, so a CI build on the same host can still overlap a local run.

`sh scripts/gate.sh`, the local gate, runs what CI runs before release: `deploy/check.sh`, then `deploy/browser-check.sh`. It runs both even if the first fails, then lists each failed step, browser check and scenario, and exits non-zero on any failure. Verify a change in this order:

1. Run the focused tests for the change.
2. Run the local gate once before opening a PR.
3. After a failure, rerun only the named failing scenarios. Rerun the whole local gate only after a code change.

Client unit tests also run the release script against a local stub Railway HTTP API and temporary Git repositories; those checks require Git but no Docker socket. The script runs on a [test clock](../deploy/release-test-clock.mjs) driven by the stub, so its deadlines do not depend on machine load. Backend tests require Docker and create isolated PostgreSQL test containers. Browser tests require Docker on the machine running Vite, or a test runner sharing that machine's host network. They build a cached browser image matching the installed Playwright version and start a fresh Chromium container for each scenario. The first run downloads the official Playwright image and installs its matching Node package; subsequent runs reuse Docker's build cache. No host Chromium installation is needed. The [client scripts](../client/package.json) expose each browser suite, and [suites.mjs](../client/test/browser/suites.mjs) defines their scenarios.

Each suite command runs every scenario in its suite, one after another. A scenario creates its own users, group and records in a fresh environment (PostgreSQL with migrations, the test API, Vite with the test-only Clerk substitute, and Chromium) and disposes it afterwards, so a failure does not stop the scenarios after it. To run one or more scenarios by name, or to list them, run from `client/`:

```bash
pnpm test:browser draft-save-and-recovery
pnpm test:receipts scan-fallback processing-recovery
pnpm test:browser --list
pnpm test:browser --all
```

`--all` runs every scenario in every suite, as the [release gate](operations.md#browser-release-gate) does.

To refresh the README screenshots with fictional data, run `cd client && node ../scripts/build-domain.mjs && node scripts/capture-readme.mjs`; it reuses the browser harness and is outside the release gate.

To record the 60-second fictional product demo (MP4, SRT, poster and review frames), run `cd client && node ../scripts/build-domain.mjs && node scripts/record-demo.mjs`; it needs Docker, ffmpeg and Xvfb (Chromium comes from the browser harness image), writes to `/tmp/retro/demo` (or its first argument), and is outside the release gate.

A failing scenario is reported by name; screenshots of its open pages are kept in `client/test-results/failures/<scenario>/`. `pnpm test:environment` checks partial-startup cleanup, browser connection failures, normal disposal, browser/`route.fetch` origin behavior, and HTTP through the production Nginx template with default/custom upstreams and an API replacement at a new IP. `pnpm test:network-isolation` creates and removes unrelated Docker bridges while a controlled graph of JavaScript modules is loading and fails if any browser resources report `ERR_NETWORK_CHANGED`. Scenarios live in `client/test/browser/`, grouped by business area; `environment.mjs` is the shared environment, `suites.mjs` lists every scenario and `selection.mjs` chooses which ones a command runs.

The browser container uses its own network namespace. Its loopback relay forwards the application's port to Vite through Docker's `host-gateway`, preserving localhost secure contexts, `receipt.test` plain-HTTP contexts and intercepted upstream requests. Vite listens on all interfaces while a scenario runs, so run these test-only identities and services on a trusted development machine. An unrelated remote Docker daemon cannot reach Vite using this setup. Host executable overrides such as `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` no longer apply.

Run the browser suites sequentially because they share Vite's dependency cache. Other jobs may create and remove Docker bridges without interrupting Chromium. A remaining `ERR_NETWORK_CHANGED` is still reported as a failure, with no automatic retry. If the browser cannot reach Vite, check Docker's host-gateway access and local firewall rules. Avoid deleting `~/.cache/ms-playwright` without checking other projects: it is shared, even though these tests no longer need its browsers.

`server/test/domain.test.ts` covers exact arithmetic and pricing edge cases; existing API and browser suites exercise financial, authorization, concurrency and interaction behavior.

### Rerun a failing release scenario

To rerun one failing scenario, run it by name from a checkout of the failing commit:

```bash
cd client
pnpm test:browser scan-fallback
```

To reproduce the CI container instead, run it from the repository root:

```bash
docker build --target browser-checks --tag share-tally-browser-check .
docker run --rm --network host --volume /var/run/docker.sock:/var/run/docker.sock \
  --env TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 share-tally-browser-check pnpm test:browser scan-fallback
```
