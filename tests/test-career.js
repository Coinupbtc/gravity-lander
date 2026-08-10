// Headless career + economy v2 smoke (planets, grades, unlocks, pad apply).
'use strict';
const fs = require('fs');
const path = require('path');
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
global.window = {};

eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'career.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'economy.js'), 'utf8'));

const C = window.Apollo.Career;
const E = window.Apollo.Economy;
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

E.reset();
t('4 planets', C.PLANETS.length === 4);
t('luna unlocked at start', E.unlockedPlanets().indexOf('luna') >= 0);
t('mars locked at start', E.unlockedPlanets().indexOf('mars') < 0);

const g = C.gradeRun({
  landed: true, impact_speed: 1.2, fuel: 55, maxFuel: 100,
  time: 20, angle: 0.04, cfg: { SAFE_SPEED: 6, SAFE_ANGLE: 0.3 }
});
t('soft landing grades A or S', g.letter === 'A' || g.letter === 'S');

const r = E.recordRun({
  landed: true, impact_speed: 1.2, fuel: 55, maxFuel: 100,
  time: 20, angle: 0.04, padMult: 1.4, grade: g, cfg: { SAFE_SPEED: 6 }
});
t('landing pays > 100', r.amount > 100);
t('xp gained > 8', r.xpGain > 8);
t('streak 1', r.streak === 1);

// Grind toward Mars (unlockLevel 4 => need 360 XP)
for (let i = 0; i < 20; i++) {
  E.recordRun({
    landed: true, impact_speed: 1.0, fuel: 50, maxFuel: 100,
    time: 18, angle: 0.03, padMult: 2, grade: g, cfg: { SAFE_SPEED: 6 }
  });
}
t('career level >= 4', E.careerLevel() >= 4);
t('mars unlocked after XP', E.unlockedPlanets().indexOf('mars') >= 0);
t('can select mars pad', E.setSelection('mars', 'mars-canyon') === true);

const planet = C.planetById('mars');
const pad = C.padById(planet, 'mars-canyon');
const cfg = { GRAVITY: -4.5, MAX_THRUST: 10, SAFE_SPEED: 6, baseSafeSpeed: 6 };
const st = { start: {} };
C.applyPlanetToConfig(cfg, planet);
C.applyPadToConfig(cfg, st, pad);
E.applyToConfig(cfg, { tank: 0, engine: 0, rcs: 0, legs: 0 });
t('mars gravity applied', Math.abs(cfg.GRAVITY - (-6.2)) < 1e-6);
t('pad target set', st.padTarget && st.padTarget.id === 'mars-canyon');
t('fuelStartMul tightened', cfg.fuelStartMul < 1);
t('activePad mult', cfg.activePad && Math.abs(cfg.activePad.mult - C.distancePayMult(pad)) < 1e-6);

const env = C.envelope({
  altitude: 20, fuel: 10, maxFuel: 100, angle: 0.25,
  velocity: { x: 0, y: -5.5 }
}, { SAFE_SPEED: 6, SAFE_ANGLE: 0.3 });
t('envelope has overall band', !!env.overall);

console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
process.exit(fail ? 1 : 0);
