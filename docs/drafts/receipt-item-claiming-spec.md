# Add receipt extraction and fraction-based item claiming before first release

Status: product decisions confirmed by the owner and published as [GitHub issue #26](https://github.com/SimianW/share-tally/issues/26). This is a specification, not an implementation report. The GitHub issue is the canonical requirements record.

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
3. Use Azure Document Intelligence `prebuilt-receipt`, API version `2024-11-30`, to extract receipt items and amounts. Use `gpt-5.6-luna` separately to interpret product names. In development, name interpretation uses the configured OpenAI-compatible provider at `http://dev-2a1m:8317/v1`. Keep all provider credentials on the server. Gemini is comparison evidence, not the selected production extraction provider.
4. Extract purchased items, original descriptions, quantities, printed amounts, available tax/summary fields and the paid total with Azure. Its standard receipt schema does not supply structured discounts; the initiator can enter missing discounts and other adjustments on the same form. Retain receipt summary values for review; payment, subtotal and tax summary rows must not become duplicate purchasable items.
5. Give each item a short plain-English name using Luna. Name interpretation must not change item identities, quantities, prices or taxes. Use `Unclear Item` when the product cannot be identified. Preserve the original OCR text separately and allow viewers to reveal it. The initiator may edit the friendly name. If Luna times out or fails, keep successful Azure extraction and show the original item text with a name-service-unavailable message. Allow retry, manual naming or initiation without waiting for Luna; name interpretation is not a prerequisite for initialization.
6. Display original amounts, final tax-inclusive item costs, the paid total and the difference between item costs and the paid total. AI output is editable default data. The initiator reviews and edits these defaults on the same bill form, then clicks Initiate. Do not add a separate review screen, review checkbox or uncertainty approval workflow. Successful extraction never initiates the bill automatically.
7. Only the initiator can change prices, the paid total, item details and participants. Before initialization, allow adding and deleting items and correcting quantities, taxes, discounts and final costs.
8. Show extraction progress and a recoverable error on failure. Allow retry, photo replacement, manual item entry or switching back to manual mode. Do not initialize a bill merely because extraction succeeded. Preserve saved edits across failures; replacing existing edited extraction results must be explicit.

## Tax and discount defaults

- Provide editable receipt-wide and per-item discounts. The initiator enters discounts Azure did not extract. Display the difference between item costs and the actual paid total, but never interpret that difference automatically as a discount. Do not expand Luna's responsibility beyond names.
- Provide a "Printed prices include tax" setting on the same review form. Default it from recognizable receipt information and let the initiator change it. When printed amounts include tax, display the tax summary for reference without adding that tax to item prices again.
- Use explicit tax applicability and item-specific charges or discounts where recognizable or entered by the initiator. Luna must not infer or edit financial fields.
- Attribute item-specific charges or discounts to their item. For tax-exclusive printed amounts, allocate receipt-wide tax proportionally to the applicable items' pre-tax net amounts. Allocate receipt-wide discounts and other charges proportionally to the applicable item amounts; included tax is never an additional charge. If the applicable set cannot be identified, default to all purchase items.
- Show these defaults and allow the initiator to correct each final tax-inclusive item amount directly. Claiming uses that reviewed amount and does not call AI to recalculate money.
- Use deterministic cent arithmetic for allocation. Resolve allocation remainders consistently so allocated charges sum to their source amounts. If proportional allocation is undefined, require a usable manually corrected result rather than fabricating a divisor.
- Missing required item prices and a missing actual paid total remain empty in the draft, not zero. Show an inline required-field message and block Initiate until the initiator fills them in. This is ordinary form validation, not another approval step. An explicitly entered zero item cost is valid; the actual paid total must remain positive.
- Validate persisted values and supported CAD amount limits. Human review does not permit malformed, nonfinite or invalid money values. There is no automatic currency conversion.

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

Item bills automatically complete once every item is fully claimed and confirmed, all selected participants have responded, and the initiator's effective cost after adjustment is nonnegative. Do not impose the manual mode's CAD 0.05 difference gate.

Let T be the actual paid total and S the sum of rounded submitted personal shares. Record T minus S as a separate initiator adjustment, without changing submitted shares. Item mode has no CAD 0.05 limit on this adjustment. Explain and show the difference during review and show the adjustment with the resulting initiator effective cost, including after completion. For example, a paid total of CAD 100 and submitted shares totaling CAD 98 gives the initiator a CAD 2 adjustment.

Preserve the existing nonnegative effective initiator-cost invariant. If the initiator's submitted share plus the adjustment is negative, keep the bill incomplete and explain that the initiator must correct item prices or the paid total. Do not clamp the adjustment, change other participants' submitted shares, or post the bill to the ledger. Apply the corresponding reconfirmation rules after a correction. For example, CAD 100 paid, CAD 110 claimed by others and a zero initiator share must not complete; CAD 100 paid, CAD 98 claimed by others and a zero initiator share may complete with a CAD 2 initiator adjustment.

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
- Receipt-wide and per-item discounts can be entered manually when Azure omits them. A discrepancy between items and paid total is displayed, never automatically labeled or allocated as a discount.
- The editable tax-inclusion setting prevents already-included tax from being charged again. Tax-exclusive allocation and cent remainders preserve charge totals; manual corrections take precedence.
- Missing item prices or paid total remain empty and block initialization until filled; explicit zero-cost items remain valid.
- A Luna failure preserves Azure items and amounts, displays original descriptions and permits retries, manual names and initialization. A name retry cannot overwrite edited financial fields or item identities.
- Three exact `1/3` claims fully allocate an item; underclaiming, overclaiming, unanswered participants and unconfirmed reservations prevent completion.
- Rounding occurs after summing a participant's fractional costs. Item-mode adjustments greater than CAD 0.05 are accounted for without changing confirmed submitted shares.
- A negative effective initiator cost prevents completion and ledger inclusion even when all items are claimed. A zero effective cost is valid. Correcting prices or the total and obtaining the required new confirmations allows completion when the invariant holds.
- Only an initiator edits prices; only the owning participant submits their claims. Item-price corrections invalidate the affected item's confirmations and preserve reservations and unrelated confirmations.
- Total, item addition/deletion, description and participant changes follow the table above.
- Competing claims cannot overallocate. Stale-price confirmations fail. Retries do not duplicate bills, claims, initialization or accounting effects. Competing edits and completion preserve finality.
- Completed item bills enter current balances and repayments through the existing ledger, with group isolation and balanced accounting intact.
- A deployed group trial includes the initiator and at least two friends, a shared fractional item, a corrected item and reconfirmation, automatic completion and the existing repayment flow.

## Experiment evidence

The original `demo/receipt-extraction` experiment used Gemini on 11 receipts. The subsequent `demo/azure-receipt-comparison` experiment on 2026-09-16 reran the same original scans once with each provider. Both returned 11 usable results and 11 correct final totals. Azure matched all core printed fields on 11/11 receipts, versus Gemini's 9/11, with median end-to-end times of 4.478 and 11.186 seconds respectively. Including discount, tax and currency checks, the full scores were Azure 7/11 and Gemini 8/11. Azure omitted structured discounts and misidentified one currency; Gemini changed printed gross prices in one receipt and added unpriced meal components in another.

These Malaysian/Moroccan public scans are a small experiment, not a production accuracy guarantee for Canadian receipts. The comparison informed the owner's choice of Azure for item extraction and Luna for names. Raw outputs and the report live on `demo/azure-receipt-comparison` in `server/demo/results/comparison-2026-09-16/` and `research/2026-09-16-azure-gemini-receipt-comparison.md`. The demo does not establish production authorization, storage or bill accounting.

## Related decisions

- ADR-0007 records item-scoped price invalidation and reserved claims.
- ADR-0008 records allocation-based completion and the nonnegative effective initiator-cost invariant.
- ADR-0004 continues to govern manual-mode small differences. This specification extends initiator adjustment beyond CAD 0.05 for item mode.
- ADR-0006's completed-bill finality and ADR-0005's continuous ledger remain in force.
