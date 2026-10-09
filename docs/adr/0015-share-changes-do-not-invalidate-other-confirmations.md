# Edits invalidate only confirmations whose amounts they change

A confirmation covers its owner's own debt, so the owner chose a single rule for both split modes: an edit invalidates a participant's confirmation only when it changes the amount that participant confirmed or the figure they based it on. Edits that change no one's amount, or only the initiator's own adjustment, keep every confirmation. This replaces ADR-0001's bill-wide invalidation while keeping participant-owned shares, and it also replaces the earlier rule that any edit to an item-based bill cleared every confirmation.

- **Manual bills.** Saving a changed share confirms it for its owner without clearing other confirmations or advancing the bill revision. Each participant states their share against the bill total, so only a change to the total clears every confirmation, including the initiator's, while retaining amounts.
- **Item-based bills.** Shares come from item costs, not from the total paid. A changed total moves only the initiator adjustment (ADR-0008), so it keeps every confirmation. An item-price correction still invalidates only that item's confirmations (ADR-0007).
- **Either mode.** Title, purchase date, notes and participant changes keep confirmations. Removing a participant removes that participant's share and item claims, which frees their fractions for others; the remaining confirmations stay. An added participant starts unconfirmed.
- **Revisions.** Initiator edits still advance the bill revision, so a manual share confirmation against the earlier revision is rejected for review. Item claim confirmations check item versions instead (ADR-0014).

## Consequences

Because confirmations survive other changes, one save can complete the bill at once without the other participants reviewing the result, and completion is final (ADR-0006). In a manual bill this happens when a share brings the submitted shares within the permitted difference (ADR-0004). In an item-based bill it happens when the initiator corrects the total so that the initiator's effective cost is no longer negative. The owner accepted this because each confirmation covers only its owner's debt, and the initiator adjustment is the initiator's own cost.

## Considered Options

- **Keep bill-wide invalidation:** rejected because it forces participants to reconfirm debts that did not change.
- **Keep bill-wide invalidation for item-based bills only:** rejected because a title or notes edit then forced everyone to reselect and reconfirm their item claims.
- **Clear item-based confirmations when the total paid changes:** rejected because the total paid affects only the initiator adjustment.
- **Reject stale confirmations only after financial edits:** rejected because it needs a second version marker for a rare case.
