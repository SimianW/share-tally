# Continuous ledger: spec and ticket impact

Reviewed GitHub issue #1 and implementation tickets on 2026-09-15. This is a change proposal, not a replacement specification. The owner accepted continuous, independent group accounting and removal of group freezes and batch settlement; ADR-0005 records that decision. Publication of the accepted replacements is tracked at the end of this review.

## Spec #1

Source: https://github.com/SimianW/share-tally/issues/1

| Location | Required change |
| --- | --- |
| Title and solution | Describe continuous group balances, repayment suggestions, and recorded repayments. Remove starting and finishing a group settlement. |
| Stories 7–8 | Remove the settlement condition on joining. Replace settlement progress with current balances and repayment records/status. Group-member removal and leaving remain deferred. |
| Stories 16–22 | Remove completed-bill reopening and its reconfirmation stories. Keep corrections and renewed confirmations for incomplete bills. Cancellation remains incomplete-only and no longer unblocks settlement. Point repayment actions to individual records. |
| Stories 23–28 | Replace the batch trigger, incomplete-bill gate, unsettled-bill selection, fixed instructions, and group freeze with current group balances and derived repayment suggestions. Preserve group-only netting and no requirement for the fewest transfers. |
| Stories 29–30 | Sender records an actual transfer, including a partial repayment. Recipient confirms or rejects it after seeing sender, recipient, and amount. |
| Stories 31–33 | Remove batch completion, unlocking, and exclusion of settled bills. A zero balance is a current result, not a terminal state. Retain bill and repayment history; recorded repayments offset bill obligations without dropping the original bills merely because money was repaid. |
| Amounts and bill completion | Preserve CAD, participant-owned shares, and incomplete-bill corrections/cancellation. Completed bills cannot reopen or change. Replace settlement-specific cancellation wording. |
| Settlement and repayment acceptance criteria | Rewrite around eligible bills, effective repayments, changing suggestions, recipient permissions, and exactly-once financial effects. No group freeze, irreversible start, final confirmation, or settled-bill state. |
| Membership | Remove settlement-based join restriction. Keep current invitation and authorization rules. |
| Implementation decisions | Replace ADR-0002 reference with ADR-0005. Do not infer schema or endpoint decisions. |
| Tests | Replace start/finalize/freeze races with bill-change/payment races, stale suggestions, duplicate repayment recording/confirmation, group isolation, and conservation of member balances. Retain the Express API plus real PostgreSQL boundary. |
| Release trial | Demonstrate a bill, repayment, further bill activity, and updated balances without closing/reopening a group. Include receipt confirmation and rejection. |
| Out of scope and open questions | Remove active-settlement cancellation and settled-bill concepts. Include partial repayments. Exclude completed-bill reopening and repair of confirmed repayment mistakes; users resolve mistakes privately. Preserve the unrelated exclusions. |

Incomplete bills do not contribute to balances or prevent repayment of existing balances. Completed bills are final under ADR-0006, so no previous-allocation or reopened-bill balance policy is needed.

## Ticket #6: replace the batch-start slice

Source: https://github.com/SimianW/share-tally/issues/6

Suggested title: **View current group balances and repayment suggestions**.

- Calculate every member's balance within one group, including the accepted initiator adjustment. Support current bill eligibility rules; add effective repayment offsets when #7 introduces them.
- Produce valid repayment suggestions between group members without requiring mathematically minimal transfer counts. Suggestions are derived results, not evidence that money moved.
- Refresh the results when eligible bill data changes. Explain that suggestions may change and identify unresolved bills without treating them as a group-wide payment lock.
- Show zero balances as nothing currently owed. Do not archive bills or create a completed settlement.
- Remove frozen bill selection, persisted batch instructions, irreversible start, membership locks, and all settlement-start race tests.
- Test group isolation, netting, canceled/ineligible bill exclusion, cross-month inclusion, every-member-zero cases, and consistent results under bill changes.

Keep #5 as the predecessor, with its scope changed to incomplete-bill correction and completion finality. #6 can deliver a view-only slice; #7 completes its payment-aware calculations. Review the old four-hour estimate against the revised scope.

## Ticket #7: replace finalization with repayment accounting

Source: https://github.com/SimianW/share-tally/issues/7

Suggested title: **Record repayments and update group balances**.

- Record a transfer's group, sender, recipient, and actual amount independently of whatever suggestions are shown later.
- Only the sender creates the repayment record. Only its recipient can confirm or reject it. Pending and rejected records do not offset balances; confirmation applies the recorded actual amount, which may be partial.
- Apply each effective repayment once to both members' balances. With positive balances meaning money receivable, a sender's balance increases by the repayment and the recipient's decreases by the same amount.
- Preserve repayment history when later bills or suggestions change. Bill inclusion plus repayment offsets replaces “exclude settled bills” as the accounting rule.
- Keep bill activity and joining available while repayment is pending. Remove last-confirmation finalization and indefinite group restrictions.
- Test duplicate submissions/confirmations, unauthorized confirmation, changing suggestions, payment/bill races, continued purchases after repayment, rejected records having no financial effect, and competing confirm/reject requests having only one outcome.
- Partial repayments are approved. Confirmed-payment undo and dispute handling are explicitly out of scope; users resolve mistaken confirmations privately. Rejected entries remain distinguishable from confirmed payments.

Keep dependency on #6. The old three-hour estimate covered a different workflow and should be revisited before implementation.

## Ticket #8: adapt attention and release verification

Source: https://github.com/SimianW/share-tally/issues/8

- Keep missing-share and incomplete-bill reconfirmation actions. Show recipients the pending records they can confirm or reject; remove those actions after either decision.
- Link to the bill or repayment record rather than a settlement batch.
- Replace settlement tests with ongoing-ledger tests and continue the real trial through a further bill after repayment.
- Keep mobile usability, actual Google sign-in, restart persistence, backup/restore, and the owner-plus-two-friends trial.
- Keep dependency on #7; its pending-action contract depends on #7's workflow.

## Earlier tickets and existing implementation

Ticket #11 concerns unclaimed/overclaimed receipt items. It has no direct settlement dependency and remains outside the manual first release. It should not block #6–#8.

The native GitHub dependency chain remains #5 → #6 → #7 → #8. The owner has resolved the product questions below; retain `ready-for-human` and agree technical design when implementing. No label or dependency change is required.

- #2: no settlement-driven scope change found. Preserve deployment/authentication requirements.
- #3: remove any future settlement-specific join restriction; do not add leaving/removing members as part of this change.
- #4: its complete-bill summary remains useful. Payment-aware outstanding balances must be added in #7. Avoid relabeling bill-only receivable/payable totals as remaining amounts after repayment.
- #5: remove the final acceptance criterion's delegation of active-settlement and settled-history restrictions to #6/#7. Remove completed-bill reopening from the title, UI, API, tests, and demo. Preserve editing/cancellation of incomplete bills, revisions, participant ownership, and stale-write protections. Add backend tests rejecting completed-bill mutations.
- `server/src/bills.ts` currently summarizes complete, non-canceled bills only. It needs repayment offsets when #7 is implemented.
- Completed-bill finality requires more than hiding the reopen button: `server/src/bill-routes.ts` exposes a reopen route, and the `server/src/bills.ts` mutation also permits a direct bill edit to clear completion. Both paths must reject completed-bill changes. Update `client/src/play/BillActions.tsx`, `client/src/play/bill-api.ts`, `client/src/play/Bills.tsx`, reopen-dependent API tests, and `client/scripts/smoke-groups.mjs` accordingly.
- `server/src/groups.ts` has a future settlement-restriction comment. `client/src/play/Bills.tsx` says “Complete, unsettled bills only.” Both need alignment during the relevant implementation.
- Historical issue-4/issue-5 implementation notes should gain a supersession note where they point to future settlement restrictions, rather than rewriting what the earlier implementation delivered.
- `docs/drafts/implementation-tickets.md` should follow the final GitHub ticket titles. The spec stub should continue linking to #1 instead of becoming a second spec.

## Existing drift discovered during review

Issue #1 and closed ticket #4 still require exact equality between submitted shares and the total. Accepted ADR-0004 permits a difference of at most CAD 0.05, assigned to the initiator provided their effective cost remains nonnegative. Synchronize the spec and annotate #4's acceptance history; this is an already accepted change, not a consequence of continuous accounting.

Issue #1 also contains historical implementation-status statements such as no existing app/test suite. Review those when editing, without treating the architecture decisions as newly undecided.

## Accepted follow-up decisions

- Sender records the actual transfer amount; partial repayment is supported.
- Recipient confirms or rejects the record. Only confirmation offsets balances.
- Completed bills cannot reopen. Changes and reconfirmations remain available only while incomplete.
- Mistaken confirmed payments have no in-app repair or dispute workflow. Users resolve them privately.
- These decisions supersede the earlier open questions about entry ownership, partial repayment, bill revisions after completion, and payment repair.

## Final accepted amount rule

The sender may record an actual positive CAD transfer to any distinct member of the same group, even if it exceeds or does not match a current suggestion. Recipient confirmation applies that amount and may create a reverse balance. The owner accepted this rule; no amount/suggestion product question remains open.

## Publication

Published and read back the updated titles and bodies for #1 and #3–#8. They incorporate all accepted decisions above. #2 and #11 need no change. Verified that issue states and labels are preserved and that the native dependency chain #5 → #6 → #7 → #8 is intact. Application code has not been changed; the revised #5–#8 acceptance criteria still require implementation and verification. No application tests were run for these documentation changes.
