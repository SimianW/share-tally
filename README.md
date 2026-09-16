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
pnpm --dir server typecheck
pnpm --dir server test
```

Backend tests require Docker and create isolated PostgreSQL test containers. Browser tests also require Docker. Install Chromium before running them:

```bash
cd client
pnpm exec playwright install chromium
pnpm test:groups
pnpm test:receipts
```

## Project docs

- [Project background and development guidelines](docs/project-brief.md)
- [Domain terminology](CONTEXT.md)
- [Architecture and business decisions](docs/adr/)
- [Product requirements](https://github.com/SimianW/share-tally/issues/1)
- [Receipt extraction and item claiming requirements](https://github.com/SimianW/share-tally/issues/26)

The live app is at **https://sharetally.app**. See the [Drone configuration](.drone.yml) and [Docker Compose configuration](deploy/compose.yml) for the deployment setup.
