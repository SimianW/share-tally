#!/bin/sh
set -eu
: "${GHCR_USERNAME:?Missing GHCR_USERNAME}"
: "${GHCR_TOKEN:?Missing GHCR_TOKEN}"
: "${DRONE_COMMIT_SHA:?Missing DRONE_COMMIT_SHA}"
: "${VITE_CLERK_PUBLISHABLE_KEY:?Missing VITE_CLERK_PUBLISHABLE_KEY}"
# Keep registry credentials inside the disposable pipeline container.
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
api_image="ghcr.io/simianw/share-tally-api:$DRONE_COMMIT_SHA"
web_image="ghcr.io/simianw/share-tally-web:$DRONE_COMMIT_SHA"
docker build --target api --tag "$api_image" .
docker build --target web --build-arg VITE_CLERK_PUBLISHABLE_KEY --tag "$web_image" .
docker push "$api_image"
docker push "$web_image"
