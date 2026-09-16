# Issue #4 design decisions

Subsequent decisions: ADR-0005 replaces unsettled-bill accounting with continuous balances including confirmed repayment offsets. ADR-0006 makes completed bills final. The notes below preserve the original issue-4 design.

These owner-approved decisions supplement [issue #4](https://github.com/SimianW/share-tally/issues/4). The design interview is complete, and the owner selected prototype A for implementation.

## Confirmed decisions

- The owner authorized the assistant to implement the entire ticket, including the core schema, business workflows, and tests, overriding the original division of implementation work for this ticket.
- A bill requires a title and purchase date and allows optional notes. The trimmed title is 1–120 characters; notes are at most 2,000 characters.
- Purchase dates contain only a calendar date, default to today on the user's device, and cannot be in the future.
- Fields can be changed before creation. Editing a saved bill remains in issue #5.
- Bill totals are positive CAD amounts, at most CAD 10,000.00. Store and calculate amounts as integer cents; the API also uses integer cents. Reject inputs with more than two decimal places without rounding.
- The initiator must enter both the bill total and their own share in the creation form. Their share permits an explicit zero and does not default to zero.
- The creation action explicitly confirms the initiator's share. Save the bill and that confirmed share atomically; a failure must not leave a partial bill.
- Other participants submit and confirm their own shares in one action. First submissions preserve earlier confirmations. Missing submissions remain distinct from confirmed zero amounts.
- Every individual share must be between zero and the bill total, inclusive.
- Every selected participant must explicitly confirm before completion. The absolute difference between the submitted share sum and bill total must be at most CAD 0.05, inclusive. The initiator's effective share after adjustment must be nonnegative. These owner-approved rules replace exact equality in issue #1 and issue #4 and the interim CAD 1 proposal.
- Preserve all submitted shares. Record a separate initiator adjustment equal to the bill total minus the submitted share sum; add it to the initiator's submitted share for their effective cost. Explain at creation that up to five cents may be added or deducted. Financial summaries use the adjusted cost, so receivables and payables balance.
- The homepage shows personal receivables, payables, and net balance across groups. Group details show the user's net balance within that group and its bills. Only complete, unsettled bills contribute. Follow the demo's youthful theme with bold, oversized key amounts; cross-group totals do not imply cross-group settlement.
- Bill details prominently show the actual difference between the bill total and submitted shares in oversized type, distinguishing remaining shortfall, excess, and exact balance. Show confirmation progress separately; missing shares cannot count as confirmed zeros. Once everyone confirms, keep displaying the actual difference even if completion occurs within tolerance, together with the initiator adjustment and effective cost. Do not replace the original difference with zero after adjustment. Differences outside tolerance leave the bill incomplete; corrections remain in issue #5.
- Resubmitting an existing share is out of scope for this ticket. Transport retry handling must still prevent duplicate effects.

## Next step

The owner confirmed the design and selected A (the lime difference card beside participant shares) before production frontend/backend adaptation. Implement the complete ticket using A as the visual reference. Prototype source is isolated on `prototype/issue-4-bill-designs`, commit `928b10e`, in the sibling `issue-4-bill-prototype` worktree. Run `pnpm --dir client prototype:bills` there and open `http://dev-2a1m:5197/?bill-prototype&variant=A`. The prototype is a visual reference, not production code.
