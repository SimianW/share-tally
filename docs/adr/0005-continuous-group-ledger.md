# Continuous group balances replace batch settlement

The owner chose continuous, independent group accounting instead of starting a group-wide settlement that freezes bills and membership until all repayments are confirmed. Each group contains distinct members; debt simplification stays within that group. Members can see current balances and repayment suggestions as the ledger changes, while actual repayments are recorded separately from those suggestions.

This supersedes ADR-0002. A group-wide checkpoint made repayment instructions stable, but it also stopped new bill activity while waiting for payment. The chosen direction allows ongoing purchases and repayments without a batch-completion state. A suggested transfer may change; a recorded real-world transfer must not disappear merely because suggestions change.

## Repayment rules

The sender records the actual repayment amount. Partial repayments are supported as individual transfers; the recipient confirms or rejects each record. The existing requirement that receipt confirmation recognizes payment remains in force: pending and rejected records do not offset balances, while each confirmed record has one financial effect. Waiting for confirmation never freezes the group.

The owner explicitly excludes repair of mistakenly confirmed repayments. Users resolve those mistakes privately; the app does not provide an undo or dispute-resolution workflow. Rejection handles an incorrect record before confirmation. This does not relax the application's obligation to prevent unauthorized or duplicate financial effects.

Completed bills cannot be reopened. ADR-0006 records this change to the earlier bill-correction workflow.

## Actual transfers take precedence over suggestions

The sender may record a transfer above a current suggestion or to any other member of the same group, even without a matching suggestion. Confirmation applies the actual recorded amount; overpayment may produce a reverse balance. Suggestions can change between transfer, recording, and confirmation, so they cannot restrict the record of money that actually moved.

GitHub spec #1 and its implementation tickets are the requirements source. The impact review records the affected clauses; it is not a second specification.
