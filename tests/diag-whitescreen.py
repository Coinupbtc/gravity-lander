#!/usr/bin/env python3
"""Deep iOS-white-screen diagnostic for APOLLO DESCENT.
Probes the live server looking for why a real device shows white while headless
Chromium (SwiftShader) passes. Checks:
  1. page background color after load (is it black #000 as designed, or white?)
  2. did init reach __mark (boot hidden / Apollo.Game ready)?
  3. is the WebGL renderer creating + drawing a canvas?
  4. console + page errors (chrome)
  5. run once with WebGL explicitly FAILING to map the failure UX
"""
import json, sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8070/index.html"
errs = []

def probe(ctx_builder, label):
    print(f"\n=== {label} ===", flush=True)
    b = ctx_builder()
    ctx = b.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    p = ctx.new_page()
    local_errs = []
    p.on("pageerror", lambda e: local_errs.append("PAGE " + str(e)))
    p.on("console", lambda m: local_errs.append("CONSOLE:" + m.type + " " + m.text) if m.type in ("error","warning") else None)
    p.goto(URL, wait_until="load", timeout=60000)
    p.wait_for_timeout(2500)
    state = p.evaluate("""() => {
      const body = getComputedStyle(document.body).backgroundColor;
      const boot = document.getElementById('boot');
      const bootHidden = boot ? boot.classList.contains('hidden') : null;
      const fatal = document.getElementById('fatal');
      const fatalShown = fatal && fatal.style.display === 'block';
      const fatalTxt = fatalShown ? (fatal.textContent||'').slice(0,400) : '';
      const canvas = document.querySelector('canvas');
      let glInfo = null;
      if (canvas) {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          glInfo = { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), ok:true };
        } else glInfo = { ok:false };
      }
      return { bg: body, bootHidden, fatalShown, fatalTxt, hasCanvas:!!canvas, glInfo,
               healthy: window.__healthy, status: (window.Apollo&&window.Apollo.State||{}).status,
               game: !!(window.Apollo&&window.Apollo.Game) };
    }""")
    print(json.dumps(state, indent=1, default=str))
    print("ERRLOG:", json.dumps(local_errs, indent=1))
    errs.extend(local_errs)
    b.close()

with sync_playwright() as pw:
    # Normal (SwiftShader) run
    probe(lambda: pw.chromium.launch(args=["--no-sandbox","--enable-unsafe-swiftshader"]), "NORMAL SwiftShader Chromium")
    # WebGL-blocked run to map the failure UX (consistent with no-GL device)
    probe(lambda: pw.chromium.launch(args=["--no-sandbox","--disable-webgl","--disable-software-rasterizer"]), "WEBGL-DISABLED (no GL)")

print("\nTOTAL ERRORS:", json.dumps(errs, indent=1))
