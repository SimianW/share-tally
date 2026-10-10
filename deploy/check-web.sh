#!/bin/sh
set -eu
# Usage: sh deploy/check-web.sh <web image>
# Runs deploy/check-web.mjs next to the web container. That script also plays
# the `api` upstream, so it starts first: Nginx resolves proxy_pass at startup.
web_image="${1:?Usage: check-web.sh <web image>}"
node_image=public.ecr.aws/docker/library/node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
run_id="share-tally-web-check-${DRONE_BUILD_NUMBER:-local}-$$"
cleanup() {
  docker rm --force "$run_id-checks" "$run_id-web" >/dev/null 2>&1 || true
  docker network rm "$run_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$run_id" >/dev/null
# Pass the script as an argument; the runner's workspace cannot be bind-mounted.
docker run --detach --name "$run_id-checks" --network "$run_id" --network-alias api \
  "$node_image" node --input-type=module --eval "$(cat deploy/check-web.mjs)" >/dev/null
docker run --detach --name "$run_id-web" --network "$run_id" --network-alias web "$web_image" >/dev/null
status=$(docker wait "$run_id-checks")
docker logs "$run_id-checks"
if [ "$status" != 0 ]; then
  echo "Web container checks failed; Nginx log follows." >&2
  docker logs "$run_id-web" >&2
  exit 1
fi
