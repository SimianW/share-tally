---
status: accepted
---

# Bill files exclude people and recalculate costs

A Bill file never carries an Initiator, Participants, shares or Item claims, even when imported into the same Group. This avoids matching the wrong person when names collide, keeps names out of shared files, and makes the importer the Initiator because the Initiator is the payer.

Import recalculates item costs from printed prices, quantities, the Receipt summary, item taxability, manual-final overrides and total paid using the app's pricing rules in [ADR-0009](0009-item-costs-derive-from-printed-price-and-receipt-summary.md); final costs in the file are ignored. Reject the whole file when its numbers do not fit together, so hand-edited or older files cannot create an inconsistent bill.
