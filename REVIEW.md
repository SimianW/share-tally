# ShareTally PR review guidance

Read AGENTS.md, docs/README.md, docs/project-brief.md, CONTEXT.md, and applicable docs/adr/ decisions. Current requirements live in GitHub issue #1 and its implementation tickets; archived discussions are not current requirements.

Report concrete defects introduced by the PR, with changed-line evidence, a reachable failure scenario, and an actionable correction. Follow changed contracts through relevant callers, tests, and persistence code. Do not report planned features as regressions merely because the early scaffold does not implement them yet.

Prioritize:

- Server-side authentication, group membership, participant ownership, and cross-group access checks. A group member is not automatically a participant in every bill.
- Monetary precision, validation, and conservation of totals; distinguish an explicit zero share from a missing share.
- Current-revision confirmations and the invalidation rules in ADR-0001. First submission and changing an existing share have different confirmation behavior.
- Atomic transactions, concurrent updates, duplicate requests, and stale writes around bill completion and settlement.
- ADR-0002: settlement cannot be reversed once started; group activity restrictions, eligible bills, and recipient payment confirmations must remain consistent. Immediate completion requires every member's balance to be zero, not merely their sum.
- Relational constraints, migration safety, API/UI contract consistency, and tests for actual changed behavior.

Honor the learning and ownership boundaries in docs/project-brief.md. Provide review feedback; do not implement business logic, push fixes, approve, or merge. Avoid style-only findings already covered by linting. Cite accepted rules instead of inventing product requirements.
