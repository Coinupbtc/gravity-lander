/* =============================================================================
 * APOLLO DESCENT — economy / progression meta-layer  (window.Apollo.Economy)
 * -----------------------------------------------------------------------------
 *   LAND → GRADE → $ + XP → streak → unlock planets → shop upgrades
 * Persistence: localStorage key `apollo_descent_economy_v2` (migrates v1).
 * ==========================================================================*/
(function () {
  'use strict';
  window.Apollo = window.Apollo || {};
  if (window.Apollo.Economy && window.Apollo.Economy.__v2) return;

  var STORAGE_KEY = 'apollo_descent_economy_v2';
  var STORAGE_KEY_V1 = 'apollo_descent_economy_v1';

  /* Upgrade catalog — priced so ~1 solid training land ≈ L1, mid pads ≈ L2+. */
  var CATALOG = {
    tank: {
      id: 'tank', label: 'FUEL TANK',
      values: [100, 140, 185, 240, 320],
      costs: [0, 200, 450, 950, 1900],
      desc: 'Bigger tank = more fuel reserve per descent.\nMore margin to cancel drift and flare late.'
    },
    engine: {
      id: 'engine', label: 'MAIN ENGINE',
      values: [1.0, 1.25, 1.5, 1.8, 2.2],
      costs: [0, 220, 500, 1050, 2100],
      desc: 'Bigger engine = stronger thrust.\nClimbs and brakes against gravity with more authority.'
    },
    rcs: {
      id: 'rcs', label: 'RCS THRUSTERS',
      values: [2.2, 2.6, 3.0, 3.5, 4.2],
      costs: [0, 180, 420, 900, 1800],
      desc: 'Faster, snappier rotation.\nLine up with the pad before you run out of sky.'
    },
    legs: {
      id: 'legs', label: 'LANDING GEAR',
      values: [1.0, 1.12, 1.25, 1.40, 1.60],
      costs: [0, 220, 520, 1100, 2200],
      desc: 'Shock-absorbing legs raise safe touchdown speed.\nForgives a slightly harder flare.'
    }
  };
  var MAX_LEVEL = 4;

  function costToLevel(item, targetLevel) {
    var cur = Math.max(0, targetLevel);
    var total = 0;
    for (var i = 1; i <= Math.min(cur, MAX_LEVEL); i++) total += (item.costs[i] || 0);
    return total;
  }

  function nextCost(item, currentLevel) {
    var n = (currentLevel || 0) + 1;
    if (n > MAX_LEVEL) return -1;
    return item.costs[n] || 0;
  }

  function maxFuelAt(level) {
    var L = Math.max(0, Math.min(level || 0, MAX_LEVEL));
    return CATALOG.tank.values[L];
  }
  function thrustMultAt(level) {
    var L = Math.max(0, Math.min(level || 0, MAX_LEVEL));
    return CATALOG.engine.values[L];
  }
  function rotRateAt(level) {
    var L = Math.max(0, Math.min(level || 0, MAX_LEVEL));
    return CATALOG.rcs.values[L];
  }
  function legsSafeMultAt(level) {
    var L = Math.max(0, Math.min(level || 0, MAX_LEVEL));
    return CATALOG.legs.values[L];
  }

  /* Mission pay — soft bonus is relative (not raw SAFE×15, which exploded pay).
     Target: solid training land ≈ $200–350 → buy L1; far pads + grade fund L2+. */
  function reward(runResult) {
    var r = runResult || {};
    var cfg = r.cfg || window.Apollo.CFG || {};
    var SAFE = (cfg.SAFE_SPEED != null) ? cfg.SAFE_SPEED : 9.5;
    var fuel = (typeof r.fuel === 'number') ? Math.max(0, r.fuel) : 0;
    var maxFuel = (typeof r.maxFuel === 'number' && r.maxFuel > 0) ? r.maxFuel : 100;
    var time = (typeof r.time === 'number') ? r.time : 0;
    var speed = (typeof r.impact_speed === 'number') ? r.impact_speed : 0;
    var padMult = (typeof r.padMult === 'number' && r.padMult > 0) ? r.padMult : 1;
    var gradeMult = (r.grade && r.grade.mult) ? r.grade.mult : 1;

    if (!r.landed) {
      return { amount: 40, kind: 'salvage', lines: ['IMPACT SALVAGE', '+$40 RECOVERED'] };
    }

    var fuelPct = Math.max(0, Math.min(1, fuel / maxFuel));
    var softFrac = Math.max(0, Math.min(1, 1 - (speed / Math.max(SAFE, 0.01))));
    var fuelBonus = Math.round(fuelPct * 60);
    var softBonus = Math.round(softFrac * 70);
    var timeBonus = Math.round(Math.max(0, 50 - time) * 1.2);
    var base = 120 + fuelBonus + softBonus + timeBonus;
    var amount = Math.round(base * padMult * gradeMult);
    var lines = [
      'PAD TOUCHDOWN PAY', '+$' + amount,
      'FUEL BONUS', '+$' + fuelBonus,
      'CRUISE BONUS', '+$' + timeBonus,
      'SOFTNESS BONUS', '+$' + softBonus
    ];
    if (padMult !== 1) {
      var tripNote = (r.cfg && r.cfg.activePad && r.cfg.activePad.tripM)
        ? (' (' + r.cfg.activePad.tripM + 'm hop)') : '';
      lines.push('DISTANCE ×' + padMult.toFixed(1) + tripNote, '');
    }
    if (gradeMult !== 1 && r.grade) lines.push('GRADE ' + r.grade.letter + ' ×' + gradeMult.toFixed(2), '');
    return { amount: amount, kind: 'landing', lines: lines, base: base, padMult: padMult, gradeMult: gradeMult };
  }

  function applyToConfig(cfg, levels) {
    var ec = cfg || window.Apollo.CFG || {};
    var lv = levels || { tank: 0, engine: 0, rcs: 0, legs: 0 };
    ec.maxFuel = maxFuelAt(lv.tank || 0);
    ec.tankLevel = lv.tank || 0;
    ec.engineLevel = lv.engine || 0;
    ec.rcsLevel = lv.rcs || 0;
    ec.legsLevel = lv.legs || 0;
    ec.engineThrustMult = thrustMultAt(lv.engine || 0);
    ec.baseMaxThrust = (ec.baseMaxThrust != null) ? ec.baseMaxThrust : ec.MAX_THRUST;
    ec.MAX_THRUST = (ec.baseMaxThrust || 10) * ec.engineThrustMult;
    // RCS → rotation rate
    ec.MAX_ROT_RATE = rotRateAt(lv.rcs || 0);
    // Legs raise safe speed (applied after pad safeMul in career.applyPad)
    ec.legsSafeMult = legsSafeMultAt(lv.legs || 0);
    if (ec.baseSafeSpeed == null) ec.baseSafeSpeed = ec.SAFE_SPEED != null ? ec.SAFE_SPEED : 6.0;
    // SAFE_SPEED may already have pad mul; recompute from base * pad * legs if pad set
    var padSafe = (ec.activePad && ec._padSafeMul != null) ? ec._padSafeMul : 1;
    if (ec._padSafeMul != null) {
      ec.SAFE_SPEED = ec.baseSafeSpeed * ec._padSafeMul * ec.legsSafeMult;
    } else {
      ec.SAFE_SPEED = ec.baseSafeSpeed * ec.legsSafeMult;
    }
    return ec;
  }

  function defaultSave() {
    return {
      dollars: 0,
      levels: { tank: 0, engine: 0, rcs: 0, legs: 0 },
      best: 0,
      runs: 0,
      xp: 0,
      streak: 0,
      bestStreak: 0,
      bestGrade: '',
      planetId: 'luna',
      padId: 'luna-train',
      unlockedPlanets: ['luna'],
      padClears: {} // padId -> best letter
    };
  }

  var store = defaultSave();

  function clampLv(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    return Math.max(0, Math.min(MAX_LEVEL, Math.floor(v)));
  }

  function migrateV1() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_V1);
      if (!raw) return null;
      var d = JSON.parse(raw) || {};
      var s = defaultSave();
      s.dollars = Math.max(0, Math.floor(d.dollars || 0));
      s.levels.tank = clampLv(d.levels && d.levels.tank);
      s.levels.engine = clampLv(d.levels && d.levels.engine);
      s.best = Math.max(0, Math.floor(d.best || 0));
      s.runs = Math.max(0, Math.floor(d.runs || 0));
      // Rough XP from runs so veterans aren't stuck on Luna
      s.xp = Math.min(2000, s.runs * 40 + s.best);
      return s;
    } catch (e) { return null; }
  }

  function load() {
    try {
      if (typeof localStorage === 'undefined') return store;
      var raw = localStorage.getItem(STORAGE_KEY);
      var d = null;
      if (raw) d = JSON.parse(raw);
      else d = migrateV1();
      if (!d) return store;
      store.dollars = Math.max(0, Math.floor(d.dollars || 0));
      store.levels = {
        tank: clampLv(d.levels && d.levels.tank),
        engine: clampLv(d.levels && d.levels.engine),
        rcs: clampLv(d.levels && d.levels.rcs),
        legs: clampLv(d.levels && d.levels.legs)
      };
      store.best = Math.max(0, Math.floor(d.best || 0));
      store.runs = Math.max(0, Math.floor(d.runs || 0));
      store.xp = Math.max(0, Math.floor(d.xp || 0));
      store.streak = Math.max(0, Math.floor(d.streak || 0));
      store.bestStreak = Math.max(0, Math.floor(d.bestStreak || 0));
      store.bestGrade = d.bestGrade || '';
      store.planetId = d.planetId || 'luna';
      store.padId = d.padId || 'luna-train';
      store.unlockedPlanets = Array.isArray(d.unlockedPlanets) && d.unlockedPlanets.length
        ? d.unlockedPlanets.slice() : ['luna'];
      store.padClears = (d.padClears && typeof d.padClears === 'object') ? d.padClears : {};
      // Ensure unlocks match XP level
      refreshUnlocks();
    } catch (e) { /* defaults */ }
    return store;
  }

  function save() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        dollars: store.dollars,
        levels: store.levels,
        best: store.best,
        runs: store.runs,
        xp: store.xp,
        streak: store.streak,
        bestStreak: store.bestStreak,
        bestGrade: store.bestGrade,
        planetId: store.planetId,
        padId: store.padId,
        unlockedPlanets: store.unlockedPlanets,
        padClears: store.padClears
      }));
    } catch (e) { /* private mode */ }
  }

  function careerLevel() {
    var C = window.Apollo.Career;
    if (C && C.levelFromXp) return C.levelFromXp(store.xp);
    return 1 + Math.floor(store.xp / 120);
  }

  function refreshUnlocks() {
    var C = window.Apollo.Career;
    if (!C || !C.PLANETS) return;
    var lv = careerLevel();
    var list = store.unlockedPlanets || ['luna'];
    var seen = {};
    list.forEach(function (id) { seen[id] = true; });
    C.PLANETS.forEach(function (p) {
      if (lv >= (p.unlockLevel || 1) && !seen[p.id]) {
        list.push(p.id);
        seen[p.id] = true;
      }
    });
    store.unlockedPlanets = list;
    // If current planet locked (shouldn't), snap to luna
    if (list.indexOf(store.planetId) < 0) {
      store.planetId = 'luna';
      store.padId = 'luna-train';
    }
  }

  function gradeRank(letter) {
    var order = { S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 };
    return order[letter] || 0;
  }

  var Economy = {
    __v2: true,
    CATALOG: CATALOG,
    MAX_LEVEL: MAX_LEVEL,
    STORAGE_KEY: STORAGE_KEY,

    load: load,
    save: save,
    get store() { return store; },

    reward: reward,
    costToLevel: costToLevel,
    nextCost: nextCost,
    maxFuelAt: maxFuelAt,
    thrustMultAt: thrustMultAt,
    rotRateAt: rotRateAt,
    legsSafeMultAt: legsSafeMultAt,
    applyToConfig: applyToConfig,

    dollars: function () { return store.dollars; },
    level: function (id) { return store.levels[id] || 0; },
    xp: function () { return store.xp; },
    careerLevel: careerLevel,
    streak: function () { return store.streak; },
    planetId: function () { return store.planetId; },
    padId: function () { return store.padId; },
    unlockedPlanets: function () { return (store.unlockedPlanets || ['luna']).slice(); },

    setSelection: function (planetId, padId) {
      var C = window.Apollo.Career;
      var p = C ? C.planetById(planetId) : null;
      if (!p) return false;
      if ((store.unlockedPlanets || []).indexOf(p.id) < 0) return false;
      store.planetId = p.id;
      var pad = C.padById(p, padId) || p.pads[0];
      store.padId = pad.id;
      save();
      return true;
    },

    /* Record a finished run. Credits $, XP, streak, unlocks. */
    recordRun: function (runResult) {
      var r = runResult || {};
      var C = window.Apollo.Career;
      var planet = C ? C.planetById(store.planetId) : null;
      var pad = C && planet ? C.padById(planet, store.padId) : null;
      if (pad && r.padMult == null) r.padMult = pad.mult;

      var grade = r.grade;
      if (!grade && C && C.gradeRun) {
        grade = C.gradeRun(r);
        r.grade = grade;
      }

      var pay = reward(r);
      store.runs += 1;
      store.dollars += pay.amount;

      var xpGain = 8;
      if (C && C.xpForRun) xpGain = C.xpForRun(r, grade, pad);
      store.xp += xpGain;

      if (r.landed) {
        store.streak += 1;
        store.bestStreak = Math.max(store.bestStreak, store.streak);
        store.best = Math.max(store.best, pay.amount);
        if (grade && grade.letter) {
          if (gradeRank(grade.letter) > gradeRank(store.bestGrade)) {
            store.bestGrade = grade.letter;
          }
          if (pad) {
            var prev = store.padClears[pad.id];
            if (!prev || gradeRank(grade.letter) > gradeRank(prev)) {
              store.padClears[pad.id] = grade.letter;
            }
          }
        }
      } else {
        store.streak = 0;
      }

      var unlockedNow = [];
      var before = (store.unlockedPlanets || []).slice();
      refreshUnlocks();
      (store.unlockedPlanets || []).forEach(function (id) {
        if (before.indexOf(id) < 0) unlockedNow.push(id);
      });

      store.lastReward = pay;
      store.lastGrade = grade || null;
      store.lastXpGain = xpGain;
      store.lastUnlocks = unlockedNow;
      save();

      return {
        amount: pay.amount,
        kind: pay.kind,
        lines: pay.lines,
        grade: grade,
        xpGain: xpGain,
        streak: store.streak,
        careerLevel: careerLevel(),
        unlocks: unlockedNow,
        dollars: store.dollars,
        xp: store.xp
      };
    },

    buy: function (id) {
      var item = CATALOG[id];
      if (!item) return { ok: false, reason: 'unknown' };
      var cur = store.levels[id] || 0;
      var cost = nextCost(item, cur);
      if (cost < 0) return { ok: false, reason: 'maxed' };
      if (store.dollars < cost) return { ok: false, reason: 'funds' };
      store.dollars -= cost;
      store.levels[id] = cur + 1;
      save();
      return { ok: true, levels: store.levels, dollars: store.dollars };
    },

    refueling: false,

    reset: function () {
      var d = defaultSave();
      store.dollars = d.dollars;
      store.levels = d.levels;
      store.best = 0;
      store.runs = 0;
      store.xp = 0;
      store.streak = 0;
      store.bestStreak = 0;
      store.bestGrade = '';
      store.planetId = 'luna';
      store.padId = 'luna-train';
      store.unlockedPlanets = ['luna'];
      store.padClears = {};
      store.lastReward = null;
      save();
    }
  };

  window.Apollo.Economy = Economy;
  Economy.load();
})();
