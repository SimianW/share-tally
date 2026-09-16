# Issue 19: work before issue 7

The owner authorized starting independent #19 work before #7 on 2026-09-15.
This changes the development order only. Merge and acceptance remain #7 → #19 → #8.
Branch `feat/issue-19-live-sync` starts from `origin/main` at `5b11e78`.
Do not close #19 or describe this stage as its completed implementation.

## Implemented in this stage

- Authenticated `GET /api/groups/:groupId/events` checks membership before streaming.
- `ready` establishes the subscription before the first snapshot read. `changed` carries no financial values.
- Bill creation, edits, cancellation, share submission/completion, and group joins notify after their transaction resolves. Failed transactions do not notify. Idempotent retries may notify again.
- Heartbeats every 10 seconds. Slow readers disconnect rather than accumulating event history. Response closure releases timers and subscriptions.
- Streams close at the verified Clerk JWT expiry or after 30 seconds, whichever comes first. Each new connection goes through authentication and membership checks again. This bounds revocation exposure but still needs real Clerk deployment validation.
- The group page uses authenticated fetch streaming, serial snapshot reads, and a pending invalidation flag. An invalidation during a read discards that result and reads again. Navigation aborts old connections and reads.
- Disconnection and failed reads retain the last displayed snapshot and selected-group summary. A stale-data notice remains until a new snapshot succeeds. Recovery uses 1–15 second backoff, manual retry, visibility and online events. Reads time out after 15 seconds; absent stream traffic times out after 25 seconds.
- The existing group snapshot endpoint still supplies bills, summary, balances, and suggestions together. Nginx buffering is disabled and its read timeout exceeds the heartbeat interval.

## Integration contract for issue 7

The proposed call site is immediately after the repayment decision transaction successfully resolves:

```ts
const groupId = await db.transaction(async tx => {
  // Authorize and decide the repayment, returning its stored group ID.
  return repayment.groupId;
});
notifyGroupChanged(groupId);
```

Import `notifyGroupChanged` from `server/src/group-events.ts`. Use the group stored on the authorized repayment, never a client-supplied notification destination. Do not call inside the transaction, before commit, or only after response enrichment that could fail after a successful commit. Duplicate notifications are harmless. The current transport assumes one API process, as in the Compose deployment.

Keep `GET /api/groups/:groupId/bills` as the complete financial snapshot contract: `{ bills, summary, ledger }`. Its current repeatable-read transaction must include confirmed repayment effects when #7 integrates them. Compute summary, member balances and suggestions from the same ledger snapshot. The synchronization module treats this response as opaque; it does not calculate or patch balances. Group member metadata is fetched separately and is not part of the financial snapshot.

This document records the proposed interface for the other branch; it does not claim its implementation has already adopted it.

## Remaining before issue 19 acceptance

- Connect bill detail to the group stream, preserve unsent drafts, pause conflicting revisions, and retain drafts when bills become final. Bill detail still uses its existing manual read/review behavior in this stage.
- Add balance rolling transitions, suggestion-row highlights, sign handling and reduced-motion behavior.
- After #7 merges, merge latest main here, add committed repayment notifications and verify repayment-aware snapshot/summary reads.
- Extend the two-user browser workflow for repayment confirmation, draft protection and animation. Add further initial-subscription race, navigation cleanup, server restart and authentication recovery checks.
- Validate real Clerk expiry/sign-out and streaming latency through the public proxy and FRP route. Repository Nginx configuration alone does not prove deployed delivery.

No production deployment or issue closure is part of this stage.

## Validation on this branch

- Server typecheck and all 53 API tests passed against isolated PostgreSQL.
- API coverage includes stream authorization, group isolation, forced transaction rollback, committed creation/completion, duplicate invalidations, heartbeat delivery and forced reconnect after stream expiry.
- The real multi-user browser smoke passed, including remote bill creation/completion, an obsolete snapshot held across a committed change, retained data during a 503 read failure, automatic recovery and membership updates.
- A local browser run observed the remote completed bill and updated suggestions within 106 ms of clicking submit. This includes request time and is not a production latency measurement.
- Client production build, ESLint and `git diff --check` passed.
- The first browser attempt encountered `ERR_NETWORK_CHANGED` before rendering while container suites were starting. Running the browser suite separately passed.
