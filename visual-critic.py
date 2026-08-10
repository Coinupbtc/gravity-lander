#!/usr/bin/env python3
"""Dobby — harsh visual critic for the Gravity Lander game.

Soft-wired vision backends (env, no Hermes hardwire):
  OLLAMA              base URL (default http://127.0.0.1:11434)
  OLLAMA_VISION_MODEL preferred model (e.g. llama3.2-vision:11b)
  VISION_MODELS      comma list fallback chain

Examples (Start9 softwire via tunnel on :11435):
  OLLAMA=http://127.0.0.1:11435 OLLAMA_VISION_MODEL=llama3.2-vision:11b \\
    python3 visual-critic.py shot-menu.png
  OLLAMA=http://127.0.0.1:11435 OLLAMA_VISION_MODEL=llama3.2-vision:11b \\
    python3 visual-critic.py --see shot-menu.png

Usage:
  python3 visual-critic.py [--see|--critique] <image.png>
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.request

OLLAMA = os.environ.get("OLLAMA", "http://127.0.0.1:11434").rstrip("/")

CRITIQUE = (
    "You are Dobby, an extremely harsh senior AAA game art director. "
    "You judge a Lunar-Lander-style ThreeJS game screenshot with brutal honesty. "
    "Compare it mentally to a polished commercial game like Lunar Lander / a AAA title.\n\n"
    "Rate 0-10 on: (1) overall visual beauty, (2) terrain/lighting detail, "
    "(3) spacecraft/prop quality, (4) HUD/UI polish, (5) atmosphere/cohesion.\n\n"
    "Then give a VERDICT on the LAST line, exactly one of:\n"
    "PASS_AAA — genuinely wowed, on par with or better than a polished commercial game, or\n"
    "NEEDS_WORK — anything less. NO soft grading: AAA or it fails.\n"
    "Be specific about what looks cheap, empty, low-poly, or unfinished."
)

SEE = (
    "You are a QA dogfood agent. Look at this game screenshot and report ONLY what is "
    "actually visible — do not invent polish that is not there.\n\n"
    "Answer with these headings:\n"
    "SCREEN: menu | flight | landed | crashed | unknown\n"
    "TITLE_TEXT: exact title/subtitle strings you can read (or NONE)\n"
    "BUTTONS: every button/label you can read\n"
    "HUD: telemetry panels and numbers you can read\n"
    "CONTROLS_HINTS: key bindings shown\n"
    "VISIBLE_PROBLEMS: empty regions, missing UI, unreadable text, grey blocks, etc.\n"
    "CAN_A_HUMAN_PLAY_FROM_THIS_FRAME: yes/no + one sentence why"
)


def model_chain() -> list[str]:
    preferred = os.environ.get("OLLAMA_VISION_MODEL", "").strip()
    raw = os.environ.get(
        "VISION_MODELS",
        "moondream",
    )
    chain = [m.strip() for m in raw.split(",") if m.strip()]
    if preferred:
        chain = [preferred] + [m for m in chain if m != preferred]
    # de-dupe preserve order
    seen, out = set(), []
    for m in chain:
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


def call_ollama(model: str, image_b64: str, prompt: str) -> tuple[str, bool]:
    payload = {
        "model": model,
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 512},
        "messages": [{"role": "user", "content": prompt, "images": [image_b64]}],
    }
    req = urllib.request.Request(
        OLLAMA + "/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    t = time.time()
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.loads(r.read().decode())
    print(f"[{model} @ {OLLAMA}] elapsed {round(time.time() - t)}s", file=sys.stderr)
    msg = (d.get("message") or {}).get("content", "").strip()
    err = d.get("error")
    if err:
        return f"[model error] {err}", False
    return msg, bool(msg)


def main() -> None:
    args = [a for a in sys.argv[1:] if a]
    mode = "critique"
    if args and args[0] in ("--see", "--critique"):
        mode = "see" if args.pop(0) == "--see" else "critique"
    if not args:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    path = args[0]
    prompt = SEE if mode == "see" else CRITIQUE
    img = base64.b64encode(open(path, "rb").read()).decode()
    print(f"# dogfood mode={mode} image={path} ollama={OLLAMA}", file=sys.stderr)

    last_err = None
    for model in model_chain():
        try:
            text, ok = call_ollama(model, img, prompt)
            if ok:
                print(text)
                return
            print(f"[{model} empty]", file=sys.stderr)
        except Exception as e:
            last_err = e
            print(f"[{model} failed: {e!r}]", file=sys.stderr)
    print(f"all vision backends failed last={last_err!r}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
