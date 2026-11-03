#!/usr/bin/env bash
# Reports a local image's size layer by layer (#518).
#
#   scripts/docker-image-size.sh <image> [<budget MiB>]
#
# "Compressed" is each layer gzipped at the default level, the same as a
# registry push compresses it, so it tracks what `docker pull` downloads to
# within a few percent. With a budget, exits non-zero when the compressed
# total is over it. Writes a Markdown table to $GITHUB_STEP_SUMMARY when set.
set -euo pipefail

IMAGE="${1:?usage: $0 <image> [<budget MiB>]}"
BUDGET="${2:-}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

docker save "$IMAGE" -o "$WORK/image.tar"
mkdir "$WORK/x" && tar -xf "$WORK/image.tar" -C "$WORK/x"

python3 - "$WORK/x" "$IMAGE" "$BUDGET" <<'PY'
import gzip, json, os, sys, zlib

root, image, budget = sys.argv[1], sys.argv[2], sys.argv[3]

def blob(digest):
    return os.path.join(root, "blobs", digest.replace(":", "/"))

def load(digest):
    with open(blob(digest)) as f:
        return json.load(f)

# docker save writes an OCI layout (index.json) on current engines; older ones
# write manifest.json with layer paths. Handle both.
if os.path.exists(os.path.join(root, "index.json")):
    m = load(json.load(open(os.path.join(root, "index.json")))["manifests"][0]["digest"])
    while "manifests" in m:
        m = load(next(x for x in m["manifests"] if x.get("platform", {}).get("os") != "unknown")["digest"])
    config = load(m["config"]["digest"])
    layers = [blob(l["digest"]) for l in m["layers"]]
else:
    m = json.load(open(os.path.join(root, "manifest.json")))[0]
    config = json.load(open(os.path.join(root, m["Config"])))
    layers = [os.path.join(root, l) for l in m["Layers"]]

history = [h for h in config.get("history", []) if not h.get("empty_layer")]

def sizes(path):
    with open(path, "rb") as f:
        head = f.read(2)
    if head == b"\x1f\x8b":  # already gzipped: that is the pushed size
        compressed = os.path.getsize(path)
        raw = 0
        with gzip.open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                raw += len(chunk)
        return compressed, raw
    raw, compressed = os.path.getsize(path), 0
    z = zlib.compressobj(6, zlib.DEFLATED, 31)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            compressed += len(z.compress(chunk))
    return compressed + len(z.flush()), raw

MiB = 1024 * 1024
rows, total_c, total_r = [], 0, 0
for i, path in enumerate(layers):
    c, r = sizes(path)
    total_c += c
    total_r += r
    step = history[i].get("created_by", "") if i < len(history) else ""
    step = step.replace("/bin/sh -c ", "").replace(" # buildkit", "").replace("|", "\\|")
    rows.append((c, r, " ".join(step.split())[:90]))

lines = [f"### Image size: `{image}`", "", "| Compressed (MiB) | Unpacked (MiB) | Step |", "| ---: | ---: | --- |"]
lines += [f"| {c / MiB:.1f} | {r / MiB:.1f} | `{s}` |" for c, r, s in rows if c >= 100 * 1024]
lines += [f"| **{total_c / MiB:.1f}** | **{total_r / MiB:.1f}** | total |"]
over = bool(budget) and total_c / MiB > float(budget)
if budget:
    lines += ["", f"Budget: {budget} MiB compressed. " + ("**Over budget.**" if over else "Within budget.")]
report = "\n".join(lines)
print(report)
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a") as f:
        f.write(report + "\n")
sys.exit(1 if over else 0)
PY
