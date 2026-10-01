# Share changes do not invalidate other participants' confirmations

This replaces ADR-0001's bill-wide confirmation invalidation for manual bills; participant-owned shares remain in force. In a manual bill each participant owes the initiator exactly their own share, so the owner chose to stop making everyone reconfirm debts that a change to someone else's share leaves untouched. Saving a changed share confirms it for its owner and keeps every other confirmation; it does not advance the bill revision, so other participants' confirmations in flight are not rejected. Only a change to the bill total clears every confirmation, including the initiator's, while retaining amounts. Initiator edits to the title, notes, purchase date or participants keep confirmations but still advance the revision, so a confirmation submitted against the earlier revision is rejected for review. Item-based bills keep their item-level rules from ADR-0007.

## Consequences

Because confirmations survive other participants' changes, one save that brings the submitted shares within the permitted difference (ADR-0004) completes the bill at once, and completion is final (ADR-0006), without the other participants reviewing the new overall allocation. The owner accepted this because each confirmation covers only its owner's debt.

## Considered Options

- Keep bill-wide invalidation: rejected because it forces participants to reconfirm debts that did not change.
- Reject stale confirmations only after financial edits: rejected because it needs a second version marker for a rare case.
