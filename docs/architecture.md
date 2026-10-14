# Architecture

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
  groups/             membership, ownership, invitations and deletion
  ledger/             balances, effects and repayment suggestions
  repayments/         repayment lifecycle
  identity/           users and avatars
  attention/          pending actions
  realtime/           group event streams
  workflows/          transactions that coordinate business modules
  db/                 schema, connection and transaction type
packages/domain/      dependency-free wire contracts and financial calculations
```

The frontend directory is feature-oriented. Imports point from `app` to `features` to `shared`; compose screens that combine features in `client/src/app`. [`pnpm lint`](../client/package.json) runs [`client/scripts/check-module-boundaries.mjs`](../client/scripts/check-module-boundaries.mjs), which fails when shared or theme code imports a feature or the app, when a feature imports the app, or when a feature imports another feature's file other than that feature's declared public entry points. The application layer composes cross-feature screens such as the group workspace (group detail, bill drafts, bills and repayments). `app/styles.css` pins the existing CSS cascade independently of the TypeScript import graph. Existing `.play` CSS selectors remain compatibility names, so changing the folder structure does not change styling or automation selectors.

Both applications link `@share-tally/domain` ([ADR-0016](adr/0016-share-financial-calculations-through-a-domain-package.md)). See the [client](../client/package.json) and [server](../server/package.json) scripts for its build integration; it has no runtime dependencies. After editing that package while a dev server is running, run `node ../scripts/build-domain.mjs` from `client/` or `server/` to refresh its output. Server database types stay internal; compile-time checks in `server/test/wire-contracts.ts` verify that server projections serialize to the shared contracts.

Server routes call workflows for operations spanning business modules. A workflow owns the transaction and passes its transaction to module operations; those operations do not import routes or workflows. Group deletion is the first such workflow: it locks the group before checking eligibility and purging note photos and receipt drafts, then publishes the deletion event after commit. Member departure follows the same pattern: it locks the group, checks the departing member's ledger balance, bills and repayments, transfers ownership if the owner is leaving, purges that member's drafts and ends the membership, then notifies after commit.

The group-icon picker's compact emoji metadata is generated; do not edit `client/src/features/groups/icons/emoji-data.json` by hand. After upgrading `emojibase-data`, regenerate it and run the client unit tests using the [client scripts](../client/package.json).

### Consolidated implementations

Each row records the shared owner and the differences deliberately retained to preserve behavior.

| Overlap | Shared implementation | Preserved differences |
| --- | --- | --- |
| Receipt calculations in browser previews and server writes | `packages/domain`: exact fractions, draft pricing, frozen correction pricing | Draft edits can reallocate sibling costs; corrections to initiated bills price only the edited item. Server validation and messages remain local. |
| Bill, group, receipt and cached JSON requests | `shared/api/transport.ts` | Feature error messages and conflict metadata, fresh versus cached reads, mutation invalidation and group deletion ordering. Note photo bytes use its `blob` read; receipt photos and SSE retain their protocols. |
| Pending, busy and error handling for submissions | `shared/api/use-operation.ts` | Bill revision checks, item versions, repayment request persistence and draft initialization retries retain their own policies. |
| Amount formatting and entry | `shared/money.ts`, `shared/ui/fields/MoneyField.tsx` and `validity.ts` | Positive-sign display, empty-as-zero, signed adjustments, and validation timing. Share/repayment fields still validate at their original stage. |
| Available portions in item picker, meter and confirmation checks | `features/bills/claims/claim-availability.ts` | Confirmed claims and reservations both consume availability; a participant can edit their own portion. |
| Repeated fraction parsing and picker arithmetic | `shared/fractions.ts`, `shared/ui/portions/` | UI input limits and error wording remain separate from exact domain arithmetic. |
| Receipt scan buttons and photo resource cleanup | `drafts/ScanActions.tsx`, `shared/browser/photo-resource.ts` (also used by note photos) | Processing-specific disabled states, full-photo expiry and line-photo positioning. |
| URLs assembled in several pages | `shared/browser/paths.ts` | Existing hash URLs, query strings, navigation guards and invitation return links. |
| Theme metadata in React and inline HTML | `theme/palettes.ts`, `build/theme-bootstrap.ts` | Storage keys, palette choices, light/dark resolution and synchronous application before paint. |
| Repeated locked-bill access and transaction types | `server/src/bills/access.ts`, `server/src/db/types.ts` | Authorization, lock ordering, atomic financial writes and notifications after commit. |
| Large files mixing responsibilities | Receipt steps/recovery/list, bill commands/queries/inputs, receipt draft access/initiation/processing/photos | Original state lifetimes, focus behavior, persistence and transaction boundaries. |

Dialog focus/scroll locking, participant and portion pickers, receipt viewing, ledger tracing and group synchronization already had shared owners; all callers continue to use them. The legacy item editor and compatibility endpoints are still reachable, so they remain. The benchmark's frozen baseline intentionally remains independent of current production calculations.
