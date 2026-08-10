/* =============================================================================
 * APOLLO DESCENT — career / planets / pads / grades  (window.Apollo.Career)
 * -----------------------------------------------------------------------------
 * Progression spine:
 *   Pick PLANET → pick PAD (easy→hard) → land → GRADE → $ + XP → unlocks
 *   Level up enough → unlock next planet with more / harder pads.
 *
 * Pure data + math. Persistence lives in Economy (single save blob).
 * ==========================================================================*/
(function () {
  'use strict';
  window.Apollo = window.Apollo || {};
  if (window.Apollo.Career) return;

  /* --------------------------------------------------------------------------
   * Planets (levels). Each has gravity, visual seed/palette, and pad roster.
   * Pads: id, name, difficulty 1–5, radius (m), mult (pay), spawn offset,
   *        fuelBudget mult (lower = tighter), safeSpeed mult (lower = harder).
   * ------------------------------------------------------------------------*/
  var PLANETS = [
    {
      id: 'luna',
      name: 'LUNA',
      subtitle: 'EARTH\'S MOON',
      unlockLevel: 1,
      gravity: -4.5,
      seed: 1337,
      palette: {
        ground: ['#4a4540', '#5a544b', '#6a6258'],
        sky: 0x00040a,
        haze: 0x1a2030,
        beacon: 0x35ff9e,
        accent: '#9fd8ff'
      },
      desc: 'Low gravity training ground. Learn soft, level touchdowns.',
      pads: [
        // Pads fan out in XZ — farther spawn→pad hop = higher $ (see distancePayMult).
        { id: 'luna-train', name: 'TRAINING PAD', diff: 1, r: 13.5,
          x: 0, z: 0, spawnX: -28, spawnZ: 8, spawnH: 110, fuelMul: 1.0, safeMul: 1.38 },
        { id: 'luna-ridge', name: 'RIDGE OUTPOST', diff: 2, r: 9.0,
          x: 48, z: 44, spawnX: -22, spawnZ: -16, spawnH: 135, fuelMul: 0.95, safeMul: 1.18 },
        { id: 'luna-rim', name: 'CRATER RIM', diff: 3, r: 7.0,
          x: -52, z: 55, spawnX: 28, spawnZ: -24, spawnH: 150, fuelMul: 0.90, safeMul: 1.08 }
      ]
    },
    {
      id: 'mars',
      name: 'MARS',
      subtitle: 'THE RED PLANET',
      unlockLevel: 4,
      gravity: -6.2,
      seed: 4242,
      palette: {
        ground: ['#6b3420', '#8a4a28', '#a05830'],
        sky: 0x0a0402,
        haze: 0x3a1810,
        beacon: 0xff8844,
        accent: '#ffb080'
      },
      desc: 'Heavier pull. Less float, more authority. Pads get meaner.',
      pads: [
        { id: 'mars-base', name: 'OLYMPUS BASE', diff: 2, r: 10,
          x: 0, z: 0, spawnX: -38, spawnZ: 14, spawnH: 135, fuelMul: 0.95, safeMul: 1.12 },
        { id: 'mars-canyon', name: 'VALLES LIP', diff: 3, r: 7.2,
          x: 42, z: -50, spawnX: -20, spawnZ: 22, spawnH: 150, fuelMul: 0.90, safeMul: 1.05 },
        { id: 'mars-peak', name: 'THARSIS SPIRE', diff: 4, r: 5.8,
          x: -58, z: 48, spawnX: 30, spawnZ: -28, spawnH: 165, fuelMul: 0.84, safeMul: 0.98 },
        { id: 'mars-needle', name: 'NEEDLE DROP', diff: 5, r: 4.8,
          x: 78, z: 72, spawnX: -48, spawnZ: -40, spawnH: 180, fuelMul: 0.78, safeMul: 0.90 }
      ]
    },
    {
      id: 'titan',
      name: 'TITAN',
      subtitle: 'SATURN\'S HAZE',
      unlockLevel: 8,
      gravity: -2.9,
      seed: 7771,
      palette: {
        ground: ['#3a3428', '#4a4030', '#5a4e38'],
        sky: 0x08060e,
        haze: 0x2a2438,
        beacon: 0xa0e0ff,
        accent: '#c8b0ff'
      },
      desc: 'Floaty, thick haze. Easy to overshoot. Precision over power.',
      pads: [
        { id: 'titan-lake', name: 'METHANE DOCK', diff: 2, r: 11,
          x: 0, z: 0, spawnX: -36, spawnZ: 12, spawnH: 120, fuelMul: 0.94, safeMul: 1.15 },
        { id: 'titan-dune', name: 'DUNE SHELF', diff: 3, r: 7.5,
          x: 46, z: 52, spawnX: -16, spawnZ: -20, spawnH: 145, fuelMul: 0.88, safeMul: 1.05 },
        { id: 'titan-fissure', name: 'ICE FISSURE', diff: 4, r: 5.8,
          x: -50, z: -55, spawnX: 24, spawnZ: 26, spawnH: 160, fuelMul: 0.80, safeMul: 0.95 },
        { id: 'titan-razor', name: 'RAZOR SHELF', diff: 5, r: 4.6,
          x: 80, z: -70, spawnX: -52, spawnZ: 36, spawnH: 175, fuelMul: 0.72, safeMul: 0.88 }
      ]
    },
    {
      id: 'europa',
      name: 'EUROPA',
      subtitle: 'ICE MOON OF JUPITER',
      unlockLevel: 12,
      gravity: -3.6,
      seed: 9090,
      palette: {
        ground: ['#6a7888', '#7a8a9a', '#8a9aaa'],
        sky: 0x020408,
        haze: 0x102030,
        beacon: 0x66eeff,
        accent: '#a8e8ff'
      },
      desc: 'Icy, unforgiving. Tiny pads. Career finale for now.',
      pads: [
        { id: 'europa-lab', name: 'ICE LAB', diff: 3, r: 9,
          x: 0, z: 0, spawnX: -40, spawnZ: 16, spawnH: 140, fuelMul: 0.90, safeMul: 1.05 },
        { id: 'europa-ridge', name: 'LINEARAE', diff: 4, r: 6.2,
          x: 50, z: 48, spawnX: -20, spawnZ: -22, spawnH: 155, fuelMul: 0.82, safeMul: 0.95 },
        { id: 'europa-vent', name: 'VENT MOUTH', diff: 5, r: 5.0,
          x: -60, z: -52, spawnX: 28, spawnZ: 30, spawnH: 170, fuelMul: 0.74, safeMul: 0.88 },
        { id: 'europa-zero', name: 'ZERO MARGIN', diff: 5, r: 4.2,
          x: 88, z: 82, spawnX: -58, spawnZ: -48, spawnH: 190, fuelMul: 0.68, safeMul: 0.82 }
      ]
    }
  ];

  var XP_PER_LEVEL = 120;

  /* $ multiplier from horizontal spawn→pad distance (risk = reward). */
  function distancePayMult(pad) {
    if (!pad) return 1;
    var sx = pad.spawnX != null ? pad.spawnX : ((pad.x || 0) - 40);
    var sz = pad.spawnZ != null ? pad.spawnZ : 0;
    var dist = Math.hypot((pad.x || 0) - sx, (pad.z || 0) - sz);
    // ~32m → ×1.0 · ~70m → ×1.7 · ~110m → ×2.5 · ~160m → ×3.5
    var m = 0.65 + dist / 45;
    if (m < 1) m = 1;
    if (m > 5) m = 5;
    return Math.round(m * 10) / 10;
  }

  function padTripMeters(pad) {
    if (!pad) return 0;
    var sx = pad.spawnX != null ? pad.spawnX : ((pad.x || 0) - 40);
    var sz = pad.spawnZ != null ? pad.spawnZ : 0;
    return Math.round(Math.hypot((pad.x || 0) - sx, (pad.z || 0) - sz));
  }

  function planetById(id) {
    for (var i = 0; i < PLANETS.length; i++) {
      if (PLANETS[i].id === id) return PLANETS[i];
    }
    return PLANETS[0];
  }

  function padById(planet, padId) {
    var pads = (planet && planet.pads) || [];
    for (var i = 0; i < pads.length; i++) {
      if (pads[i].id === padId) return pads[i];
    }
    return pads[0] || null;
  }

  function levelFromXp(xp) {
    return 1 + Math.floor(Math.max(0, xp) / XP_PER_LEVEL);
  }

  function xpIntoLevel(xp) {
    var x = Math.max(0, xp);
    return x % XP_PER_LEVEL;
  }

  function isPlanetUnlocked(planet, careerLevel) {
    return careerLevel >= (planet.unlockLevel || 1);
  }

  /* Grade from impact speed, angle, fuel remaining %, time.
     Returns { letter, stars 0-3, mult, label }. */
  function gradeRun(run) {
    var r = run || {};
    if (!r.landed) {
      return { letter: 'F', stars: 0, mult: 0, label: 'FAIL' };
    }
    var cfg = r.cfg || {};
    var SAFE = (cfg.SAFE_SPEED != null) ? cfg.SAFE_SPEED : 11.0;
    var SAFE_A = (cfg.SAFE_ANGLE != null) ? cfg.SAFE_ANGLE : 0.70;
    var speed = Math.max(0, r.impact_speed || 0);
    // Prefer total 3D lean when present (both attitude graphs).
    var ang = (r.tiltTotal != null) ? Math.abs(r.tiltTotal)
      : Math.abs(r.angle != null ? r.angle : 0);
    var maxF = (r.maxFuel > 0) ? r.maxFuel : 100;
    var fuelPct = Math.max(0, Math.min(100, (r.fuel || 0) / maxF * 100));
    var time = r.time || 0;

    // Softness 0..1 (1 = butter)
    var soft = Math.max(0, Math.min(1, 1 - (speed / Math.max(SAFE, 0.01))));
    // Levelness 0..1
    var level = Math.max(0, Math.min(1, 1 - (ang / Math.max(SAFE_A, 0.01))));
    // Efficiency 0..1
    var eff = Math.max(0, Math.min(1, fuelPct / 100));
    // Time: sweet spot under ~40s for full, decay after
    var timeScore = time <= 0 ? 0.5 : Math.max(0, Math.min(1, (50 - time) / 40));

    var score = soft * 0.40 + level * 0.25 + eff * 0.20 + timeScore * 0.15;

    var letter, stars, mult, label;
    if (score >= 0.88) { letter = 'S'; stars = 3; mult = 1.75; label = 'PERFECT FLARE'; }
    else if (score >= 0.72) { letter = 'A'; stars = 3; mult = 1.40; label = 'EXCELLENT'; }
    else if (score >= 0.55) { letter = 'B'; stars = 2; mult = 1.15; label = 'SOLID'; }
    else if (score >= 0.38) { letter = 'C'; stars = 1; mult = 1.00; label = 'SCRAPED IN'; }
    else { letter = 'D'; stars = 1; mult = 0.85; label = 'BARELY'; }

    return {
      letter: letter, stars: stars, mult: mult, label: label,
      score: score, soft: soft, level: level, eff: eff
    };
  }

  /* XP award for a finished run. */
  function xpForRun(run, grade, pad) {
    if (!run || !run.landed) return 8; // participation / salvage XP
    var d = (pad && pad.diff) ? pad.diff : 1;
    var gMult = (grade && grade.mult) ? grade.mult : 1;
    return Math.round(28 * d * gMult + (grade && grade.stars ? grade.stars * 6 : 0));
  }

  /* Live danger envelope while flying — green/amber/red like sand stress. */
  function envelope(state, cfg) {
    var st = state || {};
    var cf = cfg || {};
    var SAFE = (cf.SAFE_SPEED != null) ? cf.SAFE_SPEED : 11.0;
    var SAFE_A = (cf.SAFE_ANGLE != null) ? cf.SAFE_ANGLE : 0.70;
    var maxFuel = (st.maxFuel > 0) ? st.maxFuel : 100;
    var vy = (st.velocity && st.velocity.y) || 0;
    var sink = Math.max(0, -vy); // downward rate
    var ang = (st.tiltTotal != null) ? Math.abs(st.tiltTotal) : Math.abs(st.angle || 0);
    var fuelPct = maxFuel > 0 ? (st.fuel || 0) / maxFuel : 0;
    var alt = st.altitude != null ? st.altitude : 999;

    function band(ratio) {
      // ratio 0 = safe, 1 = at limit, >1 over
      if (ratio < 0.55) return 'green';
      if (ratio < 0.90) return 'amber';
      return 'red';
    }

    var sinkRatio = sink / Math.max(SAFE, 0.01);
    var angRatio = ang / Math.max(SAFE_A, 0.01);
    // Fuel bingo: more urgent near ground with low fuel
    var fuelBand = 'green';
    if (fuelPct < 0.12) fuelBand = 'red';
    else if (fuelPct < 0.25) fuelBand = 'amber';
    // Near ground, tighten stress
    var near = alt < 40 ? 1.15 : 1.0;

    var worst = 'green';
    var bands = [band(sinkRatio * near), band(angRatio * near), fuelBand];
    if (bands.indexOf('red') >= 0) worst = 'red';
    else if (bands.indexOf('amber') >= 0) worst = 'amber';

    return {
      sink: band(sinkRatio * near),
      angle: band(angRatio * near),
      fuel: fuelBand,
      overall: worst,
      sinkRatio: sinkRatio,
      angRatio: angRatio,
      fuelPct: fuelPct,
      bingo: fuelPct < 0.18 && alt < 60
    };
  }

  var Career = {
    PLANETS: PLANETS,
    XP_PER_LEVEL: XP_PER_LEVEL,
    distancePayMult: distancePayMult,
    padTripMeters: padTripMeters,
    planetById: planetById,
    padById: padById,
    levelFromXp: levelFromXp,
    xpIntoLevel: xpIntoLevel,
    isPlanetUnlocked: isPlanetUnlocked,
    gradeRun: gradeRun,
    xpForRun: xpForRun,
    envelope: envelope,

    /* Apply planet physics onto CFG (gravity + palette tag). */
    applyPlanetToConfig: function (cfg, planet) {
      var c = cfg || window.Apollo.CFG || {};
      var p = planet || PLANETS[0];
      c.GRAVITY = p.gravity;
      c.planetId = p.id;
      c.planetName = p.name;
      c.seed = p.seed;
      c.palette = p.palette;
      return c;
    },

    /* Apply selected pad difficulty onto CFG + State spawn. */
    applyPadToConfig: function (cfg, state, pad) {
      var c = cfg || window.Apollo.CFG || {};
      var st = state || window.Apollo.State || {};
      var p = pad;
      if (!p) return { cfg: c, state: st };
      var payMult = distancePayMult(p);
      var tripM = padTripMeters(p);
      c.activePad = {
        id: p.id, name: p.name, x: p.x, z: p.z || 0, r: p.r,
        mult: payMult, diff: p.diff, tripM: tripM
      };
      // Softer house default; pad safeMul still scales difficulty.
      // Loop #2 (complaint #3): was 11.0 m/s / 0.70 rad (~40°) — you could slam
      // in sideways at speed and still "SAFE LANDING". Tightened to a real
      // lander feel: ~6.0 m/s sink and ~18° total lean. Legs upgrades still
      // raise safe speed, and pad safeMul keeps easy pads fair.
      c.baseSafeSpeed = (c.baseSafeSpeed != null) ? c.baseSafeSpeed : 6.0;
      c.baseSafeAngle = (c.baseSafeAngle != null) ? c.baseSafeAngle : 0.32;
      c._padSafeMul = (p.safeMul != null) ? p.safeMul : 1;
      c.SAFE_SPEED = c.baseSafeSpeed * c._padSafeMul;
      c.SAFE_ANGLE = c.baseSafeAngle * Math.min(1.15, c._padSafeMul);
      c.fuelStartMul = (p.fuelMul != null) ? p.fuelMul : 1;
      st.start = {
        x: p.spawnX != null ? p.spawnX : (p.x - 40),
        z: p.spawnZ != null ? p.spawnZ : 0,
        height: p.spawnH != null ? p.spawnH : 150
      };
      st.padTarget = {
        x: p.x, z: p.z || 0, r: p.r, id: p.id, name: p.name,
        mult: payMult, tripM: tripM
      };
      return { cfg: c, state: st };
    }
  };

  window.Apollo.Career = Career;
})();
