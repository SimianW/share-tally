# Coding standards

Review rules for the Standards and Spec reviewers, PR-Agent and CodeRabbit. Mechanical rules belong in tooling (`pnpm lint`, `pnpm typecheck`), not here.

## Sources and scope

Review the PR diff against its base, reading surrounding code to verify consequences. Identify the originating issue from the PR description or commits and read it with its relevant comments using `docs/agents/issue-tracker.md`. Follow linked requirements and dependencies that govern the change. Issue #1 is the first-release baseline; issue #26 overrides its receipt-extraction and item-claiming scope as described in `docs/project-brief.md`.

Use `GLOSSARY.md`, accepted decisions in `docs/adr/`, and applicable repository instructions for domain and standards context. Treat research notes, draft specs, and implementation notes as background unless the accepted requirement explicitly adopts them. If a required source is unavailable or the originating requirement cannot be identified, state the gap in the review summary and limit conclusions to accessible evidence.

## Standards

Check the diff against documented project conventions and accepted design decisions. Cite the source and rule for each violation. Leave formatting, lint, and other mechanical checks to tooling.

Use Fowler's code smells (_Refactoring_, ch. 3) as judgment aids, alongside any smell baseline the reviewing tool carries. Repository guidance takes precedence. Report a smell only when it causes a concrete, consequential problem in this change; label the design judgment and explain the failure scenario rather than treating the smell itself as a violation.

## Spec

Check for missing or partial requirements, incorrectly implemented behavior, and added behavior that conflicts with the accepted scope. Assess only requirements assigned to this PR; other implementation tickets may intentionally deliver the remaining work. Cite the requirement for each finding.

For changes affecting these areas, trace the relevant invariants through server authorization, persistence, and concurrent requests:

- **Access boundaries:** group data stays within the authorized group; uninitiated drafts are visible only to their initiator. Verify server enforcement, including receipt access and deleted-group behavior.
- **Financial correctness:** shares, initiator adjustments, bill eligibility, and confirmed repayments produce balances consistent with the accepted lifecycle. Pending or rejected repayments have no balance effect; groups have independent ledgers.
- **Concurrency:** item claims respect available fractions and reservations; confirmations and corrections validate the reviewed revision or item version as required. Related financial writes succeed or fail atomically.

## Recurring misses

Defects that local reviews passed and review bots later caught. When the diff touches one of these areas, trace the scenario through every affected path, not only the changed hunk:

- **Ended streams:** an SSE response ended this tick stays in its subscriber set until its asynchronous `close`. Broadcasts skip responses whose `writableEnded` or `destroyed` is set; a write after `end()` raises `ERR_STREAM_WRITE_AFTER_END` and can crash the API (PR #234).
- **Reads across a subscription:** TanStack `fetchQuery` reuses a fetch already in flight. A read that must follow the stream subscription first cancels earlier reads (`invalidateRead`), so a response started before the subscription cannot replace newer state (PR #218).
- **Cached data after access loss:** a stream denial hides the group's protected cached reads (`hideProtectedQueries`), so another page cannot render them before its own denial. A successful retry clears errors from earlier attempts (PR #218).
- **Exit paths during in-flight work:** every way off a page (the page's own back action, the router navigation blocker, `beforeunload`) treats a running upload or request as busy. Check each exit path on every page that hosts the work (PR #222).
- **Files the checks read:** a test or script that reads a file at runtime has that file copied into each Dockerfile stage that runs it. A change to a shared file such as `deploy/nginx.conf`, `Dockerfile` or `.drone.yml` is checked against the tests that read or rewrite it (PRs #239, #240).

## Findings

Keep Standards and Spec conclusions distinct in the review summary. Label each finding with its axis; when one defect affects both, report it once and cite both sources. Anchor comments to changed lines and explain the triggering scenario, consequence, and supporting evidence. Apply the review service's severity threshold; avoid unsupported findings or requests for stylistic refactoring alone.
