/* =============================================================================
 * APOLLO DESCENT — physics engine (engine.js)
 * -----------------------------------------------------------------------------
 * 3D lunar-lander physics (X / altitude Y / depth Z). Aim stick leans the nose
 * on a hemisphere so left/right/up/down/diagonal all steer — not a left-right rail.
 *
 * Attaches window.Apollo.Engine = { initialise, frame, touchdownCompress }.
 * ========================================================================== */
(function () {
  "use strict";

  window.Apollo = window.Apollo || {};
  var Engine = window.Apollo.Engine || (window.Apollo.Engine = {});

  var TS_DEFAULT = 1 / 60;

  function finite(v, fallback) {
    return isFinite(v) ? v : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* Unit thrust direction from stick (nx right, ny screen-down).
     Center / deadzone → upright. Edge → horizontal lean that way (diags OK). */
  function stickToDir(nx, ny) {
    var mag = Math.hypot(nx, ny);
    if (mag < 1e-6) return { x: 0, y: 1, z: 0, mag: 0 };
    var ux = nx / mag, uz = ny / mag;
    if (mag > 1) mag = 1;
    // Full stick = 90° from upright so any compass heading is reachable.
    var tilt = mag * (Math.PI * 0.5);
    var s = Math.sin(tilt), c = Math.cos(tilt);
    return { x: s * ux, y: c, z: s * uz, mag: mag };
  }

  function normalizeDir(dx, dy, dz) {
    var m = Math.hypot(dx, dy, dz);
    if (m < 1e-8) return { x: 0, y: 1, z: 0 };
    return { x: dx / m, y: dy / m, z: dz / m };
  }

  /* Total lean from upright (rad) — used for safe-landing + HUD. */
  function tiltFromUp(dir) {
    return Math.acos(clamp(dir.y, -1, 1));
  }

  Engine.initialise = function (state, lander, terrain, cfg) {
    var start = (state && state.start) ? state.start : { x: 0, z: 0, height: 120 };
    var sx = finite(start.x, 0);
    var sz = finite(start.z, 0);
    var sh = finite(start.height, 120);

    state.maxFuel = finite(cfg && cfg.maxFuel, state.maxFuel != null ? state.maxFuel : 100);

    state.altitude = Math.max(sh, 0);
    state.x = sx;
    state.z = sz;
    state.velocity = { x: 0, y: 0, z: 0 };
    // Nose upright; angle/bank kept for HUD + mesh (derived from thrust dir).
    state.dirX = 0; state.dirY = 1; state.dirZ = 0;
    state.angle = 0;
    state.bank = 0;
    state.tiltTotal = 0;

    var fuelMul = finite(cfg && cfg.fuelStartMul, 1);
    fuelMul = clamp(fuelMul, 0.35, 1);
    state.fuel = finite(state.maxFuel, 100) * fuelMul;
    state.thrust = 0;
    state.impact_speed = 0;
    state.status = 'playing';
    state.landed = false;
    state.conceded = false;
    state.touchdown_ok = false;
    // Fresh run hygiene: a new descent must not show the previous run's
    // failure reason (loop #2 fairness check surfaced this during proofing).
    state.crashReason = '';
    if (state.lastGraze) state.lastGraze = null;
    state._grazeShown = false;
    state.time = 0;
    state.t = 0;
    state.pad = null;

    try {
      var half = finite(cfg && cfg.LANDER_HALF, 1.6);
      var groundY = (terrain && terrain.heightAt) ? terrain.heightAt(sx, sz) : 0;
      if (!isFinite(groundY)) groundY = 0;
      lander.position.set(sx, groundY + state.altitude + half, sz);
      lander.rotation.set(0, 0, 0);
      lander.visible = true;
      if (lander.engineFlame) lander.engineFlame.visible = false;
      if (lander.bell && lander.bell.material && lander.bell.material.emissive) {
        lander.bell.material.emissive.setHex(0x000000);
      }
      touchdownCompress(lander, 0);
    } catch (e) { /* mesh optional */ }
  };

  Engine.frame = function (dt, input, state, lander, terrain, cfg) {
    var dts = clamp(finite(dt, TS_DEFAULT), 0, 1 / 15);
    var inp = input || {};
    var throttle = clamp(finite(inp.throttle, 0), 0, 1);
    var rotate = clamp(finite(inp.rotate, 0), -1, 1);
    var bankIn = clamp(finite(inp.bank, 0), -1, 1);
    var cf = cfg || window.Apollo.CFG || {};

    var GRAVITY   = finite(cf.GRAVITY, -4.5);
    var MAX_THRUST= finite(cf.MAX_THRUST, 10);
    var FUEL_RATE = finite(cf.FUEL_RATE, 2.0);
    var MAX_ROT   = finite(cf.MAX_ROT_RATE, 2.2);
    // Forgiving defaults — training should feel fair on phone.
    var SAFE_SPEED= finite(cf.SAFE_SPEED, 11.0);
    var SAFE_ANGLE= finite(cf.SAFE_ANGLE, 0.70);
    var HALF      = finite(cf.LANDER_HALF, 1.6);
    var MAX_FALL  = 16;

    state.time = (state.time || 0) + dts;
    state.t = state.time;

    var onGround = false;
    var collision = false;

    /* --- Aim: slew thrust direction toward stick hemisphere (full compass) --- */
    var dir = normalizeDir(
      finite(state.dirX, 0),
      finite(state.dirY, 1),
      finite(state.dirZ, 0)
    );

    if (inp.aimActive && typeof inp.aimNX === 'number' && typeof inp.aimNY === 'number') {
      var want = stickToDir(inp.aimNX, inp.aimNY);
      // Slew toward target dir at RCS rate (angle between vectors).
      var dot = clamp(dir.x * want.x + dir.y * want.y + dir.z * want.z, -1, 1);
      var sep = Math.acos(dot);
      var maxStep = MAX_ROT * dts;
      if (sep < 1e-5 || sep <= maxStep) {
        dir = want;
      } else {
        var t = maxStep / sep;
        // Simple nlerp then normalize (good enough at RCS step sizes).
        dir = normalizeDir(
          dir.x + (want.x - dir.x) * t,
          dir.y + (want.y - dir.y) * t,
          dir.z + (want.z - dir.z) * t
        );
      }
    } else if (Math.abs(rotate) > 1e-3 || Math.abs(bankIn) > 1e-3) {
      // Keyboard rate mode: A/D lean in X, Q/E lean in Z.
      var ang = finite(state.angle, 0) + rotate * MAX_ROT * dts;
      var bank = finite(state.bank, 0) + bankIn * MAX_ROT * dts;
      ang = clamp(ang, -Math.PI * 0.5, Math.PI * 0.5);
      bank = clamp(bank, -Math.PI * 0.5, Math.PI * 0.5);
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var cb = Math.cos(bank), sb = Math.sin(bank);
      dir = normalizeDir(-sa * cb, ca * cb, sb);
    } else {
      // Stick released with no keys → auto-level toward upright.
      // (Old behavior froze last lean; soft pad hits then failed as "tilted".)
      var upright = { x: 0, y: 1, z: 0 };
      var dotU = clamp(dir.x * upright.x + dir.y * upright.y + dir.z * upright.z, -1, 1);
      var sepU = Math.acos(dotU);
      var stepU = MAX_ROT * 0.85 * dts;
      if (sepU < 1e-4 || sepU <= stepU) {
        dir = upright;
      } else {
        var tu = stepU / sepU;
        dir = normalizeDir(
          dir.x + (upright.x - dir.x) * tu,
          dir.y + (upright.y - dir.y) * tu,
          dir.z + (upright.z - dir.z) * tu
        );
      }
    }

    state.dirX = dir.x; state.dirY = dir.y; state.dirZ = dir.z;
    // HUD angles: X-graph (legacy angle) + Y-graph (bank into depth).
    state.angle = Math.atan2(-dir.x, dir.y);
    state.bank = Math.atan2(dir.z, dir.y);
    state.tiltTotal = tiltFromUp(dir);

    /* --- Fuel --- */
    if (state.fuel > 0) {
      state.fuel -= throttle * FUEL_RATE * dts;
      if (state.fuel <= 0) {
        state.fuel = 0;
        throttle = 0;
      }
    } else {
      throttle = 0;
    }
    state.thrust = throttle;

    /* --- Acceleration along nose (+ gravity on Y) --- */
    var thrustMagnitude = throttle * MAX_THRUST;
    var ax = dir.x * thrustMagnitude;
    var ay = dir.y * thrustMagnitude + GRAVITY;
    var az = dir.z * thrustMagnitude;

    var vx = finite(state.velocity && state.velocity.x, 0) + ax * dts;
    var vy = finite(state.velocity && state.velocity.y, 0) + ay * dts;
    var vz = finite(state.velocity && state.velocity.z, 0) + az * dts;

    // Horizontal drag — phone-friendly; bleeds sideways drift before pad.
    var DRAG = 0.85;
    vx -= vx * DRAG * dts;
    vz -= vz * DRAG * dts;

    if (vy < -MAX_FALL) vy = -MAX_FALL;
    if (vy >  MAX_FALL) vy =  MAX_FALL;

    state.velocity = { x: vx, y: vy, z: vz };

    var px = finite(lander.position.x, state.x || 0) + vx * dts;
    var py = finite(lander.position.y, 0) + vy * dts;
    var pz = finite(lander.position.z, state.z || 0) + vz * dts;

    var groundY = 0;
    if (terrain && terrain.heightAt) {
      var gy = terrain.heightAt(px, pz);
      groundY = isFinite(gy) ? gy : 0;
    }
    var altitude = py - groundY - HALF;

    if (altitude <= 0) {
      altitude = 0;
      py = groundY + HALF;
      onGround = true;
      collision = true;

      // Vertical sink is the main kill; light horizontal skid is OK on soft gear.
      var horiz = Math.hypot(vx || 0, vz || 0);
      var safeSpeed = Math.abs(vy) <= SAFE_SPEED && horiz <= (SAFE_SPEED * 0.8);
      // Level = total lean from upright within SAFE_ANGLE (both axes).
      var safeTilt = state.tiltTotal <= SAFE_ANGLE;

      /* Find the actual landing pad under the ship — ANY pad on the terrain
         is a valid touchdown zone (dogfood loop #2, complaint #2). Previously
         this checked only the single pre-selected state.padTarget, so landing
         on any other visible pad crashed you ("MISSED PAD"). Now iterate all
         planet pads and reward with the pad you actually touched. */
      var padCandidates = [];
      if (state.padTarget) padCandidates.push(state.padTarget);
      if (cf.padDefs && cf.padDefs.length) {
        for (var pi = 0; pi < cf.padDefs.length; pi++) padCandidates.push(cf.padDefs[pi]);
      }
      if (terrain && terrain.pads && terrain.pads.length) {
        for (var ti = 0; ti < terrain.pads.length; ti++) padCandidates.push(terrain.pads[ti]);
      }
      if (cf.activePad) padCandidates.push(cf.activePad);

      var hitPad = null, bestPad = null, bestD = Infinity;
      for (var j = 0; j < padCandidates.length; j++) {
        var pc = padCandidates[j];
        if (!pc) continue;
        var pr = finite(pc.r, 8);
        var pdxj = px - finite(pc.x, 0);
        var pdzj = pz - finite(pc.z, 0);
        var d2 = pdxj * pdxj + pdzj * pdzj;
        // Extra rim forgiveness — phone depth perception is rough (tightened
        // from 3.6 -> 1.6 so a sloppy off-center slam now fails, per complaint #3).
        var padSlop = 1.6;
        if (d2 <= (pr + padSlop) * (pr + padSlop)) {
          if (!hitPad || d2 < bestD) { hitPad = pc; bestD = d2; }
        }
        // Track nearest pad regardless (for a clean "missed by" message).
        if (d2 < bestD) { bestD = d2; bestPad = pc; }
      }
      var onPad = !!hitPad;
      // Set the landing pad to the one actually touched so economy pays the
      // right pad's multiplier (not the pre-selected one).
      if (hitPad) {
        state.padTarget = {
          x: hitPad.x, z: hitPad.z || 0, r: finite(hitPad.r, 8),
          id: hitPad.id, name: hitPad.name,
          mult: hitPad.mult != null ? hitPad.mult : 1
        };
      }

      if (state.status !== 'landed' && state.status !== 'crashed') {
        state.impact_speed = Math.hypot(vx || 0, vy || 0, vz || 0);
        state.impact_vy = vy || 0;
        state.impact_horiz = horiz;
        state.landed = safeSpeed && safeTilt && onPad;
        state.touchdown_ok = state.landed;
        state.pad = onPad && hitPad
          ? { x: hitPad.x, z: hitPad.z || 0, r: finite(hitPad.r, 8), id: hitPad.id } : null;
        state.status = state.landed ? 'landed' : 'crashed';
        // Plain-English fail reason so "felt perfect" crashes are diagnosable.
        if (!state.landed) {
          var bits = [];
          if (!safeSpeed) {
            bits.push(Math.abs(vy) > SAFE_SPEED
              ? ('TOO FAST sink ' + Math.abs(vy).toFixed(1) + ' (limit ' + SAFE_SPEED.toFixed(1) + ')')
              : ('TOO FAST skim ' + horiz.toFixed(1)));
          }
          if (!safeTilt) {
            bits.push('TOO TILTED ' + (state.tiltTotal * 180 / Math.PI).toFixed(0)
              + '° (limit ' + (SAFE_ANGLE * 180 / Math.PI).toFixed(0) + '°)');
          }
          if (!onPad) {
            var missR = hitPad ? finite(hitPad.r, 8) : finite((state.padTarget && state.padTarget.r), 8);
            var refX = hitPad ? hitPad.x : (state.padTarget && state.padTarget.x) || 0;
            var refZ = hitPad ? (hitPad.z || 0) : ((state.padTarget && state.padTarget.z) || 0);
            var mdx = px - finite(refX, 0);
            var mdz = pz - finite(refZ, 0);
            var dist = Math.hypot(mdx, mdz);
            bits.push('MISSED PAD by ' + Math.max(0, dist - missR).toFixed(1) + ' m');
          }
          state.crashReason = bits.join(' · ');
        } else {
          state.crashReason = '';
        }
        state.velocity = { x: 0, y: 0, z: 0 };
        if (state.landed) {
          state.dirX = 0; state.dirY = 1; state.dirZ = 0;
          state.angle = 0; state.bank = 0; state.tiltTotal = 0;
        }
      }
    }

    state.altitude = altitude;
    state.x = px;
    state.z = pz;
    lander.position.set(px, py, pz);
    // Mesh: bank (X) then yaw-less pitch (Z) — matches stick lean.
    lander.rotation.x = state.bank;
    lander.rotation.z = state.angle;
    lander.rotation.y = 0;

    if (throttle > 0.001) {
      if (lander.engineFlame) lander.engineFlame.visible = true;
      if (lander.bell && lander.bell.material && lander.bell.material.emissive) {
        lander.bell.material.emissive.setHex(0x7a2a00);
      }
    } else {
      if (lander.engineFlame) lander.engineFlame.visible = false;
      if (lander.bell && lander.bell.material && lander.bell.material.emissive) {
        lander.bell.material.emissive.setHex(0x000000);
      }
    }

    return { onGround: onGround, collision: collision };
  };

  function touchdownCompress(lander, t) {
    if (!lander || !lander.legs) return;
    var e = clamp(finite(t, 1), 0, 1);
    var s = 1 - 0.25 * e;
    try { lander.legs.scale.y = s; } catch (err) { /* cosmetic */ }
  }
  Engine.touchdownCompress = touchdownCompress;
  Engine.stickToDir = stickToDir;
  Engine.version = '2.0.0-3d';
})();
