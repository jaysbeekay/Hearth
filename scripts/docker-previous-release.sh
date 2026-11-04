#!/usr/bin/env bash
# Picks the previous release image for docker-smoke.sh's upgrade check (#478).
#
#   scripts/docker-previous-release.sh <image ref> <arch>
#
# Prints <image ref> when it has a linux/<arch> image, and nothing when it
# was fetched and has none, so the smoke test skips its upgrade check rather
# than pulling an image the runner can't run. Releases published before arm64
# support are amd64-only, so the first arm64 build has nothing to upgrade
# from. A failed registry lookup (rate limit, network) exits non-zero instead
# of looking like "no image", so it can't quietly skip the upgrade check.
set -euo pipefail

REF="${1:?usage: $0 <image ref> <arch>}"
ARCH="${2:?usage: $0 <image ref> <arch>}"

raw="$(docker buildx imagetools inspect "$REF" --raw)" \
  || { echo "could not inspect $REF" >&2; exit 1; }

if jq -e 'has("manifests")' <<<"$raw" >/dev/null; then
  # A manifest list / OCI index: look for the platform entry.
  match="$(jq --arg a "$ARCH" \
    '[.manifests[] | select(.platform.os == "linux" and .platform.architecture == $a)] | length' <<<"$raw")"
else
  # A single-platform manifest: its architecture is in the image config.
  config="$(docker buildx imagetools inspect "$REF" --format '{{json .Image}}')" \
    || { echo "could not read the image config of $REF" >&2; exit 1; }
  match="$(jq --arg a "$ARCH" 'if .os == "linux" and .architecture == $a then 1 else 0 end' <<<"$config")"
fi

if [ "$match" -gt 0 ]; then
  echo "$REF"
fi
