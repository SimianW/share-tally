# Share changes do not invalidate other participants' confirmations

In a manual bill each participant owes the initiator exactly their own share, so the owner chose to stop invalidating confirmations that a change leaves untouched, replacing ADR-0001's bill-wide invalidation while keeping participant-owned shares. Saving a changed share confirms it for its owner without clearing other confirmations or advancing the bill revision, and only a change to the bill total clears every confirmation, including the initiator's, while retaining amounts. Other initiator edits keep confirmations but still advance the revision, so a confirmation against the earlier revision is rejected for review; item-based bills keep ADR-0007's item-level rules.

## Consequences

Because confirmations survive other participants' changes, one save that brings the submitted shares within the permitted difference (ADR-0004) completes the bill at once, and completion is final (ADR-0006), without the other participants reviewing the new overall allocation. The owner accepted this because each confirmation covers only its owner's debt.

## Considered Options

- Keep bill-wide invalidation: rejected because it forces participants to reconfirm debts that did not change.
- Reject stale confirmations only after financial edits: rejected because it needs a second version marker for a rare case.
