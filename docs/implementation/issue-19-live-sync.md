# Issue 19: live synchronization

The owner authorized independent #19 work before #7 on 2026-09-15. This changed development order only; merge and acceptance remain #7 → #19 → #8. The branch began at `5b11e78`. After #7 merged, the owner requested continuing on latest main; merge commit `072148e` incorporates `a1e8e53` and its repayment accounting.

## Notification and snapshot contract

`GET /api/groups/:groupId/events` authenticates the bearer token and checks membership before streaming. `ready` establishes the subscription before the authoritative snapshot read. `changed` carries no financial data. Notifications invalidate the whole group rather than applying deltas.

Bill creation, editing, cancellation, share submission/completion, repayment recording/decisions and group joins call `notifyGroupChanged(groupId)` after their database transaction resolves. The group comes from the authorized mutation result. A failed transaction does not notify; idempotent retries may notify again. Notification happens before response enrichment, so a later response failure does not conceal a successful commit from subscribers.

`GET /api/groups/:groupId/bills` retains #7's `{ bills, repayments, summary, ledger }` contract. Its repeatable-read transaction computes summary, member balances and suggestions from the same bills and confirmed repayment records. Synchronization never calculates financial state. Group member metadata is read separately.

The transport assumes one API process, matching the repository's Compose deployment. Multiple API processes would require shared notification delivery before using this implementation across them.

## Connections and recovery

- Heartbeats every 10 seconds; lack of traffic times out after 25 seconds. Slow readers disconnect instead of buffering history. Closing the response releases its subscription and timers.
- Streams close at verified Clerk JWT expiry or after 30 seconds, whichever comes first. Reconnection repeats authentication and membership checks. This bounds existing-stream authorization and requires deployment validation with real Clerk credentials.
- Authenticated browser fetch streaming sends tokens in headers. The client reads after `ready`, serializes reads and records invalidations during reads. An invalidated response is discarded and read again. Financial snapshots are applied as a whole.
- Connection loss and failed reads retain the last displayed data and selected-group summary, with a stale notice until a successful snapshot. Reads time out after 15 seconds. Retry backoff is bounded at 1–15 seconds; manual retry, visibility, focus and online events reconnect and fetch the latest snapshot.
- Navigation/unmount aborts streams and pending reads. Bill detail first looks up the bill's group, then subscribes and obtains its displayed snapshot. The preliminary lookup is not displayed as synchronized data.
- Nginx buffering is disabled and its read timeout exceeds the heartbeat interval. Public proxy and FRP delivery remain deployment checks.

## Editing and presentation

Bill detail receives live status and confirmation progress. Form state does not use the server revision as a React key. A conflicting revision or changed personal share pauses submission and shows the latest bill for review while retaining unsent input. Ordinary confirmation progress does not interrupt typing. Completed/canceled bills disable submission while retaining open drafts. Removing a participant retains that user's open share draft and prevents submission. Server version checks remain the final authority.

Successful local mutations trigger another authoritative read before resetting editors. Their response payload is not applied over a potentially newer streamed snapshot. Repayment review uses the latest record state, including a decision committed despite a lost HTTP response.

First-render balances display their actual amounts. Later changes use a 400 ms display-only number transition; newer values replace an active target. Direction labels and signs use the latest server value immediately. Financial calculations and actions never use intermediate animation values. Changed suggestion rows are replaced and briefly highlighted. Reduced motion disables both transitions and highlights.

## Validation

API tests use Express with isolated PostgreSQL. SSE scenarios cover authentication, group isolation, committed bill delivery, forced bill and repayment rollbacks, duplicate notifications without duplicate accounting, heartbeats, bounded stream lifetime, reconnects and repayment-aware snapshots.

The multi-user browser workflow uses the real application/API/database with controlled identities. It covers remote creation/completion, a held obsolete snapshot across a committed change, retained data on read failure and recovery, live repayment confirmation updating the other user's history/balances/suggestions/sidebar, conflicting draft preservation, non-disruptive confirmations, terminal edit protection, first-render balances, reverse balances and reduced motion.

Validation on the integrated branch: all 63 backend tests passed, as did server typecheck, client production build and ESLint. The expanded multi-user browser smoke passed. Its local remote-completion observation was 110 ms from the submit click, including request time; this is not a public-route latency measurement.

The held-snapshot browser test now waits for the first real balance before inducing a reconnect. Its earlier zero-row assertion also matched the loading screen, making the test setup race with initial subscription.

## Remaining release checks

- Validate real Clerk expiration/revocation/sign-out through the deployed public route, including FRP, and record production delivery latency. Local controlled identities do not prove those behaviors.
- Expand automated recovery coverage for server restart, navigation cleanup and repeated updates during animation. Existing implementation paths support them, but do not claim dedicated browser coverage without running those cases.
- Merge #19 only after its remaining acceptance checks; do not close it based on local tests alone. No production deployment or remote issue closure was performed in this work.
