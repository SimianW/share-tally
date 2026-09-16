# Splitwise: balances, debt simplification, and payments

Research date: 2026-09-15. Sources are Splitwise-owned pages or the public Splitwise API documentation. The API documentation is an implementation-facing source; it documents the public API, so undocumented app behavior remains explicitly marked as unknown.

## Findings

### Balances are continuously calculated

The Splitwise homepage describes the product as keeping track of “shared expenses, balances, and who owes who.” It also describes paying a friend back as “settle[ing] up with a friend and record[ing] any cash or online payment.” This describes settling up as recording a payment against an ongoing ledger, rather than closing a group-wide accounting period.

Source: [Splitwise homepage](https://www.splitwise.com/) (accessed 2026-09-15), sections “Track balances” and “Pay friends back”.

The API has read endpoints for listing groups and expenses, and the group response includes each member’s balance. There is no settlement or close-period endpoint in the API’s documented endpoint list. The absence of an API endpoint is evidence about the public API surface, not proof that no private UI action exists.

Source: [Splitwise API](https://dev.splitwise.com/) (accessed 2026-09-15), “Groups” (`GET /get_groups`, `GET /get_group/{id}`), “Expenses”, and the complete documented endpoint list.

### Simplify Debts is a group-level calculation/display option

The API’s group object has a `simplify_by_default` boolean described as “Turn on simplify debts?”. A group response contains both `original_debts` and `simplified_debts`, each represented as `from`, `to`, `amount`, and `currency_code`. This supports the interpretation that debt simplification changes the suggested transfer graph while preserving the underlying expense ledger.

The API’s group description says a group is a collection of users who share expenses, and that expenses assigned to a group are split among that group’s users. The API also documents that removing a user from a group does not succeed if the user has a non-zero balance. That is consistent with a live group balance that must be brought to zero before removal; it does not describe a settlement freeze.

Sources: [Splitwise API](https://dev.splitwise.com/) (accessed 2026-09-15), `simplify_by_default`, `original_debts`, `simplified_debts`, group description, and `POST /remove_user_from_group`.

The official help article explicitly says that balances are re-simplified automatically whenever a new expense or payment is added. Simplification preserves each member's total balance while changing who pays whom. Any member can toggle it in group settings. Splitwise recommends leaving it enabled after payments have been made, because disabling it can restore individual debts that no longer align with the transfers already made. Different currencies are simplified separately.

Source: [What is Simplify Debts?](https://feedback.splitwise.com/knowledgebase/articles/107220-what-does-the-simplify-debts-setting-do) (accessed 2026-09-15; redirects to the current help center).

The exact algorithm and tie-breaking rules remain unspecified.

### A payment is a ledger record

In the API’s `expense` schema, `payment` is a boolean meaning “Whether this was a payment between users.” The same object has a `repayments` array whose entries identify an owing user (`from`), an owed user (`to`), and an amount. Payments therefore appear in the same expense/activity model and can reduce the balances used by the group response.

The schema also has `transaction_confirmed`, but its documented meaning is narrower: “If a payment was made via an integrated third party service, whether it was confirmed by that service.” This is not documented as a recipient approval requirement for manually recorded cash payments.

Sources: [Splitwise API](https://dev.splitwise.com/) (accessed 2026-09-15), `expense` schema fields `payment`, `repayments`, and `transaction_confirmed`; [Splitwise homepage](https://www.splitwise.com/) (accessed 2026-09-15), “Pay friends back”.

The public API does not expose a separate payment resource or a documented “recipient accepts payment” operation. The API documentation alone therefore cannot establish whether the consumer app asks the recipient to confirm a manually recorded payment. The only explicit confirmation field found is the third-party transaction status above.

### Edits and deletion are supported, but post-payment policy is undocumented

The API documents `POST /update_expense/{id}` and `POST /delete_expense/{id}`. Updating can replace all shares when any `users__{index}__{property}` value is supplied; deleting is a reversible-style operation because the API also documents `POST /undelete_expense/{id}`. The expense schema tracks `updated_at`, `updated_by`, `deleted_at`, and `deleted_by`.

These facts show that the public API models corrections and deletion as changes to ledger records. The update/delete documentation does not say whether a payment can be edited or deleted after it has changed a balance, nor does it define how a partial payment should interact with later bill edits.

Source: [Splitwise API](https://dev.splitwise.com/) (accessed 2026-09-15), `POST /update_expense/{id}`, `POST /delete_expense/{id}`, `POST /undelete_expense/{id}`, and `expense` schema audit fields.

### Recording a payment does not guarantee receipt of money

The official cash-payment help article says that when someone records a payment, they must ensure the recipient actually receives the money. If a payment has been added but the recipient has received nothing, it tells the recipient to contact the sender. This supports distinguishing the recorded payment from the actual transfer; it does not specify every current app confirmation rule. The older article's broad statement about not handling money should not be generalized to current third-party payment integrations.

Source: [Someone sent me a payment on Splitwise – how do I collect my money?](https://feedback.splitwise.com/knowledgebase/articles/174432-someone-sent-me-a-payment-on-splitwise-how-do-i) (accessed 2026-09-15).

## Implications for ShareTally

For the stated ShareTally scope—one occurrence of each person within a group and independent per-group calculations—the closest verified Splitwise pattern is:

1. Keep bills and payments in one live group ledger.
2. Recalculate member balances whenever a bill or payment changes.
3. Generate an optional simplified debt graph for the current balances.
4. Record a real-world transfer as a payment record; do not treat the calculation suggestion itself as payment completion.

The sources do not settle the key policy question for ShareTally: whether a manually recorded payment takes effect immediately or first enters a pending state requiring the recipient’s confirmation. They also do not establish a rule for an in-flight or partial payment when new bills change the current suggestion. Those policies need to be chosen explicitly.

## What was not verified

- A group-wide freeze or settlement batch in Splitwise.
- A mandatory recipient confirmation for manually recorded cash payments.
- A documented partial-payment workflow or allocation of a partial payment to a particular bill.
- A documented rule for editing an expense after a payment.
- The exact debt simplification algorithm and its tie-breaking behavior.
