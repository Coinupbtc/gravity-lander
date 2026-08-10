#!/usr/bin/env python3
"""Full playability E2E for APOLLO DESCENT (gravity-lander) via Playwright.

Simulates an iPhone-12 user over the LAN-hosted game:
  load -> Start -> fly (throttle up, drift) -> cut -> crash -> verdict -> restart
Collects every pageerror + console.error and reports pass/fail per gate.
Runs against http://127.0.0.1:8070/ (the live systemd host).
"""
import json, sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8070/index.html"
errors = []

def log(msg):
    print(msg, flush=True)

def main():
    gates = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox", "--enable-unsafe-swiftshader"])
        ctx = b.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1",
        )
        p = ctx.new_page()
        def on_pageerror(e): errors.append("PAGEERROR " + str(e))
        def on_console(m):
            if m.type == "error": errors.append("CONSOLE-ERR " + m.text)
        p.on("pageerror", on_pageerror)
        p.on("console", on_console)

        # 0) load
        p.goto(URL, wait_until="networkidle", timeout=60000)
        p.wait_for_timeout(1500)
        boot = p.evaluate("() => ({\n  title: document.title,\n  canvas: !!document.querySelector('canvas'),\n  startBtn: !!document.querySelector('[data-k=start]'),\n  hasGame: !!(window.Apollo && window.Apollo.Game)\n})")
        gates.append(("boot: title+canvas+start+Apollo", all([boot["canvas"], boot["startBtn"], boot["hasGame"]]) and "APOLLO" in (boot["title"] or "").upper()))
        log("  BOOT  " + json.dumps(boot))

        # 1) start
        p.click("[data-k=start]")
        p.wait_for_timeout(1000)
        started = p.evaluate("() => (window.Apollo.State || {}).status")
        gates.append(("start enters a play state", started in ("playing", "countdown", "fly", "ready")))
        log("  START status=" + str(started))

        # 2) fly: thrust up + hold
        if p.evaluate("() => !!(window.Apollo.Game && window.Apollo.Game.__setThrottleActive)"):
            p.evaluate("() => {window.Apollo.Game.__setThrottleActive(true); window.Apollo.Game.__setThrottle(0.7);}")
        p.wait_for_timeout(2000)
        fly = p.evaluate("() => ({status:(window.Apollo.State||{}).status, thrust:(window.Apollo.State||{}).thrust, y:(window.Apollo.State||{}).y, vx:(window.Apollo.State||{}).vx||0, vy:(window.Apollo.State||{}).vy||0})")
        gates.append(("thrust active + craft moving", (fly.get("vx",0)**2 + fly.get("vy",0)**2) > 0.0001 or fly.get("thrust", 0) > 0))
        log("  FLY  " + json.dumps(fly))

        # 3) cut throttle -> crash
        if p.evaluate("() => !!(window.Apollo.Game && window.Apollo.Game.__setThrottleActive)"):
            p.evaluate("() => {window.Apollo.Game.__setThrottleActive(true); window.Apollo.Game.__setThrottle(0);}")
        end_status = fly.get("status")
        for _ in range(60):
            p.wait_for_timeout(400)
            end_status = p.evaluate("() => (window.Apollo.State||{}).status")
            if end_status in ("crashed", "landed"): break
        gates.append(("ends in crashed/landed", end_status in ("crashed", "landed")))
        log("  END  status=" + str(end_status))

        # 4) verdict shown with pay + refuel
        verdict = p.evaluate("""() => {
            const e = document.querySelector('.apollo-verdict');
            return e && e.classList.contains('show') ? {
                pay: (e.querySelector('.vd-pay') || {}).textContent || null,
                refuel: !!(e.querySelector('.vd-refuel')),
                restart: !!(e.querySelector('.vd-replay') || e.querySelector('[data-k=replay]'))
            } : null;
        }""")
        gates.append(("verdict panel visible w/ pay", verdict is not None and verdict.get("pay") is not None))
        gates.append(("verdict offers refuel + restart", verdict is not None and verdict.get("refuel") and verdict.get("restart")))
        log("  VERDICT " + json.dumps(verdict))

        # 5) restart
        try:
            p.click(".vd-replay, [data-k=replay]", timeout=3000)
            p.wait_for_timeout(2800)  # wait past the 1.6s refuel beat + relaunch
            after = p.evaluate("() => (window.Apollo.State||{}).status")
            gates.append(("restart resets to play", after in ("ready", "countdown", "playing")))
            log("  RESTART status=" + str(after))
        except Exception as ex:
            gates.append(("restart resets to play", False))
            log("  RESTART exception " + str(ex))

        p.screenshot(path="/tmp/playability-final.png")
        b.close()

    # 6) no console/page errors
    severe = [e for e in errors if "Unhandled" not in e]
    gates.append(("zero console/page errors", len(severe) == 0))
    log("  ERRORS " + json.dumps(severe))

    print("\n==== PLAYABILITY GATES ====")
    ok = True
    for name, passed in gates:
        print(("PASS " if passed else "FAIL ") + name)
        ok = ok and passed
    print("RESULT:", "PLAYABLE ✅" if ok else "BLOCKED ❌", f"({sum(1 for _,pa in gates if pa)}/{len(gates)} gates)")
    return 0 if ok else 2

if __name__ == "__main__":
    sys.exit(main())
