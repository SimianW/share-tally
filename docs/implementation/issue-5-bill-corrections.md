# Bill corrections and finality

Issue #5 retains the owner-selected two-column layout and dialogs for initiator edits and cancellation. Completed bills are final under ADR-0006. The reopen endpoint and client workflow have been removed; requests to the old endpoint return 404.

Every mutation locks its bill row inside a PostgreSQL transaction, then checks membership, actor permissions, and the submitted revision. Initiator edits, cancellation, and changes to existing share amounts increment the revision. Only incomplete bills can change. This same lock serializes completion against edits and cancellation: whichever request wins determines whether the other encounters finality or a stale revision.

Any initiator edit, including a descriptive edit, clears all confirmations. Retained participants keep their amounts. Changing an existing share clears confirmations. Under the owner's revised initiator rule, saving the initiator's own changed amount also confirms that share in the same transaction; only other participants must reconfirm. A non-initiator still confirms their saved changed amount separately. This supersedes ADR-0001's blanket confirmation reset for initiator share changes only. Editing bill details or participants still clears every confirmation. First submissions and unchanged confirmations preserve other confirmations and the bill revision.

Share requests include `revision` and `expectedAmountCents` as read by that participant. The expected amount prevents competing first submissions from overwriting each other. An identical confirmed-share retry succeeds without changing timestamps, amounts, or completion, including after the original submission completed the bill. Other completed-bill mutations return 409. Authorization still applies to retries.

Repeated mutations with an old revision return 409 without applying again. The UI preserves uncertain requests for retry and requires the user to load and review the latest bill after a conflict. It never silently confirms a newer revision.

Cancellation is available only to the initiator on an incomplete bill. Canceled bills remain visible and excluded from financial totals. Removing a participant deletes only that bill's share row, preserving group membership. Re-adding that person starts with a missing share. The initiator must remain selected. Completed bills remain included in accounting; repayment offsets belong to #7.

Migration `0006_quiet_killraven.sql` adds the revision and cancellation fields and permits retained amounts without confirmation. Apply it before serving the updated API and client together. No further migration is needed for finality. Older clients without revision fields receive a validation error and must reload. No group freeze or settled-bill lifecycle is introduced.

Validation uses the Express API with isolated PostgreSQL containers and the existing browser smoke test with controlled Clerk identities. It covers incomplete-bill correction, reconfirmation, automatic completion, rejected completed-bill changes, concurrent requests, participant removal, and cancellation. It does not validate Google OAuth or production session configuration.
