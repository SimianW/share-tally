#!/bin/sh
set -eu
# Exits 0 only when the browser release gate can be skipped: a branch other
# than main whose changes since it left main are all documentation. Any other
# exit, including an error, means run the gate. The reason goes to stderr.
branch="${DRONE_BRANCH:-}"
run() {
  echo "Browser gate runs: $1." >&2
  exit 1
}

[ -n "$branch" ] || run 'branch unknown'
[ "$branch" != main ] || run 'main always runs it'
command -v git >/dev/null 2>&1 || run 'git unavailable'
[ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = false ] ||
  run 'shallow or unreadable clone'
git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main ||
  run 'could not fetch main'
base="$(git merge-base origin/main HEAD)" || run 'no merge base with main'
[ "$base" != "$(git rev-parse HEAD)" ] || run 'no commits beyond main'

# Without rename detection both sides of a move are listed and checked.
changed="$(git diff --no-renames --name-only "$base" HEAD)" ||
  run 'could not list changes'
# docs/ and research/ are outside the Docker build context (.dockerignore), and
# no build, test or runtime code reads Markdown.
outside="$(printf '%s\n' "$changed" | grep -Ev '^(docs/|research/)|\.md$' || true)"
if [ -n "$outside" ]; then
  run "changes outside documentation, such as $(printf '%s\n' "$outside" | head -n 1)"
fi
echo "BROWSER GATE SKIPPED: nothing outside documentation changed since main." >&2
