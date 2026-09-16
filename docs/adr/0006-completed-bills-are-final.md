# Completed bills are final

The owner chose to prohibit reopening completed bills in the continuous group ledger. Participants can correct and reconfirm shares while a bill remains incomplete, but automatic completion makes its agreed allocation final. Completion remains distinct from receiving repayment.

This replaces ADR-0001's permission to reopen completed bills while retaining participant-owned shares and confirmation invalidation for changes to incomplete bills. It avoids retaining a previous confirmed allocation while a replacement revision is being negotiated. It also removes the existing initiator workflow for correcting a completed bill; the first release does not add an alternative correction mechanism.

The implementation must prevent edits to completed bills through both direct mutation and reopening. Cancellation remains available only for incomplete bills. No group-wide freeze is introduced: members can still create and complete further bills.
