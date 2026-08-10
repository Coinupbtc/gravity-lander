#!/usr/bin/env python3
"""Headless screenshot harness for APOLLO DESCENT (ThreeJS game).
Serves the project dir, opens it in Playwright chromium, captures shots,
prints JS console errors + telemetry. Powers the harsh-critic loop.
"""
import argparse, http.server, os, socketserver, subprocess, threading, json, sys

ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def log_message(self, *a):
        pass

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

def serve(port=8777):
    httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return port

def run(shots, outdir, port, timeout, seed):
    serve(port)
    base = "http://127.0.0.1:%d/" % port
    js = r'''
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox','--force-color-profile=srgb','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE '+m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR '+e.message));
  const shots = __SHOTS__;
  const outdir = __OUTDIR__;
  const seed = __SEED__;
  const base = __BASE__;
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  // inject test helpers
  await page.evaluate(() => {
    window.__test = {
      start: () => { const g = window.Apollo && window.Apollo.Game;
        g.__setThrottleActive(true); g.__setThrottle(0.55); g.__startForTest(); },
      fly: (t) => { const g = window.Apollo && window.Apollo.Game; g.__setThrottleActive(true); g.__setThrottle(t); },
      die: () => { const g = window.Apollo && window.Apollo.Game; g.__setThrottle(0); g.__setThrottleActive(false); }
    };
  });
  for (const s of shots) {
    try {
      if (s.action === 'menu') {
        await page.waitForTimeout(600);
      } else if (s.action === 'fly') {
        await page.evaluate(() => window.__test.start());
        await page.waitForTimeout(400);
        await page.evaluate(() => window.__test.fly(0.75));
        await page.waitForTimeout(2800);
        await page.evaluate(() => window.__test.die());
      } else if (s.action === 'land') {
        await page.waitForTimeout(1200);
      } else if (s.action === 'wait') {
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: outdir + '/' + s.name });
    } catch (e) { errors.push('SHOT '+s.name+' '+e.message); }
  }
  const telem = await page.evaluate(() => {
    if (!window.Apollo || !window.Apollo.State) return null;
    const st = window.Apollo.State;
    return { status: st.status, altitude: st.altitude, velocity: st.velocity,
             angle: st.angle, fuel: st.fuel, thrust: st.thrust };
  });
  console.log('__TELEM__' + JSON.stringify(telem));
  console.log('__ERRORS__' + JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
'''
    js = js.replace('__SHOTS__', json.dumps(shots))
    js = js.replace('__OUTDIR__', json.dumps(outdir))
    js = js.replace('__SEED__', str(seed))
    js = js.replace('__BASE__', json.dumps(base))
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=timeout)
    print(out.stdout)
    if out.stderr:
        print(out.stderr, file=sys.stderr)
    if out.returncode != 0:
        print('NODE_EXIT', out.returncode, file=sys.stderr)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--shots', default='menu:menu.png,fly:flight.png,land:land.png')
    ap.add_argument('--out', default='/tmp/apollo_shots')
    ap.add_argument('--port', type=int, default=8777)
    ap.add_argument('--timeout', type=int, default=120)
    ap.add_argument('--seed', type=int, default=7)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    shots = [{'action': a, 'name': n} for a, n in (x.split(':') for x in args.shots.split(','))]
    run(shots, args.out, args.port, args.timeout, args.seed)
