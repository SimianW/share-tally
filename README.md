# ShareTally

Split shared purchases with friends and work out who owes whom. Built for Costco runs, shared meals, and everyday group shopping.

**Try it: [sharetally.app](https://sharetally.app)**

## How it works

1. Sign in, create a group, and invite friends with a link.
2. Add a bill. Enter amounts manually, or upload a receipt and review the extracted items before publishing.
3. Each person enters and confirms their own share, or claims whole items or fractions of an item.
4. Once a bill is complete, check the group's balances and repayment suggestions.
5. Transfer money outside the app, then record the repayment. The recipient confirms receipt to update the balances.

ShareTally does not move money. It currently supports CAD and groups of up to 16 people. Completed bills are final. Repayments affect balances only after the recipient confirms them.

## Screenshots

Captured from the local app using sample data for Alice, Bob, and Carol.

### Group bills and balances

![Group bills, current balance, and repayment suggestions](docs/images/group-desktop.png)

### Mobile

<img src="docs/images/group-mobile.png" alt="Group bills and balances on mobile" width="390">

## Tech stack

- Frontend: React, TypeScript, Vite, and TanStack Query.
- Backend: Node.js, Express, PostgreSQL, and Drizzle ORM.
- Authentication: Clerk with Google sign-in.
- Receipts: Azure Document Intelligence for extraction and an OpenAI-compatible API for clearer item names.
- Deployment: Docker Compose, Nginx, and Drone CI.

## Code structure

```text
client/src/
  app/                AppShell, page composition and stylesheet ordering
  features/           account, bills (including item claims and corrections), groups, home, ledger, receipts, repayments
  shared/             authenticated transport, browser utilities, money and shared UI, including the note photo editor
  theme/              palettes, light/dark preferences and design tokens
server/src/
  bills/              commands, validation, queries and item accounting
  receipts/           drafts, photos, pricing, processing and external providers
  note-photos/        note photo storage, re-encoding and access for drafts and bills
  groups/             membership, invitations and deletion
  ledger/             balances, effects and repayment suggestions
  repayments/         repayment lifecycle
  identity/           users and avatars
  attention/          pending actions
  realtime/           group event streams
  workflows/          transactions that coordinate business modules
  db/                 schema, connection and transaction type
packages/domain/      dependency-free wire contracts and financial calculations
```

The frontend directory is feature-oriented; `AppShell` replaces the old `PlayApp` name. `pnpm lint` runs `client/scripts/check-module-boundaries.mjs`, which fails when shared or theme code imports a feature or the app, when a feature imports the app, or when a feature imports another feature's file other than that feature's declared public entry points. The application layer composes cross-feature screens such as the group workspace (group detail, bill drafts, bills and repayments). `app/styles.css` pins the existing CSS cascade independently of the TypeScript import graph. Existing `.play` CSS selectors remain compatibility names, so changing the folder structure does not change styling or automation selectors.

Both applications link `@share-tally/domain` ([ADR-0016](docs/adr/0016-share-financial-calculations-through-a-domain-package.md)). Their dev, build and test commands compile it using the invoking application's TypeScript compiler; it has no runtime dependencies. After editing that package while a dev server is running, run `node ../scripts/build-domain.mjs` from `client/` or `server/` to refresh its output. Server database types stay internal; compile-time checks in `server/test/wire-contracts.ts` verify that server projections serialize to the shared contracts.

Server routes call workflows for operations spanning business modules. A workflow owns the transaction and passes its transaction to module operations; those operations do not import routes or workflows. Group deletion is the first such workflow: it locks the group before checking eligibility and purging note photos and receipt drafts, then publishes the deletion event after commit.

The group-icon picker's compact emoji metadata is generated; do not edit `client/src/features/groups/icons/emoji-data.json` by hand. After upgrading `emojibase-data`, regenerate it with `pnpm --dir client generate:emoji` and run `pnpm --dir client test:unit`.

### Consolidated implementations

These were the overlapping implementations found in the structure audit. Each row records the selected owner and the differences deliberately retained to preserve behavior.

| Overlap | Shared implementation | Preserved differences |
| --- | --- | --- |
| Receipt calculations in browser previews and server writes | `packages/domain`: exact fractions, draft pricing, frozen correction pricing | Draft edits can reallocate sibling costs; corrections to initiated bills price only the edited item. Server validation and messages remain local. |
| Bill, group, receipt and cached JSON requests | `shared/api/transport.ts` | Feature error messages and conflict metadata, fresh versus cached reads, mutation invalidation and group deletion ordering. Binary photos and SSE retain their protocols. |
| Pending, busy and error handling for submissions | `shared/api/use-operation.ts` | Bill revision checks, item versions, repayment request persistence and draft initialization retries retain their own policies. |
| Amount formatting and entry | `shared/money.ts`, `shared/ui/fields/MoneyField.tsx` and `validity.ts` | Positive-sign display, empty-as-zero, signed adjustments, and validation timing. Share/repayment fields still validate at their original stage. |
| Available portions in item picker, meter and confirmation checks | `features/bills/claims/claim-availability.ts` | Confirmed claims and reservations both consume availability; a participant can edit their own portion. |
| Repeated fraction parsing and picker arithmetic | `shared/fractions.ts`, `shared/ui/portions/` | UI input limits and error wording remain separate from exact domain arithmetic. |
| Receipt scan buttons and photo resource cleanup | `drafts/ScanActions.tsx`, `shared/browser/photo-resource.ts` (also used by note photos) | Processing-specific disabled states, full-photo expiry and line-photo positioning. |
| URLs assembled in several pages | `shared/browser/paths.ts` | Existing hash URLs, query strings, navigation guards and invitation return links. |
| Theme metadata in React and inline HTML | `theme/palettes.ts`, `build/theme-bootstrap.ts` | Storage keys, palette choices, light/dark resolution and synchronous application before paint. |
| Repeated locked-bill access and transaction types | `server/src/bills/access.ts`, `server/src/db/types.ts` | Authorization, lock ordering, atomic financial writes and notifications after commit. |
| Large files mixing responsibilities | Receipt steps/recovery/list, bill commands/queries/inputs, receipt draft access/initiation/processing/photos | Original state lifetimes, focus behavior, persistence and transaction boundaries. |

Dialog focus/scroll locking, participant and portion pickers, receipt viewing, ledger tracing and group synchronization already had shared owners; all callers continue to use them. The legacy item editor and compatibility endpoints are still reachable, so they remain. The benchmark's frozen baseline intentionally remains independent of current production calculations. Unreferenced starter images were removed.

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

Receipt extraction also needs Azure and item-name service settings. Add the receipt variables from the [production environment example](deploy/.env.production.example) to `server/.env`. Keep secret keys on the server. Do not put them in `VITE_*` variables or commit them to Git.

## Checks and tests

```bash
pnpm --dir client lint
pnpm --dir client build
pnpm --dir client test:unit
pnpm --dir server typecheck
pnpm --dir server test
```

Backend tests require Docker and create isolated PostgreSQL test containers. Browser tests require Docker on the machine running Vite, or a test runner sharing that machine's host network. They build a cached browser image matching the installed Playwright version and start a fresh Chromium container for each scenario. The first run downloads the official Playwright image and installs its matching Node package; subsequent runs reuse Docker's build cache. No host Chromium installation is needed:

```bash
cd client
pnpm test:groups
pnpm test:receipts
pnpm test:avatar
```

Each command runs every scenario in its suite, one after another. A scenario creates its own users, group and records in a fresh environment (PostgreSQL with migrations, the test API, Vite with the test-only Clerk substitute, and Chromium) and disposes it afterwards, so a failure does not stop the scenarios after it. To run one or more scenarios by name, or to list them:

```bash
pnpm test:browser draft-save-and-recovery
pnpm test:receipts scan-fallback processing-recovery
pnpm test:browser --list
```

A failing scenario is reported by name; screenshots of its open pages are kept in `client/test-results/failures/<scenario>/`. `pnpm test:environment` checks partial-startup cleanup, browser connection failures, normal disposal and browser/`route.fetch` origin behavior. `pnpm test:network-isolation` creates and removes unrelated Docker bridges while a controlled graph of JavaScript modules is loading and fails if any browser resources report `ERR_NETWORK_CHANGED`. Scenarios live in `client/test/browser/`, grouped by business area; `environment.mjs` is the shared environment and `suites.mjs` lists every scenario.

The browser container uses its own network namespace. Its loopback relay forwards the application's port to Vite through Docker's `host-gateway`, preserving localhost secure contexts, `receipt.test` plain-HTTP contexts and intercepted upstream requests. Vite listens on all interfaces while a scenario runs, so run these test-only identities and services on a trusted development machine. An unrelated remote Docker daemon cannot reach Vite using this setup. Host executable overrides such as `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` no longer apply.

Run the browser suites sequentially because they share Vite's dependency cache. Other jobs may create and remove Docker bridges without interrupting Chromium. A remaining `ERR_NETWORK_CHANGED` is still reported as a failure, with no automatic retry. If the browser cannot reach Vite, check Docker's host-gateway access and local firewall rules. Avoid deleting `~/.cache/ms-playwright` without checking other projects: it is shared, even though these tests no longer need its browsers.

`server/test/domain.test.ts` covers exact arithmetic and pricing edge cases; existing API and browser suites exercise financial, authorization, concurrency and interaction behavior.

## PR automation

[PR size](.github/workflows/pr-size.yml) uses the maintained
[CodelyTV PR Size Labeler](https://github.com/CodelyTV/pr-size-labeler) to label
each PR when it opens, reopens or receives new commits. It counts additions plus
deletions across all files, including lockfiles and generated files. The upstream
cutoffs are exclusive:

| Changed lines | Label |
| --- | --- |
| 0–9 | `size/xs` |
| 10–99 | `size/s` |
| 100–499 | `size/m` |
| 500–999 | `size/l` |
| 1,000 or more | `size/xl` |

The action replaces stale size labels while keeping unrelated labels. An XL PR
does not fail the workflow or receive an automatic warning comment. The workflow
reads GitHub API metadata without checking out PR code and needs only the
workflow's built-in token.

When a PR is added to the [project](https://github.com/users/SimianW/projects/4),
its label appears in the project's Labels field. Labels on a linked PR are not
copied to its issue. The project's Size dropdown remains an implementation
estimate for issues; PR-Agent's review effort remains a separate estimate of
review difficulty. This workflow does not write project fields or wait for a
project-addition event. It becomes active after merging into the default branch.

## Project docs

- [Project background and development guidelines](docs/project-brief.md)
- [Domain terminology](CONTEXT.md)
- [Architecture and business decisions](docs/adr/)
- [Product requirements](https://github.com/SimianW/share-tally/issues/1)
- [Receipt extraction and item claiming requirements](https://github.com/SimianW/share-tally/issues/26)

The live app is at **https://sharetally.app**. See the [Drone configuration](.drone.yml) and [Docker Compose configuration](deploy/compose.yml) for the deployment setup.
