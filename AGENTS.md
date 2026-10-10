## Project context

Before planning or implementing, read `docs/project-brief.md` for ownership and delivery constraints. Current requirements live in GitHub issue #1, as overridden by issue #26 for receipt extraction and item claiming, and their implementation tickets; domain terms and accepted decisions live in `GLOSSARY.md` and `docs/adr/`. Research notes are background, not approved requirements.

## Code structure

Before adding a file or a cross-module import, read the README's "Code structure" section. Imports point from `app` to `features` to `shared`; compose screens that combine features in `client/src/app`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `SimianW/share-tally`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary; each label string equals its canonical role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Code review

Review rules live in `CODING_STANDARDS.md`; give it to both the Standards and the Spec reviewer. Run `git fetch origin` and diff against `origin/<base>`, usually `origin/main`: a worktree's local branches lag behind.
