# ShareTally project brief

ShareTally helps friends split shared purchases and settle group debts. The owner's immediate use case is bulk shopping with friends at Costco and similar stores.

## Learning goal

Learn TypeScript, React, and SQL by building an application the owner can explain, modify, test, and debug for backend and full-stack co-op interviews. Backend learning priorities include relational modeling, transactions, multi-user authorization, and financial correctness. AI-assisted receipt extraction is optional and follows a usable manual workflow.

## Ownership

AI is the primary implementation contributor, including schema, business rules, processing workflows, queries, transaction boundaries, and tests. The owner directs requirements and product decisions, reviews the resulting changes, and learns through explanations, review, and debugging.

Agents may implement core logic when assigned a specified task; the owner does not need to attempt it manually first. Explain important financial and concurrency decisions and run the agreed checks. This division of work replaces the earlier owner-first coding requirement. Test coverage and public test boundaries remain defined by the specification.

## Delivery constraints

- Target: three to four weeks, normally about five hours per week, potentially five to seven with extra time early in the semester.
- Maximum total effort: 30 hours.
- Planning suggestion, not an additional commitment: aim for 20 hours of planned work and reserve the rest for problems, testing, and deployment.
- Hosting: the owner's existing server, exposed through a public-IP VPS and FRP. Network topology, domain, HTTPS termination, process placement, database backups, and any additional service budget remain to be worked out.

Google sign-in and the deployed friend-group trial are requirements in the specification. The selected stack and its rationale are in [ADR-0003](adr/0003-typescript-relational-backend.md).