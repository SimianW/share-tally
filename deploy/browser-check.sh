#!/bin/sh
set -eu
# Release gate: the browser-infrastructure tests, then every browser scenario,
# one at a time. Each check runs even if an earlier one failed, so the output
# names every failure; any failure stops the release.
# Queue behind other heavy checks on this host (scripts/heavy-lock.mjs). CI
# images without Node rely on Drone running one build at a time instead.
if [ "${SHARE_TALLY_HEAVY_LOCK_HELD:-}" != 1 ] && command -v node >/dev/null; then
  exec node "$(dirname "$0")/../scripts/heavy-lock.mjs" sh "$0" "$@"
fi
image="share-tally-browser-check:${DRONE_BUILD_NUMBER:-local}"
trap 'docker image rm "$image" >/dev/null 2>&1 || true' EXIT
docker build --target browser-checks --tag "$image" .
# The host network lets Chromium's container reach Vite through host-gateway,
# as on a development machine; Chromium keeps its own network namespace.
run_check() {
  docker run --rm --network host \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    --env TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 \
    --env SHARE_TALLY_HEAVY_LOCK_HELD=1 \
    "$image" pnpm "$@"
}
failed=''
run_check test:environment || failed="$failed test:environment"
run_check test:network-isolation || failed="$failed test:network-isolation"
run_check test:browser --all || failed="$failed browser-scenarios"
if [ -n "$failed" ]; then
  echo "Browser release gate failed:$failed. Scenario failures are listed above as \"Failed: <suite>/<scenario>\"." >&2
  exit 1
fi
