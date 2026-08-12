#!/usr/bin/env bash
# Softwire: tunnel Spark -> Start9 Ollama, run visual-critic without Hermes pins.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${START9_VISION_PORT:-11435}"
MODEL="${OLLAMA_VISION_MODEL:-llama3.2-vision:11b}"
MODE="${1:---see}"
IMG="${2:-$ROOT/docs/screenshots/menu.png}"

# ensure tunnel
if ! curl -sS --max-time 2 "http://127.0.0.1:${PORT}/api/tags" >/dev/null 2>&1; then
  echo "[softwire] opening tunnel :${PORT} -> start9 free-gpt:11434" >&2
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -fN \
    -L "127.0.0.1:${PORT}:10.0.3.84:11434" start9
  sleep 1
fi
ssh -o BatchMode=yes start9 'bash ~/start9-ollama-ensure.sh' >/dev/null 2>&1 || true

export OLLAMA="http://127.0.0.1:${PORT}"
export OLLAMA_VISION_MODEL="$MODEL"
echo "[softwire] OLLAMA=$OLLAMA model=$MODEL mode=$MODE img=$IMG" >&2
exec python3 "$ROOT/visual-critic.py" "$MODE" "$IMG"
