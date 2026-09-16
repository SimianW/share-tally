# Complete item bills by confirmed allocation

The owner chose separate completion rules for manual and item-based bills. Manual bills retain ADR-0004's CAD 0.05 tolerance. Item-based bills complete when all items are fully claimed and confirmed and every participant has responded, without a CAD 0.05 difference gate. Fractions are exact, each participant's summed cost is rounded to cents, and the difference from the actual paid total is recorded separately as an initiator adjustment without changing submitted shares.

This allows an item bill to complete even when independently rounded shares or reviewed item costs differ from the paid total by more than CAD 0.05. The initiator bears that difference, which must be visible during review and after completion. The treatment of a negative effective initiator cost is still awaiting an explicit decision; this ADR does not authorize over-reimbursement.
