#!/bin/sh
set -eu
: "${DRONE_COMMIT_SHA:?Missing DRONE_COMMIT_SHA}"
: "${DRONE_REMOTE_URL:?Missing DRONE_REMOTE_URL}"
: "${GHCR_USERNAME:?Missing GHCR_USERNAME}"
: "${GHCR_TOKEN:?Missing GHCR_TOKEN}"
deploy_dir=/opt/repo/share-tally
# Provision this file once on the host; pipeline runs never overwrite it.
test -s "$deploy_dir/.env.production" || {
  echo "Missing $deploy_dir/.env.production; provision it from deploy/.env.production.example with production values" >&2
  exit 1
}
# The release pipeline runs one release at a time, so a commit that is main's head
# here cannot be replaced by an older one. A newer push queues its own release.
main_sha=$(GIT_TERMINAL_PROMPT=0 timeout 60 git ls-remote "$DRONE_REMOTE_URL" refs/heads/main | cut -f1)
test -n "$main_sha" || {
  echo "Could not read the head of main from $DRONE_REMOTE_URL" >&2
  exit 1
}
if [ "$main_sha" != "$DRONE_COMMIT_SHA" ]; then
  echo "Release superseded: main is at $main_sha, not $DRONE_COMMIT_SHA. Skipping migrations and container replacement."
  exit 0
fi
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
cp deploy/compose.yml "$deploy_dir/compose.yml"
cd "$deploy_dir"
export IMAGE_TAG="$DRONE_COMMIT_SHA"
docker compose pull
# The old API keeps running if migration fails; migration rollback is not automatic.
docker compose run --rm --no-deps api node dist/migrate.js
docker compose up --detach --wait --wait-timeout 120
# Record only a release whose containers passed health checks.
printf 'IMAGE_TAG=%s\n' "$IMAGE_TAG" > .release.env
