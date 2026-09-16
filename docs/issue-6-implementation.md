# Issue #6 implementation

The owner authorized implementation and API test writing in this session, then accepted subset DP with member-ID tie-breaking, existing amount limits with BigInt accumulation, one read-only PostgreSQL snapshot, refresh after local bill changes, and manual refresh for other members' changes.

The revised scope was estimated at 5–7 hours of manual implementation, including the membership cap, exact solver, API, UI, and tests. This is an estimate, not recorded project effort.

## Amounts and calculation

Bill and share inputs retain the CAD 10,000.00 limit. Ledger accumulation and subset sums use BigInt cents. API amounts remain integer numbers, with the existing safe-integer check rejecting out-of-range balances with HTTP 422. There is no monthly cutoff or new financial schema.

For each complete, non-canceled bill, credit its total to the initiator and subtract each participant's effective cost. Only the initiator's cost includes the separate adjustment. Zero-balance members remain visible but do not enter the solver.

The solver maximizes the number of disjoint zero-sum subsets. Each connected transfer component with k nonzero members needs at least k−1 transfers. A maximum partition into g components therefore needs n−g transfers. Within each component, debtor/creditor matching achieves this bound.

For each bit mask, the DP takes the largest component count from a mask missing one member, adding one when the current sum is zero. It records the removed member to reconstruct the partition. Runtime is O(n·2ⁿ) and space is O(2ⁿ). Member IDs determine iteration order; ties preserve the first optimal choice. The same balances and IDs produce the same suggestions.

`server/scripts/benchmark-repayments.ts` measures the solver without a database. At 16 nonzero members, 25 runs each of one-component and eight-component examples measured medians of 5.37 ms and 5.00 ms, with maxima of 11.79 ms and 8.28 ms on the development host. The API test also measures a 16-member read including SQL, with a two-second regression ceiling. These are local measurements, not a production latency guarantee.

## Consistency and capacity

`GET /api/groups/:groupId/bills` returns bills, the existing personal summary, and a ledger containing all member balances, suggestions, and incomplete bill IDs. Authorization, membership, bills, and shares are read in one repeatable-read, read-only transaction. Suggestions derive only from that snapshot. A concurrent completion appears wholly before or wholly after in a response. Reading or retrying does not create financial records.

Joining locks the group row already used by invitation rotation. Under that lock, existing members return successfully, then new members are rejected if 16 memberships exist. This serializes concurrent contenders for the last slot. The composite membership key still prevents duplicates. This temporary transaction lock does not freeze group activity while repayments are pending.

The group page refreshes when entered after a local bill mutation and has a manual refresh button for changes by other members. It displays all balances and distinguishes unresolved bills from eligible balances. A personal zero balance does not imply the whole group owes nothing.

## Scope boundary

Issue #7 will add actual repayment records and confirmed repayment effects to this calculation and existing overview summaries. No repayment schema, settlement batch, archived-bill status, or payment mutation is introduced here. Reads retain complete bills even when every balance is zero.

## Validation

API tests use isolated PostgreSQL and test-only authentication. They cover cross-group access, transitive netting, cross-month bills, adjustments of both signs, incomplete/canceled exclusion, all-zero balances with retained bills, the greedy counterexample, zero-balance members, consistent completion reads, and the 16-member boundary with concurrent and repeated joins.

Browser smoke covers member balances, suggestions, mobile overflow, manual refresh after joins, and a real full-group error. It retains the prior bill correction and completed-bill finality checks. Google OAuth and production session lifetime are outside these controlled-authentication tests.

Validation completed: all 45 backend tests, server typecheck/build, migration consistency check, client build/lint, and browser smoke passed. Standards review found two maintenance concerns, duplicate safe-number conversion and unclear DP array names; both were corrected and verified in review. Spec review reported no findings. After the shared conversion and naming changes, typecheck and all six affected API scenarios passed again.

Review baseline: `dfa480859ff40dc7edc9254cbeafcc736da7ecbb`, the merged issue #5 implementation. The original development workspace and its uncommitted work were preserved; implementation lives on `feat/issue-6-group-balances` in an isolated worktree.
