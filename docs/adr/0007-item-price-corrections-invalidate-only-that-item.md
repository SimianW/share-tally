# Item price corrections invalidate only that item's confirmations

For item-based bills, the owner chose item-level confirmation so a price correction does not require participants to reconfirm unrelated purchases. Before completion, only the initiator can edit item prices; changing an item's price invalidates that item's claims' confirmations and requires its claimants to select and confirm again. Confirmations on other items remain valid. This overrides ADR-0001's bill-wide invalidation for this specific operation on item-based bills; the manual workflow keeps its existing rules. Completed bills remain final under ADR-0006.

Invalidated claims retain their fractions as reservations, excluded from confirmed amounts until their owners select and confirm again. Claimants may release their reservations. Preserving them prevents an item-price correction from allowing someone else to take portions already claimed.
