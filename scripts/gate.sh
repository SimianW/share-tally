#!/bin/sh
# Local release gate: the checks CI requires before release, under one
# heavy-check lock. Every step runs even if an earlier one failed; the summary
# names each failed step and browser scenario, and any failure exits non-zero.
#   sh scripts/gate.sh
# SHARE_TALLY_GATE_CHECK and SHARE_TALLY_GATE_BROWSER_CHECK replace the step
# commands (split on spaces), so tests can run the gate against stubs.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
[ "${SHARE_TALLY_HEAVY_LOCK_HELD:-}" = 1 ] || exec node "$root/scripts/heavy-lock.mjs" sh "$0" "$@"
cd "$root"
log=$(mktemp)
status_file=$(mktemp)
trap 'rm -f "$log" "$status_file"' EXIT
failed=''
step() {
  name=$1
  shift
  echo "=== $name"
  # The step's own exit status, not tee's, decides whether it failed.
  echo unknown >"$status_file"
  { "$@" 2>&1; echo $? >"$status_file"; } | tee -a "$log"
  status=$(cat "$status_file")
  echo "=== $name exited with $status"
  [ "$status" = 0 ] || failed="$failed
  $name (exit $status)"
}
step deploy/check.sh ${SHARE_TALLY_GATE_CHECK:-sh deploy/check.sh}
step deploy/browser-check.sh ${SHARE_TALLY_GATE_BROWSER_CHECK:-sh deploy/browser-check.sh}
echo
if [ -z "$failed" ]; then
  echo "Gate passed."
  exit 0
fi
echo "Gate failed. Failed steps:$failed"
# The browser runner reports its failures as "Failed: <suite>/<scenario>, ...".
if grep -q '^Failed: ' "$log"; then
  echo "Failed scenarios:"
  sed -n 's/^Failed: /  /p' "$log"
fi
exit 1
