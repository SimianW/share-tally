#!/bin/sh
set -eu
# Build contexts are sent to Docker; do not bind the runner's workspace path,
# which may not exist at the same path on the host Docker daemon.
check_image="share-tally-check:${DRONE_BUILD_NUMBER:-local}"
docker build --target checks --tag "$check_image" .
web_check_image="share-tally-web-check:${DRONE_BUILD_NUMBER:-local}"
trap 'docker image rm "$check_image" "$web_check_image" >/dev/null 2>&1 || true' EXIT
docker run --rm --network host \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --env TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 \
  "$check_image"

# This synthetic publishable key only enables compilation; it cannot sign users in.
docker build --target web --tag "$web_check_image" \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_c2hhcmUtdGFsbHkuZXhhbXBsZSQ= .
