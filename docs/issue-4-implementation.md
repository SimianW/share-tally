# Bill implementation

Historical implementation note: the code behavior described below predates ADR-0005 and ADR-0006. Revised #5 removes completed-bill reopening; #7 adds confirmed repayment offsets. No settled-bill exclusion or batch settlement is to be implemented.

Issue #4 follows the owner-approved [design](issue-4-design.md) and [small-difference decision](adr/0004-small-bill-differences-belong-to-initiator.md). The website uses English and the selected A layout.

## Data and transactions

`bills` records the initiator, group, purchase date, title, notes, integer-cent total, completion time, and separate initiator adjustment. `bill_shares` records selected participants. A null amount and confirmation mean no submission; zero with a confirmation is an explicit response.

Creation locks the group row, checks membership and selected participants, and inserts the bill and all shares in one transaction. The initiator's share is confirmed at creation. A unique initiator/request-ID constraint prevents duplicate creation, including requests made concurrently in different groups.

First submissions lock the bill row before reading or updating shares. The same transaction checks every confirmation and computes completion. All shares remain unchanged when completion assigns the difference to the initiator. Aggregate arithmetic uses BigInt internally and rejects values outside JavaScript's safe integer range before returning JSON numbers. Reads use a repeatable-read snapshot so completion and participant amounts agree.

Database constraints cover amount bounds, unique participants, confirmation nullability, descriptive lengths, and completion/adjustment consistency. Membership, individual shares not exceeding their bill total, and completion across rows are enforced by the transactional service.

## HTTP contract

All endpoints require the existing Clerk authentication boundary. Record reads authorize through group membership. No request accepts an acting user ID.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/groups/:groupId/bills` | Group bills, shares, and current member's financial summary |
| `POST /api/groups/:groupId/bills` | Create a bill and confirm the initiator's share |
| `GET /api/bills/:billId` | Read a bill and all participant shares |
| `POST /api/bills/:billId/share` | Submit the authenticated participant's first share |
| `GET /api/summary` | Personal receivables, payables, and net across groups |

Creation accepts `requestId`, `title`, `purchaseDate`, `timeZone`, `notes`, `totalCents`, `ownShareCents`, and `participantIds`. The device sends its IANA time zone; the server computes today's date in that zone and validates the calendar date. Monetary inputs are integer cents. The UI parses decimal strings without floating-point rounding.

A creation retry must reuse its UUID and normalized payload. Matching retries return the same bill; differing details return 409. The browser retains uncertain creation requests in session storage, scoped to the application user and group, including across reloads. A known validation/access rejection unlocks the form for correction. Network/server failures retain the request for retry. Closing and reopening an uncertain form restores the original details. Session storage failure stops the request before sending it.

Share submissions accept only `amountCents`. Repeating the same confirmed amount returns the current bill without changing timestamps or amounts. A different amount returns 409. The UI retains the submitted amount after uncertain responses; after reload, reading the bill reveals any committed confirmation.

## Financial summaries

Only complete bills contribute. For the initiator, the receivable is total minus their submitted share minus the adjustment. Other participants owe their submitted share. Group nonparticipants contribute zero. The overview sums receivables and payables across groups and shows their difference, without authorizing cross-group settlement.

Settlement and cancellation do not exist yet. Their implementation must update summary eligibility when adding those states. Editing, reopening, and reconfirmation remain in issue #5.

## Validation

Run the commands from the repository root. The server uses pnpm 12.3.4; older pnpm versions cannot parse its lockfile.

```sh
npx --yes pnpm@12.3.4 --dir server typecheck
npx --yes pnpm@12.3.4 --dir server db:check
npx --yes pnpm@12.3.4 --dir server test
pnpm --dir client build
pnpm --dir client lint
pnpm --dir client test:groups
```

`db:check` requires `DATABASE_URL` to load the existing configuration but does not connect. The API and browser tests create isolated PostgreSQL containers and apply committed migrations. Tests cover tolerance boundaries, explicit zero, missing confirmations, negative effective cost, immutable submissions, concurrent requests, retry conflicts, rollback, membership permissions, date/money/text validation, persistence, and summary consistency. The browser smoke includes response-loss recovery and mobile layout. Its controlled Clerk boundary does not verify Google OAuth or seven-day sessions.
