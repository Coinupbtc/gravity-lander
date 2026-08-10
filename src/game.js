/* ============================================================================
 * APOLLO DESCENT — game.js
 * ----------------------------------------------------------------------------
 * Game orchestration module. Owns the render loop, the input reading, the
 * master state machine, and the chase camera. Loaded LAST.
 *
 * Depends on (in load order):
 *   three.min.js → window.THREE
 *   terrain.js   → window.Apollo.Terrain  (.build(scene, cfg))
 *   lander.js    → window.Apollo.Lander   (.build(scene))
 *   fx.js        → window.Apollo.FX       (.init/.updateThrust/.updateDust/.spark)
 *   engine.js    → window.Apollo.Engine   (.initialise/.frame)
 *   ui.js        → window.Apollo.UI       (.init/.update/.showVerDct/.showMenu)
 *
 * Exposes (contract): window.Apollo.Game.init(canvas), .frame(t, dt)
 * ==========================================================================*/
(function () {
  'use strict';

  // Ensure shared namespace exists (other modules may create it too).
  if (!window.Apollo) window.Apollo = {};

  // ---------------------------------------------------------------------------
  // Shared config + runtime state (defined here so load order never matters).
  // Contract fields are documented in CONTRACT.md.
  // ---------------------------------------------------------------------------
  window.Apollo.CFG = window.Apollo.CFG || {
    GRAVITY: -4.5,   // ~2.8x lunar: snappy ~9s descent from 150m, arcade pacing
    PHYS_SCALE: 1.0,
    MAX_THRUST: 10,  // ~2.2x gravity: full-burn beats gravity decisively but is
                     //   controllable — digital hold-pad lander is now playable
    FUEL_RATE: 2.0,  // 100 fuel ~= 50s full burn: bounded tension (freegle P3: was 1.0 -> fuel never bound, 'no fuel = no thrust' was decorative)
    MAX_ROT_RATE: 2.2,
    // Landing tolerances — real lander feel (loop #2 complaint #3). Was 11.0 /
    // 0.70 rad (40°): you could crash fast and still land. Now ~6 m/s sink and
    // ~18° lean by default; pad safeMul + Legs upgrades soften easy pads.
    SAFE_SPEED: 6.0,
    SAFE_ANGLE: 0.32,
    LANDER_HALF: 1.6
  };
  if (!window.Apollo.State) {
    window.Apollo.State = {
      status: 'boot',
      altitude: 0,
      velocity: { x: 0, y: 0, z: 0 },
      angle: 0,
      bank: 0,
      dirX: 0, dirY: 1, dirZ: 0,
      tiltTotal: 0,
      fuel: 100,
      thrust: 0,
      landed: false,
      conceded: false,
      touchdown_ok: false,
      score: 0,
      time: 0,
      start: { x: -40, z: 0, height: 150 },
      pad: null,
      t: 0
    };
  }

  // ---------------------------------------------------------------------------
  // Local state the render loop & camera need (kept out of window.Apollo.State,
  // which is physics-owned).
  // ---------------------------------------------------------------------------
  var renderer = null;
  var scene = null;
  var camera = null;
  var landerObj = null;        // Lander.build THREE.Group
  var terrain = null;          // Terrain.build return
  var cfg = null;              // window.Apollo.CFG
  var rafId = 0;               // requestAnimationFrame id
  var lastTime = 0;            // ms of last frame, for dt computation
  var running = false;

  // Input state (read from keyboard each frame).
  var key = {
    up: false,    // W / ArrowUp — thrust
    down: false,  // S / ArrowDown — cut
    left: false,  // A / ArrowLeft — lean −X
    right: false, // D / ArrowRight — lean +X
    bankL: false, // Q — lean −Z
    bankR: false, // E — lean +Z
    restart: false
  };
  // Dual-stick analog (multi-touch): each finger tracked by pointerId.
  //   Left AIM: hemisphere lean (nx, ny) → full compass. Right BOOST: throttle 0..1.
  var analog = {
    throttle: 0,
    thrActive: false,
    thrId: null,
    aimActive: false,
    aimAngle: 0,
    aimX: 0,
    aimY: 0,
    rotId: null,
    rotate: 0,
    bank: 0
  };

  /* Controller options — invert axes + stick sensitivity (persisted). */
  var SETTINGS_KEY = 'apollo_descent_settings_v1';
  var settings = { invertX: false, invertY: false, sensitivity: 1.0 };
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw) || {};
      settings.invertX = !!d.invertX;
      settings.invertY = !!d.invertY;
      var s = Number(d.sensitivity);
      settings.sensitivity = (isFinite(s) && s >= 0.5 && s <= 1.6) ? s : 1.0;
    } catch (e) { /* private mode */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* */ }
  }
  function getSettings() { return settings; }
  function setSettings(patch) {
    if (!patch) return settings;
    if (typeof patch.invertX === 'boolean') settings.invertX = patch.invertX;
    if (typeof patch.invertY === 'boolean') settings.invertY = patch.invertY;
    if (typeof patch.sensitivity === 'number' && isFinite(patch.sensitivity)) {
      settings.sensitivity = Math.max(0.5, Math.min(1.6, patch.sensitivity));
    }
    saveSettings();
    return settings;
  }
  loadSettings();
  window.Apollo.Settings = { get: getSettings, set: setSettings, load: loadSettings };

  // Chase camera: orbital offset (phi, theta) + distance, with gentle lag.
  var cam = {
    target: new THREE.Vector3(0, 60, 0), // what we look at / follow (side-scroll origin)
    offset: new THREE.Vector3(),         // accumulated camera offset from target
    phi: 0.55,      // elevation from ground (rad)
    theta: Math.PI, // azimuth (rad) — faces the scene
    dist: 34,       // orbit distance
    lag: 0.06,      // follow smoothing factor (lower = more lag)
    // Player-controlled zoom (complaint #1): a 0.55..1.8 multiplier on top of
    // the altitude auto-distance. Reset to 1 on a fresh run for the cinematic
    // framing, then the player can zoom in/out freely (wheel / pinch).
    userZoom: 1,
    zoomClamp: [0.55, 1.8]
  };

  // Orbit finger is independent of AIM/BOOST pointerIds (true 3-finger multitask).
  var orbit = { active: false, id: null, lastX: 0, lastY: 0 };
  var touchMode = false;

  // Two-finger pinch-zoom tracking on the canvas (desktop wheel + touch pinch).
  // Kept independent of AIM/BOOST so flight controls never fight the camera.
  var pinch = { dist: 0, active: false };
  var pinchPts = {}; // pointerId -> {x,y}

  // Camera impact shake (decaying; added by touchdown/crash).
  var shakeMag = 0;
  function impactShake(amount) { shakeMag = Math.max(shakeMag, Math.min(amount, 12)); }
  // One-shot guard so crash sparks fire once (audit #8).
  var sparkFired = false;
  // One-shot guard for the terrain-graze thrill bonus (freegle idea #1).
  var grazeFired = false;
  // One-shot guard for the S-grade confetti burst (freegle idea #2).
  var celebrateFired = false;

  // Headless test hooks (see public API). testThrottleActive gates the override.
  var testThrottle = -1;
  var testThrottleActive = false;

  /* --------------------------------------------------------------------------
   * Boot sequence
   * ------------------------------------------------------------------------*/
  /* Apply career planet + pad + shop upgrades onto CFG/State and (re)build world. */
  function applyCareerToLive(rebuildTerrain) {
    cfg = window.Apollo.CFG || {};
    var eco = window.Apollo.Economy;
    var car = window.Apollo.Career;
    if (!eco || !car) {
      if (eco && eco.applyToConfig) eco.applyToConfig(cfg, eco.store.levels);
      return;
    }
    var planet = car.planetById(eco.planetId());
    var pad = car.padById(planet, eco.padId());
    car.applyPlanetToConfig(cfg, planet);
    cfg.padDefs = (planet.pads || []).map(function (p) {
      // Bake distance $ into padDefs so beacons/UI match pay.
      var m = car.distancePayMult ? car.distancePayMult(p) : (p.mult || 1);
      return { id: p.id, name: p.name, x: p.x, z: p.z || 0, r: p.r, mult: m, diff: p.diff };
    });
    // Pad difficulty first (sets SAFE_SPEED base * pad mul + spawn)
    car.applyPadToConfig(cfg, window.Apollo.State, pad);
    cfg._padSafeMul = pad && pad.safeMul != null ? pad.safeMul : 1;
    // Then shop upgrades (tank/engine/rcs/legs) on top
    eco.applyToConfig(cfg, eco.store.levels);
    window.Apollo.State.maxFuel = cfg.maxFuel != null ? cfg.maxFuel : 100;
    window.Apollo.State.planetName = planet.name;
    window.Apollo.State.padName = pad ? pad.name : 'PAD';

    // Drive the 3D lander upgrades from Economy state (loop #2 complaint #4):
    // tank/engine/rcs/legs levels push visible mesh. landerObj is null on the
    // very first call (before Lander.build), so guard here and re-run after
    // build in init().
    if (landerObj && window.Apollo.Lander && window.Apollo.Lander.updateUpgrades) {
      window.Apollo.Lander.updateUpgrades(eco.store.levels);
    }

    if (rebuildTerrain && scene && window.Apollo.Terrain) {
      // Keep lander; rebuild ground/pads for new planet palette + layout
      if (window.Apollo.Terrain.dispose) window.Apollo.Terrain.dispose(scene);
      terrain = window.Apollo.Terrain.build(scene, cfg);
      if (terrain && terrain.setActivePad && pad) terrain.setActivePad(pad.id);
    } else if (terrain && terrain.setActivePad && pad) {
      terrain.setActivePad(pad.id);
    }
    // Scene sky tint
    if (scene && planet.palette && planet.palette.sky != null) {
      scene.background = new THREE.Color(planet.palette.sky);
    }
  }

  function init(canvas) {
    try {
      cfg = window.Apollo.CFG || {};
      // Career + shop before first terrain build so pads/gravity match selection.
      applyCareerToLive(false);
      window.Apollo.State.maxFuel = cfg.maxFuel != null ? cfg.maxFuel : 100;
      scene = new THREE.Scene();
      var skyCol = (cfg.palette && cfg.palette.sky != null) ? cfg.palette.sky : 0x00040a;
      scene.background = new THREE.Color(skyCol);

      // --- Renderer (premium look: sRGB + ACES tone mapping + shadows) ---
      var cvs = canvas || document.getElementById('game') || undefined;
      // --- WebGL probe FIRST: if the device can't create a GL context we want
      // a real on-screen message, not a silent white/hang. Try webgl2 then
      // webgl1 on a throwaway canvas so three.js gets a context it can use.
      // (Root of the user's white screen: `new THREE.WebGLRenderer()` threw
      //  creating a context on real iOS Safari while headless SwiftShader
      //  passed — see CONTRACT PLAYABILITY GATE follow-up, 2026-08-09.)
      var glType = null;
      try {
        var probe = document.createElement('canvas');
        probe.width = 2; probe.height = 2;
        glType = probe.getContext('webgl2', { antialias:true })
          ? 'webgl2'
          : (probe.getContext('webgl', { antialias:true }) ? 'webgl' : null);
      } catch (e) { glType = null; }
      var rendererOpts = { antialias: true, powerPreference: glType === 'webgl2' ? 'default' : 'default' };
      if (cvs) rendererOpts.canvas = cvs;
      renderer = new THREE.WebGLRenderer(rendererOpts);
      // Guard: if three created a renderer but has no usable GL context, bail
      // cleanly to a visible error rather than an empty canvas.
      if (!renderer.getContext || !renderer.getContext()) {
        throw new Error('WebGL context could not be created on this device.');
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      // r128 API: outputEncoding (outputColorSpace/SRGBColorSpace are r152 and
      // silently ignored on this build). sRGB encoding lifts the whole color
      // grade from muddy linear to punchy/rich (freegle AAA audit #1).
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // Three r128 does not auto-append its canvas; put it in the DOM so the
      // render is visible and screenshottable.
      if (!renderer.domElement.parentNode) {
        document.body.appendChild(renderer.domElement);
      }

      // --- Camera ---
      camera = new THREE.PerspectiveCamera(
        55, window.innerWidth / window.innerHeight, 0.1, 6000
      );

      // --- Modules ---
      terrain = window.Apollo.Terrain.build(scene, cfg);
      landerObj = window.Apollo.Lander.build(scene);
      // CRITICAL: Lander.build() creates the group but never adds it to the
      // scene — the ship was invisible in every frame. Add it here.
      scene.add(landerObj);
      window.Apollo.FX.init(THREE);
      window.Apollo.FX.attach(scene);   // plant the plume/dust/spark pools — was never called
      // Mesh is finally built — apply stored Economy upgrade cosmetics to it
      // (loop #2 complaint #4; the earlier applyCareerToLive ran pre-build).
      if (window.Apollo.Lander && window.Apollo.Lander.updateUpgrades &&
          window.Apollo.Economy && window.Apollo.Economy.store) {
        window.Apollo.Lander.updateUpgrades(window.Apollo.Economy.store.levels);
      }
      window.Apollo.Engine.initialise(
        window.Apollo.State, landerObj, terrain, cfg
      );

      // Pre-place lander + camera at the spawn point.
      syncLander(0);
      // Start the chase cam behind / above the lander at spawn.
      var sp = window.Apollo.State.start || {};
      cam.target.set(sp.x || 0, (sp.height || 120) + 2, sp.z || 0);
      cam.phi = 0.55;
      cam.theta = Math.PI;
      // Altitude-scaled orbit distance (zooms in as you descend so the ship
      // fills the frame instead of being a 1-2% speck at dist 42).
      cam.dist = clamp(14 + ((sp.height || 120) * 0.12), 14, 42);
      cam.offset.copy(sphericalOffset(cam.phi, cam.theta, cam.dist));

      // Highlight selected pad pillars after first build
      if (terrain && terrain.setActivePad && cfg.activePad) {
        terrain.setActivePad(cfg.activePad.id);
      }

      // --- UI ---
      // UI.init builds HUD. UI.showMenu wires up its own start button.
      window.Apollo.UI.init(document.body);
      window.Apollo.UI.showMenu(function onStart() {
        startGame();
      });
      // Mobile touch controls (buttons rendered by ui.js, wired here into the
      // same key state the keyboard uses).
      wireTouchControls();

      // Career selection from menu → rebuild planet terrain if needed
      if (window.Apollo.UI && window.Apollo.UI.setCareerHandler) {
        window.Apollo.UI.setCareerHandler(function (planetId, padId) {
          var eco = window.Apollo.Economy;
          if (!eco || !eco.setSelection(planetId, padId)) return false;
          var prevPlanet = cfg && cfg.planetId;
          applyCareerToLive(prevPlanet !== planetId);
          return true;
        });
      }

      // The verdict RELAUNCH button (touch) restarts the run — on real iOS
      // Safari there is no keyboard R, so route taps to startGame().
      if (window.Apollo.UI && window.Apollo.UI.setReplayHandler) {
        window.Apollo.UI.setReplayHandler(function () { startGame(); });
      }
      // Verdict → MAIN MENU / OPTIONS (edit invert, sensitivity, pick pad).
      if (window.Apollo.UI && window.Apollo.UI.setMenuReturnHandler) {
        window.Apollo.UI.setMenuReturnHandler(function () {
          var st = window.Apollo.State;
          st.status = 'menu';
          st.landed = false;
          st.conceded = false;
          key = { up: false, down: false, left: false, right: false,
            bankL: false, bankR: false, restart: false };
          analog = {
            throttle: 0, thrActive: false, thrId: null,
            aimActive: false, aimAngle: 0, aimX: 0, aimY: 0,
            rotId: null, rotate: 0, bank: 0
          };
          if (window.Apollo.Audio && window.Apollo.Audio.setThrust) {
            window.Apollo.Audio.setThrust(0);
          }
          window.Apollo.UI.showMenu(function () { startGame(); });
        });
      }

      // --- Events ---
      window.addEventListener('resize', onResize);
      // iOS Safari fires orientationchange (not resize) on rotation; the URL
      // bar collapse also resizes the visual viewport without a resize event.
      window.addEventListener('orientationchange', onResize, false);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onResize);
      }
      window.addEventListener('keydown', onKeyDown, false);
      window.addEventListener('keyup', onKeyUp, false);
      window.addEventListener('mousedown', onMouseDown, false);
      window.addEventListener('mousemove', onMouseMove, false);
      window.addEventListener('mouseup', onMouseUp, false);
      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('touchstart', onTouchStart, { passive: false });
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd, false);
      if (canvas) {
        // Prevent context menu interfering with drag-orbit.
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        // Pointer orbit coexists with AIM/BOOST (each finger = own pointerId).
        wireOrbitPointers(canvas);
      }

      // --- Hide boot (mark healthy via watchdog if present, else manually) ---
      if (typeof window.__mark === 'function') {
        window.__mark();
      } else {
        var boot = document.getElementById('boot');
        if (boot) boot.classList.add('hidden');
        setTimeout(function () { if (boot && boot.parentNode) boot.parentNode.removeChild(boot); }, 900);
      }

      // --- Start the loop ---
      window.Apollo.State.status = 'menu';
      running = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    } catch (err) {
      console.error('[Apollo.Game] init failed:', err);
      // NO silent white screen: surface the real reason on-screen. The page's
      // boot overlay is black, so a bare log left the user staring at a dead /
      // blank screen when WebGL init failed on their device. Reuse the index
      // #fatal watchdog overlay (if present) to show exactly what broke.
      try {
        var _f = document.getElementById('fatal');
        var _msg = (err && err.message) ? err.message : String(err);
        if (_f) {
          _f.textContent = 'APOLLO DESCENT — COULD NOT START\n\n' + _msg + '\n\nIf you see this, your browser blocked WebGL.\nTry: close other tabs, then reload. Or open on a desktop browser.\n\n(If this persists, send this message to the dev.)';
          _f.style.display = 'block';
        }
        var _boot = document.getElementById('boot');
        if (_boot) { _boot.classList.add('hidden'); }
      } catch (e2) { /* ignore */ }
    }
  }

  /* --------------------------------------------------------------------------
   * Loop
   * ------------------------------------------------------------------------*/
  function loop(now) {
    if (!running) return;
    // Clamp dt to avoid physics tunneling on tab-switch / long stalls.
    var dtms = now - lastTime;
    lastTime = now;
    var dt = Math.min(dtms / 1000, 0.05);
    frame(dt, dt > 0.0001 ? dt : 0.0167);
    rafId = requestAnimationFrame(loop);
  }

  /* Contract entry used by tests / external drivers: frame(t, dt). */
  function frame(_t, dt) {
    try {
      var st = window.Apollo.State;

      // Restart is always checked (also from landed/crashed verdicts).
      handleRestart(st);

      // --- Read input (boost + aim are independent — multi-touch OK) ---
      var input = { throttle: 0, rotate: 0, bank: 0, aimActive: false, aimNX: 0, aimNY: 0 };
      var playing = st.status === 'playing';
      if (playing) {
        if (testThrottle >= 0 && testThrottleActive) {
          input.throttle = testThrottle;
        } else if (analog.thrActive) {
          var curT = st.thrust || 0;
          input.throttle = curT + (analog.throttle - curT) * Math.min(1, dt * 12);
        } else {
          input.throttle = smoothThrottle(key.up, key.down, dt);
        }
        if (analog.aimActive) {
          input.aimActive = true;
          // Apply invert + sensitivity (sens>1 reaches full lean sooner).
          var sx = analog.aimX * settings.sensitivity;
          var sy = analog.aimY * settings.sensitivity;
          if (settings.invertX) sx = -sx;
          if (settings.invertY) sy = -sy;
          var sm = Math.hypot(sx, sy);
          if (sm > 1) { sx /= sm; sy /= sm; }
          input.aimNX = sx;
          input.aimNY = sy;
        } else {
          if (key.left) input.rotate += 1;
          if (key.right) input.rotate -= 1;
          if (key.bankL) input.bank -= 1;
          if (key.bankR) input.bank += 1;
        }
      }
      // Live danger envelope for sand-style stress colors on the HUD
      if (playing && window.Apollo.Career && window.Apollo.Career.envelope) {
        st.envelope = window.Apollo.Career.envelope(st, cfg);
      }

      // --- Advance physics (engine owns the state machine transitions) ---
      var eng = window.Apollo.Engine;
      var res = eng.frame(dt, input, st, landerObj, terrain, cfg);

      // --- Audio: engine burn rides throttle every frame ---
      if (window.Apollo.Audio && window.Apollo.Audio.setThrust) {
        window.Apollo.Audio.setThrust(playing ? (st.thrust || 0) : 0);
      }

      // --- On collision, show the verdict overlay (landed/crashed) once. ---
      // P0 (freegle dogfood): UI.showVerDct was defined but never called, so on
      // mobile there was no verdict card and NO RELAUNCH button — iOS users were
      // stranded after a single run. Fire it the frame the run ends.
      if (res && res.collision &&
          (st.status === 'landed' || st.status === 'crashed') &&
          !st.touchdown_ok_verdict) {
        st.touchdown_ok_verdict = true; // guard: only award + show the card once
        // --- Audio: touchdown / crash hit cue ---
        if (window.Apollo.Audio) {
          if (st.landed === true) { window.Apollo.Audio.thud(true); window.Apollo.Audio.dust(); }
          else { window.Apollo.Audio.crash(); }
        }
        // --- Camera: impact shake (soft good land, heavy crash) ---
        impactShake(st.landed === true ? 1.5 : 7.0);
        // --- Mission pay + grade + XP + planet unlocks ---
        if (window.Apollo.Economy && window.Apollo.Economy.recordRun) {
          var padMult = (st.padTarget && st.padTarget.mult) || (cfg.activePad && cfg.activePad.mult) || 1;
          var grade = null;
          if (window.Apollo.Career && window.Apollo.Career.gradeRun) {
            grade = window.Apollo.Career.gradeRun({
              landed: st.landed === true,
              impact_speed: st.impact_speed != null ? st.impact_speed : 0,
              fuel: st.fuel != null ? st.fuel : 0,
              maxFuel: st.maxFuel != null ? st.maxFuel : 100,
              time: st.time != null ? st.time : 0,
              angle: st.angle != null ? st.angle : 0,
              tiltTotal: st.tiltTotal != null ? st.tiltTotal : 0,
              cfg: cfg
            });
          }
          st.lastReward = window.Apollo.Economy.recordRun({
            landed: st.landed === true,
            impact_speed: st.impact_speed != null ? st.impact_speed : 0,
            fuel: st.fuel != null ? st.fuel : 0,
            maxFuel: st.maxFuel != null ? st.maxFuel : 100,
            time: st.time != null ? st.time : 0,
            angle: st.angle != null ? st.angle : 0,
            tiltTotal: st.tiltTotal != null ? st.tiltTotal : 0,
            padMult: padMult,
            grade: grade,
            cfg: cfg
          });
          st.lastGrade = st.lastReward && st.lastReward.grade ? st.lastReward.grade : grade;
          // Perfect soft land: extra cinematic shake pulse + confetti fanfare
          if (st.landed === true && grade && grade.letter === 'S' && !celebrateFired) {
            celebrateFired = true;
            impactShake(2.2);
            if (window.Apollo.Audio && window.Apollo.Audio.celebrate) window.Apollo.Audio.celebrate();
            if (window.Apollo.FX && window.Apollo.FX.celebrate && landerObj) {
              window.Apollo.FX.celebrate(landerObj.position.clone());
            }
          }
          if (st.landed === true && window.Apollo.Audio && window.Apollo.Audio.cash) {
            window.Apollo.Audio.cash();
          }
        }
        if (window.Apollo.UI && window.Apollo.UI.showVerDct) {
          window.Apollo.UI.showVerDct(st, st.landed === true);
        }
      }
      if (res && !res.collision) st.touchdown_ok_verdict = false;

      // --- Sync lander transform to physics state ---
      syncLander(dt);

      // --- FX ---
      updateFX(dt, st, playing, res);

      // --- Additive-fun: low-altitude proximity ping (audio) + terrain-graze ---
      // Proximity beep (idea #4): escalate toward ground; game.js drives the
      // audio ping, ui.js renders the PULL-UP banner + red altitude flash.
      if (playing && window.Apollo.Audio && window.Apollo.Audio.proximity) {
        var sink = (st.velocity && st.velocity.y) || 0;
        var danger = (typeof st.altitude === 'number' && st.altitude < 25) && sink < -(cfg.SAFE_SPEED || 11);
        if (typeof st.altitude === 'number' && st.altitude < 25) {
          window.Apollo.Audio.proximity(st.altitude, danger);
        }
      }
      // Terrain-graze thrill bonus (idea #1, EXTREME fun-per-effort): one-shot
      // when skimming terrain (off the active pad) very low & fast without
      // touching down. Awards +$25 straight to the wallet + a verdict line.
      if (playing && !grazeFired && terrain && terrain.heightAt && st.padTarget) {
        var altNow = (typeof st.altitude === 'number') ? st.altitude : 999;
        var gx = (st.x != null) ? st.x : 0;
        var gz = (st.z != null) ? st.z : 0;
        var padC = st.padTarget;
        var gdx = gx - (padC.x || 0), gdz = gz - (padC.z || 0);
        var onPadDisk = (gdx * gdx + gdz * gdz) <= ((padC.r || 8) + 2) * ((padC.r || 8) + 2);
        var spd = Math.hypot((st.velocity && st.velocity.y) || 0, (st.velocity && st.velocity.x) || 0, (st.velocity && st.velocity.z) || 0);
        if (!onPadDisk && altNow < 7 && spd > 6) {
          grazeFired = true;
          if (window.Apollo.Audio && window.Apollo.Audio.graze) window.Apollo.Audio.graze();
          if (window.Apollo.Economy && window.Apollo.Economy.store) {
            window.Apollo.Economy.store.dollars = (window.Apollo.Economy.store.dollars || 0) + 25;
            window.Apollo.Economy.save();
          }
          st.lastGraze = { label: 'TERRAIN GRAZE', amount: 25 };
          impactShake(3.2);
        }
      }

      // --- UI ---
      if (window.Apollo.UI.update) window.Apollo.UI.update(st, cfg);

      // --- Pad beacon pulse (target marker) ---
      if (terrain && terrain.pillar) {
        var pulse = 0.5 + 0.5 * Math.sin((st.time || 0) * 2.6);
        terrain.pillar.material.opacity = 0.20 + 0.16 * pulse;  // ~0.20-0.36 beacon
        if (terrain.pillarLight) terrain.pillarLight.intensity = 1.2 + 1.0 * pulse;
      }

      // --- Camera ---
      updateCamera(dt);

      // --- Render ---
      renderer.render(scene, camera);
    } catch (err) {
      console.error('[Apollo.Game] frame error:', err);
      // Don't kill the loop on a single bad frame.
    }
  }

  /* --------------------------------------------------------------------------
   * Input helpers
   * ------------------------------------------------------------------------*/
  function smoothThrottle(up, down, dt) {
    var st = window.Apollo.State;
    var cur = st.thrust || 0;
    // Time-based ramp (freegle loop 1/2, 2026-08-07): was frame-based
    // (rate*0.02 per FRAME) -> difficulty was fps-dependent (0.08s at 120Hz,
    // ~1s at 9Hz headless). Now rate is per-second so ramp feel is identical
    // on every device. Also: RELEASE now cuts thrust (decay toward 0), matching
    // the touch pads — fixing desktop W-release-doesn't-cut (freegle P1).
    var rate = 5.0;                 // units per second
    var dts = (dt && dt > 0) ? Math.min(dt, 0.1) : 0.02;
    var next;
    if (up) {
      next = Math.min(1, cur + rate * dts);
    } else {
      // released or S/ArrowDown -> decay toward 0 (cut the burn)
      next = Math.max(0, cur - rate * dts);
    }
    return clamp01(next);
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function handleRestart(st) {
    if (key.restart && (st.status === 'landed' || st.status === 'crashed' ||
                        st.status === 'menu' || st.status === 'boot')) {
      key.restart = false;
      startGame();
    }
  }

  /* Contract-level restart: re-initialise physics and repaint verdict/HUD. */
  function startGame() {
    var st = window.Apollo.State;
    // Re-apply career pad/planet (no full rebuild) so selection + upgrades stick.
    applyCareerToLive(false);
    // --- Audio: ensure unlocked (first tap on iOS) + ignition whoosh ---
    if (window.Apollo.Audio) {
      window.Apollo.Audio.unlock();
      window.Apollo.Audio.ignition();
    }
    shakeMag = 0; // reset camera shake on a fresh run
    // One-shot thrill-guard + bonus resets (freegle loop-1 ideas #1/#2).
    grazeFired = false;
    celebrateFired = false;
    if (st) { st.lastGraze = null; st._grazeShown = false; }
    // Reset all input state on (re)start (freegle loop 1/2 P2): a crash while
    // holding THRUST/tilt used to leak that held key into the fresh run, so the
    // new run auto-burned / auto-tilted. Start every run clean.
    key = { up: false, down: false, left: false, right: false, restart: false };
    analog = {
      throttle: 0, thrActive: false, thrId: null,
      aimActive: false, aimAngle: 0, aimX: 0, aimY: 0, rotId: null, rotate: 0, bank: 0
    };
    testThrottleActive = false;
    window.Apollo.Engine.initialise(st, landerObj, terrain, cfg);
    syncLander(0.016);
    // Dismiss the menu overlay (otherwise it covers the 3D scene on start).
    if (window.Apollo.UI && window.Apollo.UI.hideMenu) {
      window.Apollo.UI.hideMenu();
    }
    // Force the touch pads on-screen from the first frame of the run so they
    // are findable/visible on real iOS Safari regardless of how fast the
    // run plays out (anti flash-and-vanish).
    if (window.Apollo.UI && window.Apollo.UI.showTouch) {
      window.Apollo.UI.showTouch(6000);
    }
    // Frame ship + active pad target in full XZ (pads are no longer on a rail).
    var sp = st.start || {};
    var shipX = (sp.x || 0);
    var shipZ = (sp.z || 0);
    var padX = (st.padTarget && st.padTarget.x != null) ? st.padTarget.x : 0;
    var padZ = (st.padTarget && st.padTarget.z != null) ? st.padTarget.z : 0;
    var shipAlt = (sp.height || 120);
    var midX = (shipX + padX) / 2;
    var midZ = (shipZ + padZ) / 2;
    cam.target.set(midX, 5 + shipAlt * 0.10, midZ);
    cam.theta = Math.PI;
    cam.phi = 0.92;
    cam.userZoom = 1; // fresh cinematic framing; player can re-zoom anytime
    cam.dist = clamp(18 + Math.hypot(shipX - padX, shipZ - padZ) * 0.45, 18, 58);
    if (window.Apollo.UI && window.Apollo.UI._clearVerdict) {
      window.Apollo.UI._clearVerdict();
    }
  }

  /* --------------------------------------------------------------------------
   * Lander transform sync
   *   x  = state.x        (physics-integrated horizontal position; falls back
   *                        to state.start.x only before the first frame)
   *   z  = state.start.z
   *   y  = ground height at (x,z) + altitude     (world up)
   *   rot.z = state.angle   (tilt, radians; positive = clockwise)
   * ------------------------------------------------------------------------*/
  function syncLander(dt) {
    var st = window.Apollo.State;
    if (!landerObj || !terrain) return;
    // P0 fix (freegle loop 1/2, 2026-08-07): v10 added lateral physics writing
    // State.x, but this sync kept pinning the mesh to state.start.x (-40) every
    // frame AFTER engine integrated position -> velocity accumulated but the
    // ship/camera never translated; the pad was unreachable. Use state.x.
    var x = (st.x != null) ? st.x : ((st.start && st.start.x) || 0);
    var z = (st.z != null) ? st.z : ((st.start && st.start.z) || 0);
    var groundY = terrain.heightAt(x, z);
    // Mirror engine.js:64 — the lander's origin is LANDER_HALF above the ground
    // (Engine.frame computes altitude = py - groundY - HALF). Omitting +HALF here
    // made syncLander sink the craft 1.6 m EVERY frame (fps-dependent phantom
    // altitude loss — fatal on real 60-120Hz iOS). P0 fix from freegle dogfood.
    var y = groundY + (st.altitude || 0) + (window.Apollo.CFG && window.Apollo.CFG.LANDER_HALF || 1.6);
    landerObj.position.set(x, y, z);
    if (typeof st.angle === 'number') landerObj.rotation.z = st.angle;
    if (typeof st.bank === 'number') landerObj.rotation.x = st.bank;
    landerObj.rotation.y = 0;
    // Feather the flame mesh so smoke/flame read-correctly (harmless if absent).
    if (landerObj.engineFlame) {
      var fl = landerObj.engineFlame;
      var thrustOn = !!st.thrust && st.thrust > 0.01 &&
        (st.status === 'playing');
      fl.visible = thrustOn;
      if (thrustOn) {
        // Scale with throttle + ~5 Hz flicker so the cone reads as a live flame.
        var flk = Math.sin(performance.now() * 0.045) * 0.10;
        var s = 0.8 + 0.9 * st.thrust;
        fl.scale.set(s, (0.8 + 1.4 * st.thrust) * (1 + flk), s);
      }
    }
  }

  /* --------------------------------------------------------------------------
   * FX wiring
   * ------------------------------------------------------------------------*/
  function updateFX(dt, st, playing, res) {
    var fx = window.Apollo.FX;
    if (!fx) return;
    // Age/move/fade all live particles (never called before — the plume
    // spawned but never animated). t is unused by pulse().
    if (fx.pulse) fx.pulse(0, dt);
    var intensity = st.thrust || 0;

    // Thrust plume from the bell, pointing down the -Y of the lander (which is
    // tilted by angle around Z).
    if (playing && intensity > 0.01 && landerObj && landerObj.bell) {
      var bellWorld = new THREE.Vector3();
      landerObj.bell.getWorldPosition(bellWorld);
      // Exhaust opposite the nose (dir is thrust; plume goes -dir).
      var dir = new THREE.Vector3(
        -(st.dirX != null ? st.dirX : Math.sin(st.angle || 0)),
        -(st.dirY != null ? st.dirY : Math.cos(st.angle || 0)),
        -(st.dirZ != null ? st.dirZ : 0)
      ).normalize();
      fx.updateThrust(bellWorld, dir, intensity, dt);
    }

    // Dust on touchdown / while settled with propulsion.
    if (res && res.onGround) {
      var groundY = landerObj.position.y;
      var contact = new THREE.Vector3(
        landerObj.position.x, groundY, landerObj.position.z
      );
      fx.updateDust(contact, new THREE.Vector3(0, 1, 0),
        st.status === 'playing' ? Math.max(0.25, intensity) : 0, dt);
    }

    // Sparks on crash — ONE burst on the transition frame (freegle AAA audit #8:
    // was re-firing every frame while status='crashed' = endless fountain).
    if (st.status === 'crashed' && !sparkFired) {
      sparkFired = true;
      fx.spark(landerObj.position.clone());
    }
    if (st.status !== 'crashed') sparkFired = false;
  }

  /* --------------------------------------------------------------------------
   * Chase camera — orbital with lag + manual drag.
   * Looks down the descent lane (negative Z toward origin by default, but kept
   * simple: we orbit the lander's position).
   * ------------------------------------------------------------------------*/
  function sphericalOffset(phi, theta, dist) {
    // phi: elevation from horizontal plane; theta: azimuth around Y
    var cosP = Math.cos(phi);
    return new THREE.Vector3(
      cosP * Math.sin(theta) * dist,
      Math.sin(phi) * dist,
      cosP * Math.cos(theta) * dist
    );
  }

  function updateCamera(dt) {
    if (!camera || !landerObj) return;
    // Follow target = lander position, plus a velocity feedforward so the
    // fast-descending ship stays centered instead of drifting below frame
    // under the follow lag (state.velocity.y is positive when descending).
    var st = window.Apollo.State;
    var lp = landerObj.position;
    var vLead = 0.14; // seconds of look-ahead
    var vy = (st && st.velocity && st.velocity.y) || 0;
    var vx = (st && st.velocity && st.velocity.x) || 0;
    var vz = (st && st.velocity && st.velocity.z) || 0;
    cam.target.x += ((lp.x + vx * vLead) - cam.target.x) * cam.lag;
    // freegle loop 2/2 #5/P3: bias the view aim DOWN toward the ground plane so
    // the target pad (on the ground ahead) stays in frame while the ship is up
    // high — previously the camera aimed at ship altitude and the pad sat below
    // the frame bottom. Bias shrinks as the ship nears touchdown.
    var alt = (st && typeof st.altitude === 'number') ? st.altitude : 0;
    var groundBias = 6 + alt * 0.10;             // ~21m at altitude 150, ~6 at ground
    cam.target.y += ((lp.y - vy * vLead - groundBias) - cam.target.y) * cam.lag;
    cam.target.z += ((lp.z + vz * vLead) - cam.target.z) * cam.lag;

    // Altitude-scaled orbit distance: zoom in as the lander descends so the
    // hero ship fills the frame at low altitude while staying contextual up
    // high. Render-only — physics untouched. Player wheel/pinch zoom multiplies
    // on top (clamped) so a manual zoom is never fought by the auto-follow.
    if (st && typeof st.altitude === 'number') {
      var auto = clamp(14 + st.altitude * 0.12, 14, 42);
      var uz = clamp(cam.userZoom || 1, cam.zoomClamp[0], cam.zoomClamp[1]);
      cam.dist = clamp(auto * uz, 8, 60);
    }

    // Lag the orbit offset slightly for a cinematic feel.
    var want = sphericalOffset(cam.phi, cam.theta, cam.dist);
    cam.offset.x += (want.x - cam.offset.x) * Math.min(1, 0.08 + dt * 2);
    cam.offset.y += (want.y - cam.offset.y) * Math.min(1, 0.08 + dt * 2);
    cam.offset.z += (want.z - cam.offset.z) * Math.min(1, 0.08 + dt * 2);

    camera.position.copy(cam.target).add(cam.offset);

    // --- Impact shake: decay mag, jitter the camera by it ---
    if (shakeMag > 0.01) {
      var s = shakeMag;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
      shakeMag *= Math.pow(0.0004, dt); // fast exponential decay
      if (shakeMag < 0.01) shakeMag = 0;
    }

    camera.lookAt(cam.target);
  }

  /* --------------------------------------------------------------------------
   * Events: keyboard + resize + orbit drag.
   * ------------------------------------------------------------------------*/
  function onResize() {
    if (!camera || !renderer) return;
    // iOS Safari: the dynamic URL bar shrinks the visual viewport without a
    // window resize event; prefer visualViewport dims so the renderer matches
    // what the user actually sees (fall back to innerWidth/Height).
    var w = (window.visualViewport && window.visualViewport.width) ?
      window.visualViewport.width : window.innerWidth;
    var h = (window.visualViewport && window.visualViewport.height) ?
      window.visualViewport.height : window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    // Re-assert pad visibility after any orientation change (iOS Safari).
    var ui = window.Apollo && window.Apollo.UI;
    if (ui && ui.update && window.Apollo.State) {
      ui.update(window.Apollo.State, window.Apollo.CFG);
    }
  }

  function onKeyDown(e) {
    var c = e.code || '';
    switch (c) {
      case 'KeyW': case 'ArrowUp':    key.up = true; break;
      case 'KeyS': case 'ArrowDown':  key.down = true; break;
      case 'KeyA': case 'ArrowLeft':  key.left = true; break;
      case 'KeyD': case 'ArrowRight': key.right = true; break;
      case 'KeyQ': key.bankL = true; break;
      case 'KeyE': key.bankR = true; break;
      case 'KeyR': case 'Space':      key.restart = true; break;
      default: break;
    }
  }
  function onKeyUp(e) {
    var c = e.code || '';
    switch (c) {
      case 'KeyW': case 'ArrowUp':    key.up = false; break;
      case 'KeyS': case 'ArrowDown':  key.down = false; break;
      case 'KeyA': case 'ArrowLeft':  key.left = false; break;
      case 'KeyD': case 'ArrowRight': key.right = false; break;
      case 'KeyQ': key.bankL = false; break;
      case 'KeyE': key.bankR = false; break;
      case 'KeyR': case 'Space':      key.restart = false; break;
      default: break;
    }
  }

  function onMouseDown(e) {
    // Desktop: free drag orbits (HUD / controls ignored via isControlTarget on touch path).
    if (isControlTarget(e.target)) return;
    if (orbit.active) return;
    orbit.active = true;
    orbit.id = 'mouse';
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
  }
  function onMouseMove(e) {
    if (!orbit.active || orbit.id !== 'mouse') return;
    // Camera orbit is allowed in EVERY state (menu / playing / landed / crashed)
    // — the player should always be able to look around and inspect the lander
    // (freegle dogfood loop #2, complaint #1). No status gate here.
    var dx = e.clientX - orbit.lastX;
    var dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    cam.theta -= dx * 0.005;
    cam.phi = clamp(cam.phi + dy * 0.004, 0.12, 1.45);
  }
  function onMouseUp() {
    if (orbit.id === 'mouse') { orbit.active = false; orbit.id = null; }
  }

  // Mouse wheel zoom (desktop) — scales the player zoom multiplier.
  function onWheel(e) {
    if (isControlTarget(e.target)) return;
    if (!cam) return;
    var f = (e.deltaY > 0) ? 1.08 : 0.92; // wheel down = zoom out
    cam.userZoom = clamp((cam.userZoom || 1) * f, cam.zoomClamp[0], cam.zoomClamp[1]);
    if (e.cancelable) e.preventDefault();
  }

  function isControlTarget(t) {
    if (!t || !t.closest) return false;
    return !!(t.closest('.apollo-touch') || t.closest('.apollo-verdict') ||
              t.closest('.apollo-menu') || t.closest('.apollo-shop') ||
              t.closest('.apollo-wallet') || t.closest('.apollo-options'));
  }

  /* Pointer-based orbit on the canvas — coexists with AIM + BOOST fingers. */
  function wireOrbitPointers(canvasEl) {
    if (!canvasEl || canvasEl._apolloOrbitWired) return;
    canvasEl._apolloOrbitWired = true;
    function orbitDown(ev) {
      if (isControlTarget(ev.target)) return;
      if (orbit.active) return;
      // Camera look/pan is allowed in EVERY state (menu / playing / landed /
      // crashed) — removed the old 'playing'-only gate (complaint #1).
      orbit.active = true;
      orbit.id = ev.pointerId;
      orbit.lastX = ev.clientX;
      orbit.lastY = ev.clientY;
      touchMode = (ev.pointerType === 'touch');
      try {
        if (canvasEl.setPointerCapture) canvasEl.setPointerCapture(ev.pointerId);
      } catch (err) { /* */ }
    }
    function orbitMove(ev) {
      // Two-finger pinch on the canvas zooms the camera (isolated from the
      // single-finger orbit so they never fight).
      if (ev.pointerType === 'touch') {
        pinchPts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        var ids = Object.keys(pinchPts);
        if (ids.length >= 2) {
          var a = pinchPts[ids[0]], b = pinchPts[ids[1]];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch.active && pinch.dist > 0) {
            var dz = (pinch.dist - d) / 80; // px -> zoom delta
            cam.userZoom = clamp((cam.userZoom || 1) * (1 + dz), cam.zoomClamp[0], cam.zoomClamp[1]);
          }
          pinch.dist = d;
          pinch.active = true;
        }
        // Orbit only while NOT pinching (1 finger tracked as orbit).
        if (ids.length > 1 && pinch.dist > 30) return;
      }
      if (!orbit.active || ev.pointerId !== orbit.id) return;
      var dx = ev.clientX - orbit.lastX;
      var dy = ev.clientY - orbit.lastY;
      orbit.lastX = ev.clientX;
      orbit.lastY = ev.clientY;
      cam.theta -= dx * 0.005;
      cam.phi = clamp(cam.phi + dy * 0.004, 0.12, 1.45);
      if (ev.cancelable) ev.preventDefault();
    }
    function orbitUp(ev) {
      delete pinchPts[ev.pointerId];
      pinch.active = false;
      pinch.dist = 0;
      if (orbit.id != null && ev.pointerId !== orbit.id) return;
      orbit.active = false;
      orbit.id = null;
    }
    canvasEl.addEventListener('pointerdown', orbitDown);
    canvasEl.addEventListener('pointermove', orbitMove);
    canvasEl.addEventListener('pointerup', orbitUp);
    canvasEl.addEventListener('pointercancel', orbitUp);
    canvasEl.addEventListener('lostpointercapture', orbitUp);
  }

  // Legacy touch listeners kept as no-ops for safety if something still fires them.
  function onTouchStart(e) { /* orbit is pointer-driven now */ }
  function onTouchMove(e) { /* orbit is pointer-driven now */ }
  function onTouchEnd() { /* orbit is pointer-driven now */ }

  /* --------------------------------------------------------------------------
   * Dual-stick multi-touch controls (TRUE two-finger):
   *   LEFT  AIM pad  — 360° nose aim (atan2). Independent pointerId.
   *   RIGHT BOOST    — vertical throttle 0..1. Independent pointerId.
   * NEVER gate on isPrimary — that killed multi-touch (2nd finger ignored).
   * ------------------------------------------------------------------------*/
  function wireTouchControls() {
    var ui = window.Apollo.UI;
    if (!ui || !ui._els) return;
    var e = ui._els;

    function clientXY(ev) {
      // PointerEvent has clientX/Y per finger. Do NOT use touches[0] (wrong finger).
      if (ev.clientX != null && ev.clientY != null) {
        return { x: ev.clientX, y: ev.clientY };
      }
      if (ev.touches && ev.touches.length) {
        return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
      }
      return null;
    }

    /* --- RIGHT: BOOST slider (vertical only) --- */
    var thrTrack = e.thrTrack || e.tt;
    if (thrTrack) {
      function thrFromEvent(ev) {
        var rect = thrTrack.getBoundingClientRect();
        var p = clientXY(ev);
        var clientY = p ? p.y : rect.bottom;
        // Top = full thrust, bottom = cut
        var t = 1 - ((clientY - rect.top) / Math.max(1, rect.height));
        return clamp(t, 0, 1);
      }
      function thrDown(ev) {
        // Accept second finger: only reject if this control already has another id
        if (analog.thrId != null && analog.thrId !== ev.pointerId) return;
        if (ev.cancelable) ev.preventDefault();
        ev.stopPropagation();
        analog.thrId = ev.pointerId;
        analog.thrActive = true;
        analog.throttle = thrFromEvent(ev);
        thrTrack.classList.add('pressed');
        if (e.thrFill) e.thrFill.style.height = (analog.throttle * 100).toFixed(0) + '%';
        if (thrTrack.setPointerCapture && ev.pointerId != null) {
          try { thrTrack.setPointerCapture(ev.pointerId); } catch (err) { /* */ }
        }
      }
      function thrMove(ev) {
        if (!analog.thrActive || ev.pointerId !== analog.thrId) return;
        if (ev.cancelable) ev.preventDefault();
        analog.throttle = thrFromEvent(ev);
        if (e.thrFill) e.thrFill.style.height = (analog.throttle * 100).toFixed(0) + '%';
      }
      function thrUp(ev) {
        if (analog.thrId != null && ev.pointerId !== analog.thrId) return;
        analog.thrActive = false;
        analog.thrId = null;
        analog.throttle = 0;
        thrTrack.classList.remove('pressed');
        if (e.thrFill) e.thrFill.style.height = '0%';
        key.up = false; key.down = true;
      }
      thrTrack.addEventListener('pointerdown', thrDown);
      thrTrack.addEventListener('pointermove', thrMove);
      thrTrack.addEventListener('pointerup', thrUp);
      thrTrack.addEventListener('pointercancel', thrUp);
      thrTrack.addEventListener('lostpointercapture', thrUp);
    }

    /* --- LEFT: AIM stick — full 360° (point nose any direction) --- */
    var aimPad = e.tiltStick || e.touchL;
    if (aimPad) {
      function aimFromEvent(ev) {
        var rect = aimPad.getBoundingClientRect();
        var p = clientXY(ev);
        var cx = rect.left + rect.width * 0.5;
        var cy = rect.top + rect.height * 0.5;
        var dx = (p ? p.x : cx) - cx;
        var dy = (p ? p.y : cy) - cy;
        var nx = dx / Math.max(1, rect.width * 0.5);
        var ny = dy / Math.max(1, rect.height * 0.5);
        var mag = Math.hypot(nx, ny);
        var dead = 0.16;
        // Deadzone = upright (still "active" while finger down so RCS holds level).
        if (mag < dead) {
          return { active: true, angle: 0, nx: 0, ny: 0, mag: 0, upright: true };
        }
        if (mag > 1) { nx /= mag; ny /= mag; mag = 1; }
        // Hemisphere lean: stick compass → full XZ thrust, diags included.
        var angle = Math.atan2(-nx, -ny);
        return { active: true, angle: angle, nx: nx, ny: ny, mag: mag, upright: false };
      }
      function aimDown(ev) {
        if (analog.rotId != null && analog.rotId !== ev.pointerId) return;
        if (ev.cancelable) ev.preventDefault();
        ev.stopPropagation();
        analog.rotId = ev.pointerId;
        var a = aimFromEvent(ev);
        analog.aimActive = true;
        analog.aimAngle = a.angle;
        analog.aimX = a.nx;
        analog.aimY = a.ny;
        aimPad.classList.add('pressed');
        if (e.tiltKnob) {
          var px = a.nx * 34, py = a.ny * 34;
          e.tiltKnob.style.transform = 'translate(' + px.toFixed(0) + 'px,' + py.toFixed(0) + 'px)';
        }
        if (aimPad.setPointerCapture && ev.pointerId != null) {
          try { aimPad.setPointerCapture(ev.pointerId); } catch (err) { /* */ }
        }
      }
      function aimMove(ev) {
        if (ev.pointerId !== analog.rotId) return;
        if (ev.cancelable) ev.preventDefault();
        var a = aimFromEvent(ev);
        analog.aimActive = true;
        analog.aimAngle = a.angle;
        analog.aimX = a.nx;
        analog.aimY = a.ny;
        if (e.tiltKnob) {
          e.tiltKnob.style.transform =
            'translate(' + (analog.aimX * 34).toFixed(0) + 'px,' + (analog.aimY * 34).toFixed(0) + 'px)';
        }
      }
      function aimUp(ev) {
        if (analog.rotId != null && ev.pointerId !== analog.rotId) return;
        analog.aimActive = false;
        analog.rotId = null;
        analog.aimX = 0;
        analog.aimY = 0;
        aimPad.classList.remove('pressed');
        if (e.tiltKnob) e.tiltKnob.style.transform = 'translate(0,0)';
        key.left = false; key.right = false;
      }
      aimPad.addEventListener('pointerdown', aimDown);
      aimPad.addEventListener('pointermove', aimMove);
      aimPad.addEventListener('pointerup', aimUp);
      aimPad.addEventListener('pointercancel', aimUp);
      aimPad.addEventListener('lostpointercapture', aimUp);
    }
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ---------------------------------------------------------------------------
  // Public API — window.Apollo.Game
  // ---------------------------------------------------------------------------
  window.Apollo.Game = {
    init: init,
    frame: frame,
    applyCareer: applyCareerToLive,
    // Test / headless hooks (used by the visual-critic harness).
    __startForTest: function () { startGame(); },
    __setThrottle: function (t) { testThrottle = t; },
    __setThrottleActive: function (a) { testThrottleActive = !!a; },
    // Test hook — drive the orbit/zoom directly so the proof harness can
    // capture a deterministically angled / zoomed camera frame.
    __setCamera: function (o) {
      if (!o) return;
      if (typeof o.theta === 'number') cam.theta = o.theta;
      if (typeof o.phi === 'number') cam.phi = clamp(o.phi, 0.12, 1.45);
      if (typeof o.zoom === 'number') cam.userZoom = clamp(o.zoom, cam.zoomClamp[0], cam.zoomClamp[1]);
    },
    __getCamera: function () { return { theta: cam.theta, phi: cam.phi, zoom: cam.userZoom }; },
    // Test hook — force the active target pad (by index in the planet roster)
    // and (re)start a run there, so the proof harness can show a touchdown on
    // a NON-first pad (multi-pad fix, complaint #2). Returns the pad or null.
    __setActivePadByIndex: function (idx) {
      var st = window.Apollo.State;
      var eco = window.Apollo.Economy;
      var car = window.Apollo.Career;
      if (!eco || !car) return null;
      var planet = car.planetById(eco.planetId());
      var pads = planet && planet.pads;
      if (!pads || !pads.length) return null;
      var pad = pads[Math.max(0, Math.min(pads.length - 1, idx))];
      car.applyPadToConfig(cfg, st, pad);
      applyCareerToLive(false);
      startGame();
      return { id: pad.id, name: pad.name, x: pad.x, z: pad.z, r: pad.r };
    },
    // Test hook — set Economy upgrade levels and re-render the ship, so the
    // harness can show the visually-upgraded lander (complaint #4).
    __setUpgradeLevels: function (lv) {
      var eco = window.Apollo.Economy;
      if (!eco) return null;
      eco.store.levels = {
        tank: lv.tank != null ? lv.tank : 0,
        engine: lv.engine != null ? lv.engine : 0,
        rcs: lv.rcs != null ? lv.rcs : 0,
        legs: lv.legs != null ? lv.legs : 0
      };
      eco.save && eco.save();
      applyCareerToLive(false);
      if (window.Apollo.Lander && window.Apollo.Lander.updateUpgrades) {
        window.Apollo.Lander.updateUpgrades(eco.store.levels);
      }
      return eco.store.levels;
    },
    // Test hook — teleport the lander above a roster pad and give it a gentle
    // controlled descent velocity, so the harness can prove a fair touchdown
    // on ANY pad (complaint #2). padIndex uses the planet's pad list.
    __placeAbovePad: function (padIndex, alt, vy) {
      var st = window.Apollo.State;
      var eco = window.Apollo.Economy;
      var car = window.Apollo.Career;
      if (!eco || !car || !terrain) return null;
      var planet = car.planetById(eco.planetId());
      var pads = planet && planet.pads;
      if (!pads || !pads.length) return null;
      var pad = pads[Math.max(0, Math.min(pads.length - 1, padIndex || 0))];
      var groundY = terrain.heightAt(pad.x, pad.z || 0);
      var a = (alt != null) ? alt : 10;
      var v = (vy != null) ? vy : -1.5;
      window.Apollo.Engine.initialise(st, landerObj, terrain, cfg);
      // Aim toward / directly over the pad, upright, and CRITICALLY move the
      // lander MESH there too — engine.frame integrates from lander.position,
      // so leaving it at the old spawn made the descent take forever.
      var half = window.Apollo.CFG && window.Apollo.CFG.LANDER_HALF || 1.6;
      var groundY = terrain.heightAt(pad.x, pad.z || 0);
      st.start.x = pad.x; st.start.z = pad.z || 0; st.start.height = a;
      st.x = pad.x; st.z = pad.z || 0;
      st.altitude = a;
      st.velocity = { x: 0, y: v, z: 0 };
      st.status = 'playing';
      st.landed = false;
      // snap the mesh above the pad so the next physics step is a short fall
      landerObj.position.set(pad.x, groundY + a + half, pad.z || 0);
      landerObj.rotation.set(0, 0, 0);
      landerObj.visible = true;
      if (landerObj.engineFlame) landerObj.engineFlame.visible = false;
      return { id: pad.id, name: pad.name, x: pad.x, z: pad.z, r: pad.r, altitude: a, vy: v };
    },
    _getScene: function () { return scene; },
    _getRenderer: function () { return renderer; },
    _stop: function () { running = false; }
  };

  // ---- Auto-bootstrap -------------------------------------------------
  // index.html loads scripts at the end of <body>, so the DOM is ready. Kick off.
  function boot() {
    try {
      if (window.Apollo.GameInitDone) return;
      window.Apollo.GameInitDone = true;
      window.Apollo.Game.init();
    } catch (e) {
      console.error('[Apollo] bootstrap failed:', e);
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
