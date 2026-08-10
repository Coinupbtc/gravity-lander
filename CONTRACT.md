# APOLLO DESCENT — Module contract (READ THIS FIRST)

AAA-quality Lunar-Lander-style gravity landing game in **ThreeJS**. A single fleet/global
namespace `window.Apollo` is shared. Each module attaches its exports to it. Order of load in
index.html: three.min.js → terrain.js → lander.js → fx.js → engine.js → ui.js → game.js.

## Global namespace
```
window.Apollo = {}   // created by game.js initially; you may also create if absent
window.Apollo.State = { status:'boot', altitude:0, velocity:{x:0,y:0}, angle:0, fuel:100,
  thrust:0, landed:false, conceded:false, touchdown_ok:false, score:0, time:0,
  start:{x:0,z:0,height:120}, pad:null, t:0 }
```
Status values the game drives: 'menu' | 'playing' | 'landed' | 'crashed'.

## Engine constants (landing rules — shared by engine + game + ui)
```
window.Apollo.CFG = {
  GRAVITY: -9.8,            // m/s^2 (lunar: ~1.62, but use -1.62 * SCALE for realism)
  PHYS_SCALE: 1.0,          // meters per world unit
  MAX_THRUST: 28,           // m/s^2 acceleration at full thrust
  FUEL_RATE: 1.0,           // % per second at full thrust (linear)
  MAX_ROT_RATE: 2.2,        // rad/s
  SAFE_SPEED: 6.0,          // m/s vertical — safe to hard-land
  SAFE_ANGLE: 0.30,         // rad — safe tilt at touchdown
  LANDER_HALF: 1.6,         // leg-span half-width for ground contact
}
```

## Module APIs (implement exactly these)

### terrain.js → window.Apollo.Terrain
- `window.Apollo.Terrain.build(scene, cfg) → { groundMesh, pads:[{x,y,z}], heightAt(x,z) }`
  Creates the lunar surface (heightfield with craters/ridges/mountains), a starfield skybox and a
  distant Earth + Sun light. `heightAt(x,z)` must return the world Y of the ground at (x,z) so the
  engine can collide. Make one clearly marked landing pad (painted circle) near the origin.

### lander.js → window.Apollo.Lander
- `window.Apollo.Lander.build(scene) → obj` where `obj` is a THREE.Group with these children
  (engine relies on them): `obj.engineFlame` (THREE.Mesh, hidden by default), `obj.legs` (group,
  for slight compress on landing), `obj.bell` (engine bell). Build a beautiful, render-rich lander.

### fx.js → window.Apollo.FX
- `window.Apollo.FX.init(THREE)` — nothing
- `window.Apollo.FX.updateThrust(pos, dir, intensity, dt)` — exhaust plume
- `window.Apollo.FX.updateDust(pos, contactNormal, intensity, dt)` — landing dust kickup
- `window.Apollo.FX.spark(pos)` — crash/impact sparks

### engine.js → window.Apollo.Engine
- `window.Apollo.Engine.initialise(state, lander, terrain, cfg)`
- `window.Apollo.Engine.frame(dt, input, state, lander, terrain, cfg)` — advances physics one step.
  Writes back into `state` (altitude, velocity, angle, fuel, thrust, status, touchdown_ok),
  returns `{onGround:bool, collision:bool}`.
  `input = {throttle:0..1, rotate:-1..1}`.

### ui.js → window.Apollo.UI
- `window.Apollo.UI.init(container)` — build DOM HUD (telemetry panel, fuel bar, angle indicator,
  center marker).
- `window.Apollo.UI.update(state, cfg)` — refresh each frame.
- `window.Apollo.UI.showVerDct(state, goodLanding)` — overlay verdict (SAFE LANDING / CRASHED …).
- `window.Apollo.UI.showMenu(onStart)` — title + instructions.

### game.js → window.Apollo.Game
- `window.Apollo.Game.init(canvas)` — create renderer, scene, camera, call Terrain/Lander/FX/Engine/UI
  init, attach OrbitControls-equivalent (simple free camera), start rAF loop, hide #boot.
- `window.Apollo.Game.frame(t, dt)` — calls Engine.frame, syncs lander transform + FX + UI + camera.

## Style / quality bar (AAA — do not cut corners)
- Physical behaviour must FEEL right: gentle descent authority, responsive but not twitchy rotation.
- Visuals: rich lighting (HDR-ish hemisphere+sun), soft shadows, specular, glow on the flame,
  readable distinct terrain silhouettes, a gorgeous starfield. No flat unlit primitives.
- No console errors. Wrap in try/catch where risky. Guard against NaN in physics (clamp states).
- Use triangle count wisely (mobile-friendly-ish) but keep the lander beautifully detailed.
- deliverable quality bar: if it does not look and feel premium, keep improving.

## Integration rule
Do NOT edit index.html or other modules' files. Only write YOUR file. Keep variable names minimal
and attach only your single namespace object. If you need a helper another module might also need,
put it on window.Apollo.
```


## CAREER + ECONOMY (v2 — planets / pads / grades)

Load order: `career.js` → `economy.js` → `audio.js` → `ui.js` → `game.js`.

### career.js → `window.Apollo.Career`
- **PLANETS:** Luna → Mars (LV4) → Titan (LV8) → Europa (LV12). Each has gravity, seed, palette, pad roster.
- **Pads:** per-planet list with `diff`, radius `r`, pay `mult`, spawn, `fuelMul`, `safeMul` (easy→hard).
- **gradeRun / xpForRun / envelope:** S–F grades, XP, live green/amber/red stress (sand-style).
- **applyPlanetToConfig / applyPadToConfig:** gravity + active pad + spawn onto CFG/State.

### economy.js → `window.Apollo.Economy` (v2 save key `apollo_descent_economy_v2`, migrates v1)
- **Loop:** land → grade → $ + XP → streak → unlock planets → hangar shop.
- **Mission pay:** base bonuses × pad mult × grade mult. Crash salvage $15.
- **Shop:** tank, engine, **rcs** (MAX_ROT_RATE), **legs** (safe-speed mult). 5 levels each.
- **Selection:** `setSelection(planetId, padId)`; unlocks from career level (XP / 120).
- **Game wiring:** `Game.applyCareer` rebuilds terrain on planet change; engine wins only on `state.padTarget`.

### Controls (phone)
- **Thrust slider** (right): drag Y = throttle 0..1. **Tilt stick** (left): drag X = rotate −1..1.
- Keyboard W/A/S/D still works.

## AUDIO + CAMERA-FEEL LAYER (added 2026-08-09, AAA pass ~1)
- New `src/audio.js` -> `window.Apollo.Audio`: fully procedural WebAudio (no assets).
  Engine burn rides throttle each frame (setThrust), plus ignition/dust/thud/crash/beep/cash/refuel/beacon.
  iOS-safe: AudioContext unlocks on first user gesture (pointerdown/touchstart/keydown).
  Wired in game.js (thrust per-frame, ignition on start, thud/crash on collision, cash on landing pay)
  and ui.js (cash on shop buy, refuel on refuel bar, beep on menu start).
- Camera impact shake: game.js `impactShake(amount)` + decaying jitter in updateCamera (touchdown/crash).
- index.html loads audio.js before ui.js/game.js.
Still prioritized from freegle AAA audit (t_1d5774e1): bloom/glow (no EffectComposer in this Three build
-> additive halo sprites), atmosphere/fog, depth-of-field-free vignette, cinematic menu, etc.

## AAA AUDIT BATCH (freegle t_1d5774e1 feedback, implemented 2026-08-09)
- #1 sRGB pipeline FIXED: three is r128; game.js now uses renderer.outputEncoding=THREE.sRGBEncoding
  (was outputColorSpace/SRGBColorSpace = r152 API, silently ignored => whole scene linear/muddy).
  + tin terrain.js all 4 CanvasTextures now tex.encoding=THREE.sRGBEncoding. Big color-grade lift.
- #2 THRUST HUD FIXED: ui.js shows throttle*100 (was /MAX_THRUST => 7.5% at 75%).
- #3 verdict fuel FIXED: now fuel/maxFuel*100 (% of current tank).
- #6/#7 FX density FIXED: plume+dust emission now use remainder accumulators (plumeAcc/dustAcc);
  POOL 600->1200; denser emission; added additive engine-glow sprite (cheap warm 'bloom', r128-safe).
- #8 crash sparks one-shot FIXED (sparkFired guard).
- #9 terrain tiling reduced: ground texture 512->1024 canvas, repeat 64->28.
- #4 camera shake + #5 audio wiring were already landed earlier (see AUDIO layer note).
Remaining from audit (not yet done): #11 real bloom postprocess (needs r128 examples addons, risky),
#12 menu/HUD scene separation, #10 crater rim detail/blocks, sun-azimuth variation, ambient dust,
pre-landing cinematic beat.

## PLAYABILITY GATE (pre-user-session, 2026-08-09)
User: make it playable. tests/playability-final.py 8/8 PASS (boot,start,fly,crash,verdict,refuel+relaunch,zero errors). economy 19/19 PASS. Service active, :8070 200, binds 0.0.0.0 LAN.
