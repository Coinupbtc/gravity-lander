// Headless unit test for APOLLO DESCENT economy.js (pure math + persistence).
// Runs in node by stubbing window/localStorage. Verifies reward math, upgrade
// purchases, wallet persistence, and config application.
'use strict';
const fs = require('fs');
const path = require('path');

// --- stub browser globals ---
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
global.window = {};
global.performance = { now: () => Date.now() };

// Load economy.js (attaches window.Apollo.Economy)
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'economy.js'), 'utf8');
eval(code);

const E = window.Apollo.Economy;
console.log('economy loaded. CATALOG keys:', Object.keys(E.CATALOG).join(', '));

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

// --- reward math (relative soft bonus; ~1 training land ≈ L1) ---
const cfg = { SAFE_SPEED: 9.5 };
let r = E.reward({ landed: true, impact_speed: 3.0, fuel: 40, maxFuel: 100, time: 20, cfg });
console.log('perfect-ish landing reward:', JSON.stringify(r));
t('pad landing pays >=100 base', r.amount >= 100);
t('fuel bonus is percent-based', r.lines.some((x) => x.indexOf('FUEL BONUS') === 0));
// crash salvage
let c = E.reward({ landed: false, impact_speed: 9, fuel: 5, time: 30, cfg });
console.log('crash reward:', JSON.stringify(c));
t('crash pays salvage $40', c.amount === 40 && c.kind === 'salvage');

// --- config application ---
let cf = { GRAVITY: -4.5, MAX_THRUST: 10, FUEL_RATE: 2 };
E.applyToConfig(cf, { tank: 2, engine: 2 });
console.log('cfg after upgrades tank2/engine2:', JSON.stringify(cf));
t('tank L2 -> maxFuel 185', cf.maxFuel === 185);
t('engine L2 -> MAX_THRUST 10*1.5=15', Math.abs(cf.MAX_THRUST - 15) < 1e-6);
t('baseMaxThrust preserved=10', cf.baseMaxThrust === 10);

// --- purchases + wallet persistence ---
E.reset();
t('start dollars 0', E.dollars() === 0);
let pay = E.recordRun({ landed: true, impact_speed: 2, fuel: 50, maxFuel: 100, time: 15, cfg });
console.log('recorded landing pay:', pay.amount, 'wallet now', E.dollars());
let wallet = E.dollars();
const tankCost = E.CATALOG.tank.costs[1];
if (wallet >= tankCost) {
  let b = E.buy('tank');
  console.log('buy tank result:', JSON.stringify(b));
  t('tank buy ok', b.ok === true && E.level('tank') === 1);
  t('wallet reduced by L1 cost', E.dollars() === wallet - tankCost);
} else {
  fail++; console.log('  FAIL tank buy unaffordable after one solid land', wallet, tankCost);
}
let saved = JSON.parse(mem[E.STORAGE_KEY]);
console.log('persisted save:', JSON.stringify(saved));
t('persisted dollars match', saved.dollars === E.dollars());
t('persisted levels.tank match', saved.levels.tank === E.level('tank'));

let b2 = E.buy('engine');
t('buy returns {ok, levels|reason} shape',
  b2 && (b2.ok === true || b2.ok === false) && ('levels' in b2 || 'reason' in b2));

const tank = E.CATALOG.tank;
const c1 = E.costToLevel(tank, 1);
const c2 = E.costToLevel(tank, 2);
t('tank L1 cost 200', c1 === tank.costs[1] && c1 === 200);
t('tank escalating (cost to L2 > L1)', c2 > c1);
t('tank maxed nextCost -1', E.nextCost(tank, E.MAX_LEVEL) === -1);

t('tank L0=100', E.maxFuelAt(0) === 100);
t('tank L4=320', E.maxFuelAt(4) === 320);
t('thrust L0=1.0', Math.abs(E.thrustMultAt(0) - 1) < 1e-9);
t('thrust L4=2.2', Math.abs(E.thrustMultAt(4) - 2.2) < 1e-9);

// Economy intent: training land should roughly fund L1
t('one solid land funds tank L1', pay.amount >= tankCost);

console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
process.exit(fail ? 1 : 0);
