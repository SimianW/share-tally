# Coding standards

## Code structure

Imports point from `app` to `features` to `shared`; compose screens that combine features in `client/src/app`.

## Code review rules

### Sources and scope

Review the PR diff against its base, reading surrounding code to verify consequences. Identify the originating issue from the PR description or commits and read it with its relevant comments using `docs/agents/issue-tracker.md`. Follow linked requirements and dependencies that govern the change. Issue #1 is the first-release baseline; issue #26 overrides its receipt-extraction and item-claiming scope as described in `docs/project-brief.md`.

Use `CONTEXT.md`, accepted decisions in `docs/adr/`, and applicable repository instructions for domain and standards context. Treat research notes, draft specs, and implementation notes as background unless the accepted requirement explicitly adopts them. If a required source is unavailable or the originating requirement cannot be identified, state the gap in the review summary and limit conclusions to accessible evidence.

### Standards

Check the diff against documented project conventions and accepted design decisions. Cite the source and rule for each violation. Leave formatting, lint, and other mechanical checks to tooling.

Use Fowler code smells as judgment aids: unclear names, duplicated logic, data clumps, primitive obsession, misplaced responsibilities, repeated branching, scattered changes, and speculative abstractions. Repository guidance takes precedence. Report a smell only when it causes a concrete, consequential problem in this change; label the design judgment and explain the failure scenario rather than treating the smell itself as a violation.

### Spec

Check for missing or partial requirements, incorrectly implemented behavior, and added behavior that conflicts with the accepted scope. Assess only requirements assigned to this PR; other implementation tickets may intentionally deliver the remaining work. Cite the requirement for each finding.

For changes affecting these areas, trace the relevant invariants through server authorization, persistence, and concurrent requests:

- **Access boundaries:** group data stays within the authorized group; uninitiated drafts are visible only to their initiator. Verify server enforcement, including receipt access and deleted-group behavior.
- **Financial correctness:** shares, initiator adjustments, bill eligibility, and confirmed repayments produce balances consistent with the accepted lifecycle. Pending or rejected repayments have no balance effect; groups have independent ledgers.
- **Concurrency:** item claims respect available fractions and reservations; confirmations and corrections validate the reviewed revision or item version as required. Related financial writes succeed or fail atomically.

### Findings

Keep Standards and Spec conclusions distinct in the review summary. Label each finding with its axis; when one defect affects both, report it once and cite both sources. Anchor comments to changed lines and explain the triggering scenario, consequence, and supporting evidence. Apply the review service's severity threshold; avoid unsupported findings or requests for stylistic refactoring alone.
