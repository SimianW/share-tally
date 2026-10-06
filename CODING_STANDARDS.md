# Coding standards

## Requirements

Issue #1 and its implementation tickets define the first-release requirements. Issue #26 overrides receipt-extraction and item-claiming scope as described in `docs/project-brief.md`.

Use `CONTEXT.md` and accepted decisions in `docs/adr/` for domain terms and conventions. Read the ADRs that govern changed behavior and surface contradictions by naming the ADR. Research notes, draft specs, and implementation notes are background unless an accepted requirement adopts them.

## Code structure

Before adding a file or a cross-module import, read the README's "Code structure" section for module boundaries and screen composition.

## Financial correctness

Use integer CAD cents for money and BigInt fractions for exact shares. Keep amount arithmetic exact, round only at the final personal total, and check bigint-to-number conversions. Floating-point arithmetic on amounts is not safe.

The server is the source of truth for amounts and balances. Client display formatting and input parsing are fine; financial calculations must agree with the server.

Shares, initiator adjustments, bill eligibility, and confirmed repayments produce balances consistent with the accepted lifecycle. Pending or rejected repayments have no balance effect; groups have independent ledgers. Preserve completed-bill immutability and idempotency for repeat submissions.

## Access boundaries

Check that each route's signed-in user belongs to the group and is authorized to act on the bill, item claim, or repayment record. Group data stays within the authorized group; uninitiated drafts are visible only to their initiator. Enforce access on the server, including receipt access and deleted-group behavior.

## Concurrency

Reads that decide a write and multi-row writes belong in one `db.transaction`, with suitable locking or conditional updates. Prevent lost-update and double-submit races. Related financial writes succeed or fail atomically.

Item claims respect available fractions and reservations. Confirmations and corrections validate the reviewed revision or item version as required. Trace relevant financial and access invariants through authorization, persistence, and concurrent requests.

## Boundary validation

Validate request input at the boundary using zod or `input-validation.ts`. Return errors through `BillError` with an accurate status code.

## Schema and migrations

Generate migrations from `schema.ts` with drizzle-kit and keep SQL consistent with the schema change. Preserve already-merged migrations unchanged; use a new migration for subsequent changes. Check constraints, foreign keys, ON DELETE behavior, unique indexes that enforce invariants, and indexes for new query paths.

## Tests

Backend integration tests use node:test and real PostgreSQL via Testcontainers, through the HTTP API via `server-process.ts`. Prefer assertions of observable behavior through the public HTTP API over tests of internal functions. Cover financial edge cases, authorization failures, and concurrent requests for changed behavior. Use deterministic conditions rather than flaky timing assumptions.

## Code review rules

### Sources and scope

Review the PR diff against its base and read surrounding code to verify consequences. Identify the originating issue from the PR description or commits and read it with its relevant comments using `docs/agents/issue-tracker.md`. Follow linked requirements and dependencies that govern the change.

If a required source is unavailable or the originating requirement cannot be identified, state the gap in the review summary and limit conclusions to accessible evidence.

### Standards

Cite the source and rule for each Standards violation. Leave formatting, lint, and other mechanical checks to tooling.

Use Fowler code smells as judgment aids: unclear names, duplicated logic, data clumps, primitive obsession, misplaced responsibilities, repeated branching, scattered changes, and speculative abstractions. Report a smell only when it causes a concrete, consequential problem in this change; label the design judgment and explain the failure scenario.

### Spec

Assess only requirements assigned to this PR; other implementation tickets may intentionally deliver the remaining work. Cite the requirement for each Spec finding.

### Findings

Keep Standards and Spec conclusions distinct in the review summary. Label each finding with its axis; when one defect affects both, report it once and cite both sources. Anchor comments to changed lines and explain the triggering scenario, consequence, and supporting evidence. Apply the review service's severity threshold and report defects rather than stylistic refactoring alone.
