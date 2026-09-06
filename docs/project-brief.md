# ShareTally project brief

ShareTally helps friends split shared purchases and settle group debts. The owner's immediate use case is bulk shopping with friends at Costco and similar stores.

## Learning goal

Learn TypeScript, React, and SQL by building an application the owner can explain, modify, test, and debug for backend and full-stack co-op interviews. Backend learning priorities include relational modeling, transactions, multi-user authorization, and financial correctness. AI-assisted receipt extraction is optional and follows a usable manual workflow.

## Ownership

The owner writes the schema, business rules, processing workflows, queries, and transaction boundaries. With Drizzle Kit, this includes reviewing and understanding generated migrations and writing custom migration SQL when needed.

The owner attempts small pieces of core logic first and requests help when stuck. AI may provide boilerplate, non-core code, high-level design help, and debugging assistance. Do not assign the core implementation to an unattended agent by default. Test coverage is agreed in the specification; the division of test-writing work remains undecided.

## Delivery constraints

- Target: three to four weeks, normally about five hours per week, potentially five to seven with extra time early in the semester.
- Maximum total effort: 30 hours.
- Planning suggestion, not an additional commitment: aim for 20 hours of planned work and reserve the rest for problems, testing, and deployment.
- Hosting: the owner's existing server, exposed through a public-IP VPS and FRP. Network topology, domain, HTTPS termination, process placement, database backups, and any additional service budget remain to be worked out.

Google sign-in and the deployed friend-group trial are requirements in the specification. The selected stack and its rationale are in [ADR-0003](adr/0003-typescript-relational-backend.md).