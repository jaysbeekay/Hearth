#!/bin/sh
# Generate a self-signed TLS certificate for Hearth's HTTPS deployment.
#
# Usage:
#   ./scripts/generate-cert.sh [hostname-or-ip]
#
# Examples:
#   ./scripts/generate-cert.sh 192.168.1.50
#   ./scripts/generate-cert.sh hearth.local
#   ./scripts/generate-cert.sh          # defaults to localhost
#
# The certificate is written to ./certs/cert.pem and ./certs/key.pem.
# Import cert.pem into your browser/OS trust store to avoid the security warning.

set -e

HOST="${1:-localhost}"
DAYS=3650
OUT_DIR="$(dirname "$0")/../certs"

mkdir -p "$OUT_DIR"

# Build the SubjectAlternativeName — IP address or DNS name
if echo "$HOST" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  SAN="IP:${HOST},IP:127.0.0.1,DNS:localhost"
else
  SAN="DNS:${HOST},DNS:localhost,IP:127.0.0.1"
fi

openssl req -x509 -newkey rsa:4096 \
  -keyout "$OUT_DIR/key.pem" \
  -out    "$OUT_DIR/cert.pem" \
  -days   "$DAYS" \
  -nodes \
  -subj   "/CN=${HOST}" \
  -addext "subjectAltName=${SAN}"

echo ""
echo "Certificate written to:"
echo "  $OUT_DIR/cert.pem  (public certificate)"
echo "  $OUT_DIR/key.pem   (private key — keep this secret)"
echo ""
echo "To avoid browser warnings, import cert.pem into your OS/browser trust store:"
echo "  macOS:   open '$OUT_DIR/cert.pem' -> Keychain Access -> trust Always"
echo "  Windows: certmgr.msc -> Trusted Root Certification Authorities -> import"
echo "  Linux:   sudo cp '$OUT_DIR/cert.pem' /usr/local/share/ca-certificates/hearth.crt && sudo update-ca-certificates"
