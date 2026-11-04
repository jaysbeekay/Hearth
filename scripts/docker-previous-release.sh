#!/usr/bin/env bash
# Picks the previous release image for docker-smoke.sh's upgrade check (#478).
#
#   scripts/docker-previous-release.sh <image ref> <arch>
#
# Prints <image ref> when it has a linux/<arch> image, and nothing otherwise,
# so the smoke test skips its upgrade check rather than pulling an image the
# runner can't run. Releases published before arm64 support are amd64-only,
# so the first arm64 build has no previous release to upgrade from.
set -euo pipefail

REF="${1:?usage: $0 <image ref> <arch>}"
ARCH="${2:?usage: $0 <image ref> <arch>}"

if raw="$(docker buildx imagetools inspect "$REF" --raw 2>/dev/null)" &&
  jq -e --arg a "$ARCH" \
    '.manifests[]? | select(.platform.os == "linux" and .platform.architecture == $a)' \
    <<<"$raw" >/dev/null; then
  echo "$REF"
fi
