# Settlement cannot be reversed once started

Once a member starts settlement, the group must finish the required repayments and recipient confirmations before returning to bill activity. The owner chose this restriction because edits or reversal could invalidate repayment instructions after money has already moved outside the app; cancellation is unavailable even before the first confirmation.

## Consequences

- Bills cannot be reopened or changed during settlement.
- A delayed payment or recipient confirmation can keep settlement open indefinitely. No timeout, administrator override, or cancellation path is approved.
- Completed settlement history is retained rather than undone to correct a bill.
- Corrections to settled bills are unsupported, including linked corrections affecting a future settlement.
- Settlement includes every complete, unsettled bill in the group, without a month or amount filter. Incomplete bills block starting settlement; canceled and previously settled bills are excluded.
- Only the affected group blocks new bills, bill edits, and membership changes. Viewing and recipient payment confirmation remain available.
- If every member's net balance is zero, settlement finishes immediately without repayments. The sum of group balances being zero is not sufficient; that sum is always zero even when members owe one another.
