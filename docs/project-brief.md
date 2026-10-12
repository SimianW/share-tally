# ShareTally project brief

ShareTally helps friends split shared purchases and settle group debts. The owner's immediate use case is bulk shopping with friends at Costco and similar stores.

## Learning goal

Learn TypeScript, React, and SQL by building an application the owner can explain, modify, test, and debug for backend and full-stack co-op interviews. Backend learning priorities include relational modeling, transactions, multi-user authorization, and financial correctness. The first release must include AI-assisted receipt extraction and item claiming alongside the manual workflow. [Issue #26](https://github.com/SimianW/share-tally/issues/26) specifies this feature and its overrides of the original requirements; issue #1 remains unchanged.

## Ownership

AI is the primary implementation contributor, including schema, business rules, processing workflows, queries, transaction boundaries, and tests. The owner directs requirements and product decisions, reviews the resulting changes, and learns through explanations, review, and debugging.

Agents may implement core logic when assigned a specified task; the owner does not need to attempt it manually first. Explain important financial and concurrency decisions and run the agreed checks. This division of work replaces the earlier owner-first coding requirement. Test coverage and public test boundaries remain defined by the specification.

## Delivery constraints

- The owner retired the earlier time and effort budgets on 2026-09-15 because AI now leads implementation. Do not use the earlier 30-hour cap to limit scope.
- Receipt extraction and item claiming in issue #26 must be completed before the first release. Its separate specification states the changes to issue #1's original scope and rules without editing issue #1.
- Hosting: Railway Hobby, with one API and one web service in US East Metal (Virginia), and PostgreSQL on Neon AWS us-east-1. Drone stays on the owner's home server and releases tested GHCR images after the browser gate. [ADR-0022](adr/0022-host-on-railway-near-neon.md) records the hosting decision; Railway setup and the public-domain cutover are separate owner actions.

Google sign-in and the deployed friend-group trial are requirements in the specification. The selected stack and its rationale are in [ADR-0003](adr/0003-typescript-relational-backend.md).
