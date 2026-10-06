# Coding standards

## Requirements

Issue #1 and its implementation tickets define the first-release requirements. Issue #26 overrides receipt-extraction and item-claiming scope as described in `docs/project-brief.md`.

Use `CONTEXT.md` and accepted decisions in `docs/adr/` for domain terms and conventions. Research notes, draft specs, and implementation notes are background unless an accepted requirement adopts them.

## Code structure

Before adding a file or a cross-module import, read the README's "Code structure" section. Imports point from `app` to `features` to `shared`; compose screens that combine features in `client/src/app`.

## Invariants

Preserve and verify the relevant invariants through server authorization, persistence, and concurrent requests.

- Access boundaries: group data stays within the authorized group; uninitiated drafts are visible only to their initiator. Verify server enforcement, including receipt access and deleted-group behavior.
- Financial correctness: shares, initiator adjustments, bill eligibility, and confirmed repayments produce balances consistent with the accepted lifecycle. Pending or rejected repayments have no balance effect; groups have independent ledgers.
- Concurrency: item claims respect available fractions and reservations; confirmations and corrections validate the reviewed revision or item version as required. Related financial writes succeed or fail atomically.

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
