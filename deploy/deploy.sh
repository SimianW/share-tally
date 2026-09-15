#!/bin/sh
set -eu
: "${DRONE_COMMIT_SHA:?Missing DRONE_COMMIT_SHA}"
: "${GHCR_USERNAME:?Missing GHCR_USERNAME}"
: "${GHCR_TOKEN:?Missing GHCR_TOKEN}"
deploy_dir=/opt/repo/share-tally
# Provision this file once on the host; pipeline runs never overwrite it.
test -s "$deploy_dir/.env.production" || {
  echo "Missing $deploy_dir/.env.production; provision it from deploy/.env.production.example with production values" >&2
  exit 1
}
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
