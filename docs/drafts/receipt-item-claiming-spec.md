# Add receipt extraction and fraction-based item claiming before first release

Status: product decisions recorded; awaiting the final accounting decision and owner confirmation before publication as a GitHub issue. This is a specification, not an implementation report.

## Purpose and precedence

From a group's New Bill screen, let an initiator photograph a receipt, review extracted purchase items, and open the bill for participants to claim their own fractions. Keep the existing manual-share workflow available.

This feature is required before the first release. It has its own specification; do not edit issue #1. For item-based bills, this specification supersedes #1's exclusion of receipts, item claiming and automatic tax allocation, its bill-wide confirmation invalidation where explicitly stated below, and its CAD 0.05 completion gate. Manual bills retain #1's existing rules. The owner has retired the earlier effort and time budgets. Existing authentication, continuous ledger, repayment and completed-bill immutability requirements remain in force.

Related work: #11 concerns unclaimed/overclaimed detection, covered here for item bills; #19 concerns synchronization and draft protection; #8's release trial must include this workflow. Do not close or modify those issues implicitly.

## Two allocation modes

- Manual: participants enter and confirm their own CAD shares. Preserve all existing completion conditions, including the CAD 0.05 tolerance and initiator adjustment.
- Item-based: participants claim whole items or exact fractions. This mode also covers manually entered items when no usable receipt exists. Do not mix free-entry personal amounts with item claims on the same bill.
- The initiator chooses the mode before initialization and may switch an unfinished draft back to manual mode. Item-derived amounts must not silently become other participants' manual submissions. After initialization the allocation mode is fixed.

## Capture, extraction and review

1. Open a group and choose New Bill. Offer manual entry and receipt capture/upload.
2. Support one receipt photo per bill, from a mobile camera or an existing image. Provide cropping before upload, replacement, and a preview. Save only the cropped photo. Multi-photo stitching is out of scope.
3. Use the AI SDK + vision approach from `demo/receipt-extraction`. Start with its configurable Google Gemini integration, whose experimental default is `gemini-2.5-flash`; this does not establish a permanent model commitment. Keep provider credentials on the server.
4. Extract purchased items, original descriptions, quantities and printed amounts, taxes, discounts, other adjustments and the paid total. Retain receipt summary values for review; payment, subtotal and tax summary rows must not become duplicate purchasable items.
5. Give each item a short plain-English name. Use `Unclear Item` when the product cannot be identified. Preserve the original OCR text separately and allow viewers to reveal it. The initiator may edit the friendly name.
6. Display original amounts, final tax-inclusive item costs, the paid total and the difference between item costs and the paid total. AI output is editable default data. The initiator always reviews it before initialization; do not add a separate uncertainty approval workflow.
7. Only the initiator can change prices, the paid total, item details and participants. Before initialization, allow adding and deleting items and correcting quantities, taxes, discounts and final costs.
8. Show extraction progress and a recoverable error on failure. Allow retry, photo replacement, manual item entry or switching back to manual mode. Do not initialize a bill merely because extraction succeeded. Preserve saved edits across failures; replacing existing edited extraction results must be explicit.

## Tax and discount defaults

- Use explicit item-level tax and discount information where available. AI may suggest tax applicability and extracted amounts for human review.
- Attribute item-specific charges or discounts to their item. Allocate receipt-wide tax, discounts and other charges proportionally to the applicable items' pre-tax net amounts. If the applicable set cannot be identified, default to all purchase items.
- Show these defaults and allow the initiator to correct each final tax-inclusive item amount directly. Claiming uses that reviewed amount and does not call AI to recalculate money.
- Use deterministic cent arithmetic for allocation. Resolve allocation remainders consistently so allocated charges sum to their source amounts. If proportional allocation is undefined, require a usable manually corrected result rather than fabricating a divisor.
- Validate persisted values and supported CAD amount limits. Human review does not permit malformed, nonfinite or invalid money values.

## Draft and photo lifecycle

- Save unfinished bills as drafts visible only to their initiator. They do not open claiming or affect group balances. Reopening a saved draft restores its saved progress.
- Initialization publishes the reviewed bill to the group and opens claiming for its selected participants, including the initiator.
- All group members can view initialized bills and their photos, even if they are not participants. Outsiders cannot access them. Draft photos remain private to the initiator.
- On desktop, show the photo beside the item list. On mobile, show it above the list with collapse and enlargement controls.
- Retain a photo for six months from upload, then delete it. Preserve the bill, OCR text and reviewed item data after photo expiry, and show that the photo has expired. Implement access expiry and deletion consistently with storage and backup retention.

## Claiming and confirmation

- Claim a whole item or enter an exact fraction such as `1/2`, `1/3` or `2/5`. No percentage entry in this release. Whole-item claiming is the fraction 1.
- Equal sharing is explicit: three participants each choose `1/3`. Do not infer shares from the current number of claimants or change existing claims when another person joins.
- Fractions must be positive and no greater than 1, with a nonzero positive denominator. Preserve exact fractions for allocation checks. Expose reasonable supported input limits without silently approximating entered fractions.
- Users select items and fractions, then click confirm. Calculate and submit their personal share on confirmation, not continuously while selecting. Clearly distinguish unsent selections, confirmed claims and reservations awaiting reconfirmation.
- Reject any submission that exceeds an item's available fraction. Concurrent submissions for the last fraction cannot both succeed; give the unsuccessful participant a current availability message while preserving unrelated selections.
- Every item must be fully claimed and confirmed. Every selected participant must explicitly respond, including confirming that they purchased nothing. A reservation is not a confirmed claim.
- Participants may change or withdraw their own claims before completion. Keep other participants' fixed fractions and confirmations unchanged. The initiator cannot claim on another participant's behalf.
- Calculate each person's item costs using exact fractions, sum them and round their total to cents. Do not round fractions into percentages first. Use a deterministic rounding rule.

## Completion and accounting

Item bills automatically complete once every item is fully claimed and confirmed and all selected participants have responded. Do not impose the manual mode's CAD 0.05 difference gate.

Let T be the actual paid total and S the sum of rounded submitted personal shares. Record T minus S as a separate initiator adjustment, without changing submitted shares. Item mode has no CAD 0.05 limit on this adjustment. Explain and show the difference during review and show the adjustment with the resulting initiator effective cost, including after completion. For example, a paid total of CAD 100 and submitted shares totaling CAD 98 gives the initiator a CAD 2 adjustment.

**Final decision pending:** a sufficiently negative adjustment can make the initiator's effective cost negative. Decide whether item mode preserves the current nonnegative-cost invariant, and at what point to reject inconsistent item allocations. No decision to allow reimbursement exceeding actual expenditure has been recorded.

Completion contributes exactly the finalized shares and adjustment to the existing continuous group ledger. Draft, incomplete and canceled bills remain excluded. Completed bills cannot be edited, reopened or canceled. Repayments continue through the existing workflow; completion does not mean money has been repaid.

## Changes before completion

| Change | Confirmation behavior |
| --- | --- |
| Initiator changes an item's price | Invalidate only that item's confirmations. Preserve prior fractions as reservations, excluded from confirmed amounts until their owners select and confirm again. Owners may release reservations. Other items stay confirmed. |
| Participant changes or withdraws a claim | Update only that participant's claim and calculated share; other participants' fixed claims and confirmations remain valid. |
| Initiator changes the actual paid total | Clear all confirmations. |
| Initiator adds an item | Preserve existing item confirmations. The new item must be fully claimed. Participants who previously confirmed no purchases must respond again. |
| Initiator deletes a claimed item | Remove its claims and require affected participants to confirm their updated personal shares. |
| Initiator changes only a plain-English name | Preserve confirmations; retain original OCR text. |
| Initiator changes participants | Clear all confirmations, retain claims for remaining participants and release claims belonging to removed participants. The initiator remains a participant. |

A change to quantity, tax or discount that changes an item's final claimable cost is a price change. Reject stale confirmations against an earlier price. Check mutations and automatic completion atomically so racing requests cannot edit a finalized bill or confirm obsolete prices. Unlisted edits must not silently introduce further exceptions to existing confirmation rules.

## Acceptance and verification

Use the existing authenticated Express API with an isolated real PostgreSQL database for business, authorization and concurrency checks. Mock the extraction provider for repeatable failure and retry tests; use the experimental fixtures and a real mobile capture smoke test for extraction and presentation. Do not make paid model calls a requirement of every test run.

Verify:

- Manual mode retains its current completion, adjustment, authorization and invalidation behavior.
- Private draft save/reopen, camera and file input, cropping, extraction, review and initialization work together. An extraction error permits retry and manual fallback without losing saved work.
- One photo is enforced; draft/group access applies to the photo itself, not just the page. Six-month expiry removes photo access and schedules deletion without deleting accounting data.
- Plain-English names, `Unclear Item`, original OCR text and reviewed tax-inclusive costs are visible as specified.
- Item tax and discount defaults avoid duplicate amounts and preserve charge totals when dividing cents; manual corrections take precedence.
- Three exact `1/3` claims fully allocate an item; underclaiming, overclaiming, unanswered participants and unconfirmed reservations prevent completion.
- Rounding occurs after summing a participant's fractional costs. Item-mode adjustments greater than CAD 0.05 are accounted for without changing confirmed submitted shares.
- Only an initiator edits prices; only the owning participant submits their claims. Item-price corrections invalidate the affected item's confirmations and preserve reservations and unrelated confirmations.
- Total, item addition/deletion, description and participant changes follow the table above.
- Competing claims cannot overallocate. Stale-price confirmations fail. Retries do not duplicate bills, claims, initialization or accounting effects. Competing edits and completion preserve finality.
- Completed item bills enter current balances and repayments through the existing ledger, with group isolation and balanced accounting intact.
- A deployed group trial includes the initiator and at least two friends, a shared fractional item, a corrected item and reconfirmation, automatic completion and the existing repayment flow.

## Experiment evidence

The `demo/receipt-extraction` experiment recorded 11 receipts: all 11 final totals matched, and 9 samples matched all applicable scored fields. This is a small experimental result, not a production accuracy guarantee. Known mistakes included a faint price and a currency token. The demo does not persist photos or integrate with bill/share accounting; its code is a starting point, not production authorization or storage infrastructure.

## Related decisions

- ADR-0007 records item-scoped price invalidation and reserved claims.
- ADR-0004 continues to govern manual-mode small differences. This specification extends initiator adjustment beyond CAD 0.05 for item mode.
- ADR-0006's completed-bill finality and ADR-0005's continuous ledger remain in force.
