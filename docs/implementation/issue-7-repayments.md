# Issue #7: actual repayments

Implementation baseline: `5b11e78`, the updated main requested by the owner. This includes initiator correction confirmation and automatic group refresh. The owner directed implementation after discussing the repayment, retry, concurrency, and amount rules. Requirements: GitHub issues #1 and #7, with ADR-0005 defining continuous accounting.

The preliminary estimate was 6–9 hours for implementation and validation, not recorded effort. The project's 30-hour maximum remains unchanged.

## Records and endpoints

Migration 0007 adds `repayments`: UUID ID, group, sender, recipient, request UUID, integer-cent amount, status, creation time, and decision time. CAD is the only currency. Amounts are 1–1,000,000 cents, preserving the existing CAD 10,000.00 per-input limit. Database checks enforce distinct sender/recipient, amount bounds, and pending versus terminal timestamps. Application checks require both people to belong to the same group. Group member removal is not supported.

- `POST /api/groups/:groupId/repayments` accepts `{ requestId, recipientId, amountCents }`. Sender identity comes exclusively from authentication. Success, including replay, returns HTTP 201 and `{ repayment }`.
- `POST /api/repayments/:repaymentId/decision` accepts `{ decision: "confirmed" | "rejected" }`. Only the recipient can decide. Success returns HTTP 200 and `{ repayment }`.
- Existing `GET /api/groups/:groupId/bills` also returns repayment history, newest first, alongside bills, balances, suggestions, and personal summary. Every group member can read it; outsiders cannot.
- Existing `GET /api/summary` includes confirmed repayment effects across the caller's groups.

No edit, delete, undo, automatic confirmation, or actual money transfer endpoint is added. The record preserves the actual amount independently of suggestions. A missing or inaccessible group/record returns 404, a visible record's unauthorized decision returns 403, invalid input returns 400, and an incompatible retry or terminal decision returns 409.

## Transactions and retries

Creation checks membership and inserts in one read-committed transaction. A unique constraint on sender plus request UUID arbitrates concurrent retries, including requests for different groups. `INSERT ... ON CONFLICT DO NOTHING` waits for competing inserts; a subsequent statement reads the committed winner. Matching group, recipient, and amount return the existing record, including its current status. Different details return 409. Keys remain with their records without expiry.

The browser stores the exact creation request in session storage before sending. An uncertain result locks its fields and preserves the same UUID through close/reopen and reload in that tab. Retry sends the same request. Successful responses clear it; known pre-write validation/access failures allow correction. A second intentional transfer uses a new UUID, even when its amount and recipient match a previous transfer.

A decision locks only its repayment row in one read-committed transaction, checks membership and recipient identity, then moves pending to one terminal state. Repeating the same decision returns success without changing the decision timestamp. A conflicting terminal decision returns 409. The UI refreshes on conflict and disables decisions once it sees a terminal status. An unchanged recorded amount needs no bill revision or suggestion version: new bills or changed suggestions cannot invalidate money already transferred.

No balance field is updated by a mutation. The ledger reads complete non-canceled bills and confirmed repayment records in a single repeatable-read, read-only transaction. Each confirmed record adds its amount to the sender and subtracts it from the recipient. BigInt cents are used for accumulation, with existing safe-integer response checks. Concurrent bill completion and repayment confirmation appear wholly before or after each snapshot, avoiding lost updates and duplicate application. The exact minimum-transfer solver is unchanged.

## Summaries and UI

Personal summaries first compute each group's current net balance. Receivable is the sum of positive group balances; payable is the magnitude of negative group balances. Overview's net is informational and does not authorize transfers across groups. This replaces the former gross per-bill receivable/payable breakdown, which could continue showing paid obligations or mishandle overpayments. Groups containing repayments but no bills still contribute.

The group page includes an independent record-repayment button, a same-group recipient picker, amount input, and retained pending/confirmed/rejected history. Recipient review shows both people and the actual amount before confirmation or rejection. The sender cannot decide their own record. Local successful mutations refresh the group, its selected sidebar summary, and suggestions. Overview fetches current data when visited.

The updated main's 15-second visible-page polling and focus/online/visibility refresh are preserved. SSE remains issue #19. The central attention list remains issue #8. There are no settlement batches, group freezes, or settled-bill filters; new bills, incomplete corrections, and joins remain available while repayments are pending and after zero balances.

## Validation

Business tests exercise Express with an isolated real PostgreSQL database and controlled test identities. Repayment scenarios cover permission and amount checks, isolation, partial repayment, rejection, overpayments, non-suggested transfers, durable retries, conflicting decisions, changed suggestions, concurrent completion/confirmation, joins and corrections during pending repayments, zero balances with retained bills, and cross-group summaries including groups without bills.

Browser smoke extends the existing real UI/API/database workflow with repayment creation and decision response loss, reload/retry, confirmation, rejection, retained old bills, continued new bills, and mobile layout. The existing final capacity check now triggers focus refresh instead of the manual refresh control removed by the updated main.

Final check results and review findings will be recorded after completion. Controlled identities do not validate production Google sign-in or session lifetime. No production deployment or database migration is performed as part of this local implementation.
