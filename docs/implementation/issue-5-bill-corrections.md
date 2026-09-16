# Bill corrections

Issue #5 uses UI prototype A, selected by the owner: retain the two-column bill overview and put initiator edits, reopening, and cancellation in dialogs. The original comparison is preserved on `prototype/issue-5-bill-corrections` at `06c3cc6d7b320140db9b71652330218e31a0bc2b`.

Every mutation locks its bill row inside a PostgreSQL transaction, then checks membership, actor permissions, and the submitted revision. Reopening, any initiator edit, cancellation, and changes to existing share amounts increment the revision. An edit clears all confirmations and removes completion and adjustment values. Retained amounts alone cannot complete a bill.

Share requests include `revision` and `expectedAmountCents` as read by that participant. First submissions and unchanged confirmations preserve other confirmations and the bill revision, allowing participants to submit concurrently. The expected amount prevents two competing first submissions from overwriting each other. An existing amount change clears everyone's confirmation, including the sender's; the sender then confirms the saved amount in a separate action.

A repeated unchanged confirmation succeeds without changing its timestamp. Repeated mutations with an old revision return 409 and do not apply again, including after a lost response. The UI preserves uncertain requests for retry and requires the user to load and review the latest bill after a conflict; it never silently confirms a newer revision. Authentication and group membership checks still apply to retries.

Cancellation is available only to the initiator on an incomplete bill. Canceled bills remain visible and cannot be changed or included in financial totals. Removing a participant deletes only that bill's share row. Re-adding that person starts with a missing share. The initiator must remain selected.

Migration `0006_quiet_killraven.sql` adds the revision and cancellation fields and permits retained amounts with no confirmation. Apply it before serving the updated API and client together. Older clients without revision fields receive a validation error and must reload. Active-settlement and settled-history restrictions remain in issues #6 and #7.

Validation uses the Express API with isolated PostgreSQL containers and the existing browser smoke test with controlled Clerk identities. It does not validate Google OAuth or production session configuration.
