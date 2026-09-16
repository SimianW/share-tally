# Issue 8: attention list and release trial

## Implementation

Overview shows the signed-in member's missing shares, unconfirmed existing shares on incomplete bills, and incoming pending repayment records. It does not list repayment suggestions as tasks. A confirmed share waiting for other participants is not a personal action, even if the bill remains incomplete because its amounts do not add up.

`GET /api/attention` returns `{ actions }`. Bill actions contain `kind`, `billId`, `groupId`, `groupName`, `title`, and nullable `amountCents`. Their kinds are `missing-share` and `confirm-share`. Repayment actions use `review-repayment`, `repaymentId`, `groupId`, `groupName`, `senderName`, and `amountCents`. Shares appear first, then incoming transfers; each section orders oldest first, with ID as a tie-breaker.

The endpoint derives actions from existing records and current membership in a read-only repeatable-read transaction. There is no task table, financial calculation, or schema migration. Removed participants, canceled/completed bills, and decided repayments disappear on the next read. Authentication is verified by the existing middleware; every query filters both the current member's role and group membership.

Bill links open the existing detail page. Incoming transfers open the group's existing receipt review dialog via `#/group-bills/:groupId?repayment=:repaymentId`. A decided record shows its current status without decision buttons. Only the recipient can open a record through this link; API permissions remain authoritative.

The list reloads when entering Overview, refreshing actions, returning focus/visibility, or coming back online. In-flight reads abort when superseded or unmounted. Failed reads show an error and retry control rather than an empty-success state. Account changes remount the application using the existing user key. Active group and bill views retain #19's SSE synchronization; this issue does not add an all-groups event stream.

## Scope and effort

Before implementation, the estimate was 3–5 hours for code/tests, 1–3 hours for regression and deployment verification, plus a 30–60 minute real trial. Actual remaining release effort depends on production access and findings. This estimate is not evidence of time remaining in the project's 30-hour cap; cumulative owner time has not been supplied.

## Automated verification

Tests use the existing Express boundary with isolated PostgreSQL and browser smoke with controlled test-only identities. They cannot prove actual Google login, seven-day sessions, public proxy delivery, or a real external transfer.

The added API scenarios cover missing versus explicit zero, confirmation invalidation, removed participants, nonparticipants, canceled/completed bills, cross-group incoming transfers, sender/recipient isolation, and both repayment decisions. Browser additions cover mobile attention links, reconfirmations, failure/retry, direct receipt review, completed-record links, and sign-out/account isolation.

Validation on 2026-09-16:

- Server typecheck passed; full backend suite passed all 66 tests, including the three added attention scenarios.
- Client production build and ESLint passed.
- Expanded multi-user group/bill/repayment/attention browser smoke passed; avatar smoke passed. Mobile screenshot checked at 390px with no horizontal overflow.
- The first browser run encountered `ERR_NETWORK_CHANGED` while the concurrent backend suite created/destroyed Docker networks and stopped at an existing group-dialog check. Running the browser suite alone passed. Deliberate response-loss, conflict, and 503 scenarios still log their expected errors.
- Read-only checks of owner-supplied `https://sharetally.app` returned homepage HTTP 200 with successful TLS verification, `/api/health` HTTP 200 with `{ "status": "ok" }`, and unauthenticated `/api/attention` HTTP 401. This checks the currently deployed service, not deployment of this PR's endpoint; API authentication runs before route matching.

## Production verification still required

The code can be reviewed and merged independently of the real trial. Keep #8 open until the production checks and trial have evidence.

| Check | Evidence currently available | Release evidence to record |
| --- | --- | --- |
| Public domain, HTTPS, FRP route | `https://sharetally.app` homepage and health passed on 2026-09-16; Compose binds web to host `127.0.0.1:11119`; Nginx proxies `/api` to API | Route/termination owner and deployed commit; authenticated public workflow |
| Google login and return | Clerk integration; test identities pass through a separate test entry point | Actual Google sign-in through public URL, invitation return, correct callback in provider settings |
| Seven-day maximum session | Accepted requirement in #1/#2 | Clerk maximum lifetime and refresh/inactivity settings, same-browser return, expiry/sign-out/revocation behavior; date each observation |
| Restart persistence | Automated API persistence scenario; external production database network in Compose | Record IDs/amounts before and after a scheduled API restart, confirming the deployed database retains them |
| Backup and restore | Basic procedure below; no recorded production restore result found | Backup date/storage/owner, successful isolated restore, schema and representative record checks |
| Live public updates | Local multi-user SSE smoke; Nginx buffering disabled | Completion and repayment updates on another device, observed latency, disconnect/reconnect behavior through FRP |

Do not treat closed dependency issues as proof that these checks passed. No production restart, deployment, credential change, or database restore was performed for this PR.

## Basic backup and restore procedure

Use PostgreSQL client tools compatible with the deployed database version. The deployment owner must identify the actual database and backup destination. Configure two local libpq service entries with protected credentials: `share_tally_production` for the live database and `share_tally_restore_check` for a newly created, empty, isolated database. The restore service must never point at production. Do not commit either service file or its credentials.

On the authorized backup host, create a protected custom-format dump:

```sh
umask 077
backup_file="/secure/backups/share-tally-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname='service=share_tally_production' --format=custom --exclude-table-data=public.receipt_photos --no-owner --no-acl --file="$backup_file"
pg_restore --list "$backup_file"
```

Receipt photos are excluded from backups so expired image bytes cannot survive in archived dumps. A restore preserves bills, OCR text, reviewed items and claims, but photos are unavailable. Do not use physical database snapshots or WAL archives containing receipt photos beyond their expiry. The production backup job must use this exclusion before enabling receipt uploads.

Copy the dump to the owner's protected storage outside the database host. Agree the schedule, retention, and responsible person before real purchase data is entered. `pg_restore --list` alone is not a restore test.

Restore into the empty isolated database, using its service entry:

```sh
pg_restore --dbname='service=share_tally_restore_check' --no-owner --no-acl --exit-on-error --single-transaction "$backup_file"
```

Compare migration history and representative group, bill/share, and repayment records with the backup's expected state. Run a separate application instance against the restored database and inspect balances and membership access. Record the backup filename, restore database identity, date, results, and any errors without recording secrets. Delete only the disposable verification instance/database when finished. An actual production recovery needs a separate maintenance plan and authorization.

## Real friend-group trial

Participants: owner plus at least two friends, using their own Google accounts. Record the deployed commit, date, devices, and group/bill identifiers. Use a real shared purchase; deliberate invalid amounts and overpayments belong in automated tests.

1. Join the group through the public invitation. The initiator creates a bill with all three participants and confirms their own share.
2. Each remaining participant opens Overview, follows their missing-share action, and submits their agreed amount. Keep one confirmation outstanding for the correction exercise.
3. Before completion, the initiator corrects the bill. Participants refresh Overview, follow reconfirmation actions, and confirm the final agreed amounts. Verify completion and absence of obsolete actions. Another member observes completion without manual refresh.
4. Inspect each member's balances and repayment suggestions. Verify the completed bill has no edit, cancel, or reopen action.
5. A sender makes an actual external transfer and records its actual amount. The recipient finds the incoming transfer in Overview and verifies sender and amount before confirming. Another member observes updated balances without manual refresh.
6. While a repayment is still pending, create another bill. After repayment, demonstrate that new bill activity is still available. Pending transfers must not change balances.
7. Disconnect one device while another member changes an incomplete bill or records a repayment. Reconnect and verify the active group catches up; return to Overview and verify its current actions.

| Observation | Result | Evidence / defect |
| --- | --- | --- |
| Google accounts, invitation, mobile navigation | Not run | |
| Missing shares and reconfirmation actions | Not run | |
| Completion, finality, balances/suggestions | Not run | |
| Actual transfer, incoming action, recipient confirmation | Not run | |
| New activity while pending and after repayment | Not run | |
| Remote completion/repayment updates and reconnect | Not run | |

Record remaining defects with reproduction steps and expected/actual behavior. Do not close #8 until the owner confirms the real trial and production evidence.

## Standards

Review against the task starting commit `6d88bd2`: no documented standards violations, meaningful baseline smells, or concrete correctness concerns found. The change follows the domain terms and financial ADRs.

## Spec

No implementation blockers or scope creep found. The remaining partial acceptance item is production/release verification: actual Google/session behavior, deployed persistence/restore, public SSE, and the owner-plus-two-friends trial remain unverified. This does not block the implementation PR, but #8 must remain open.

Review totals: Standards 0 findings; Spec 1 partial acceptance finding, pending production verification and real trial.
