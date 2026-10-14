## Project context

Before planning or implementing, read `docs/project-brief.md` for ownership and delivery constraints. Current requirements live in GitHub issue #1, as overridden by issue #26 for receipt extraction and item claiming, and their implementation tickets; domain terms and accepted decisions live in `GLOSSARY.md` and `docs/adr/`. Research notes are background, not approved requirements.

## Code structure

Before adding a file or a cross-module import, read [docs/architecture.md](docs/architecture.md).
Before running checks or tests, read [docs/development.md](docs/development.md).
Before changing deployment, CI or releases, read [docs/operations.md](docs/operations.md).

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `SimianW/share-tally`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary; each label string equals its canonical role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Code review

Review rules live in `CODING_STANDARDS.md`; give it to both the Standards and the Spec reviewer. Run `git fetch origin` and diff against `origin/<base>`, usually `origin/main`: a worktree's local branches lag behind.
