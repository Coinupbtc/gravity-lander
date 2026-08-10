#!/usr/bin/env bash
# gravity-lander / Apollo Descent — local static host
set -euo pipefail
cd "$(dirname "$0")"
export APOLLO_PORT="${APOLLO_PORT:-8070}"
echo "Apollo Descent → http://127.0.0.1:${APOLLO_PORT}/"
echo "Ctrl+C to stop."
exec python3 serve.py
