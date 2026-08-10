/* ============================================================================
 * fx.js — APOLLO DESCENT particle/effects module
 * ----------------------------------------------------------------------------
 * Implements window.Apollo.FX. Three pooled particle systems, all additive &
 * CPU-updated, sized to reuse and capped for speed:
 *
 *   plume   — FUEL: hot orange-white exhaust that fans out and burns off
 *   dust    — LANDING: grey lunar regolith kicked outward along the surface
 *   sparks  — CRASH: brief bright orange/white impact pops
 *
 * Everything is a pure function of the state the game passes in: the game owns
 * the loop (calls pulse each frame), this module owns the effects.
 * ==========================================================================*/
(function () {
  'use strict';

  window.Apollo = window.Apollo || {};

  // ---- module-private state -------------------------------------------------
  var T = null;                 // THREE reference (set on init)
  var scene = null;             // scene to attach pools to

  var POOL = 1200;               // global particle budget (freegle audit #6: raised 600->1200 for denser FX)

  var plume  = null;            // {geo, mat, points, items, head} single reusable pool
  var dust   = null;
  var sparks = null;

  var canvas = null;            // shared soft-particle sprite
  var texture = null;
  var glowSprite = null;        // additive engine-glow billboard (cheap warm bloom)

  // Emission remainder accumulators (fx audit #6/#7): without these, sub-1
  // emissions per frame (Math.floor(em*dt)) waste the fractional part and the
  // plume/dust starve. Keep the leftover between frames.
  var plumeAcc = 0;
  var dustAcc = 0;

  /* Each pool: {
   *   points : THREE.Points,
   *   size   : pool capacity,
   *   items  : Array<{alive, life, maxLife, vel:Vector3, size, grow, color:
   *                   {r,g,b}, base:{r,g,b}, alpha, fade, spin, grav, spread}>
   *   head   : index of next free slot (ring cursor)
   */

  /* --------------------------------------------------------------------------
   * Soft circular sprite (drawn once to a canvas, additive-blended).
   * Decaying radial falloff so CRC points look like glowing hot particles,
   * not squares.
   * ------------------------------------------------------------------------*/
  function makeSprite() {
    var size = 64;
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var g = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    );
    g.addColorStop(0.0, 'rgba(255,255,255,1.0)');   // hot white core
    g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.08)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    texture = new T.CanvasTexture(canvas);
    texture.needsUpdate = true;
  }

  /* Build a pool of `count` points. `material` is a fresh PointsMaterial; its
   * opacity is driven per-frame. This is the canonical reusable additive pool. */
  function makePool(count, material) {
    var positions = new Float32Array(count * 3);
    var colors = new Float32Array(count * 3);
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(positions, 3));
    geo.setAttribute('color', new T.BufferAttribute(colors, 3));

    var points = new T.Points(geo, material);
    points.frustumCulled = false;      // particles can wander anywhere; never drop
    points.renderOrder = 10;

    var items = [];
    for (var i = 0; i < count; i++) {
      items.push({
        alive: false,
        life: 0, maxLife: 1,
        vel: new T.Vector3(),
        size: 0.5, grow: 0,
        r: 1, g: 1, b: 1,
        br: 1, bg: 1, bb: 1,           // base color (for fade-to)
        alpha: 1, fade: 1,
        spin: 0,
        grav: 0,
        spread: 0
      });
    }
    return { points: points, size: count, items: items, head: 0 };
  }

  /* Ring-cursor spawn: always find the next slot, stealing from the oldest
   * living occupant if needed (the pool never blocks emission). */
  function spawn(pool, pos, vel, size, grow, color, fade, life, spin, grav, spread) {
    var it = pool.items[pool.head];
    it.alive = true;
    it.life = 0;
    it.maxLife = life;
    it.vel.copy(vel);
    it.size = size;
    it.grow = grow;
    it.br = color[0]; it.bg = color[1]; it.bb = color[2];
    it.r = color[0]; it.g = color[1]; it.b = color[2];
    it.alpha = 1;
    it.fade = fade;
    it.spin = spin;
    it.grav = grav;
    it.spread = spread;

    var posArr = pool.points.geometry.attributes.position.array;
    posArr[pool.head * 3 + 0] = pos.x;
    posArr[pool.head * 3 + 1] = pos.y;
    posArr[pool.head * 3 + 2] = pos.z;

    pool.head = (pool.head + 1) % pool.size;
  }

  /* Age every live particle: move it, apply gravity/spread, fade it out by
   * alpha + toward base colour, and park+recolor once its life is up. */
  function agePool(pool, dt) {
    var pos = pool.points.geometry.attributes.position;
    var col = pool.points.geometry.attributes.color;
    var pArr = pos.array, cArr = col.array;
    var items = pool.items;

    for (var i = 0; i < pool.size; i++) {
      var it = items[i];
      if (!it.alive) continue;

      it.life += dt;
      var k = it.life / it.maxLife;
      if (k >= 1) {
        // expire & hide
        it.alive = false;
        pArr[i * 3 + 0] = 0;
        pArr[i * 3 + 1] = -1000;
        pArr[i * 3 + 2] = 0;
        cArr[i * 3 + 0] = it.br;
        cArr[i * 3 + 1] = it.bg;
        cArr[i * 3 + 2] = it.bb;
        continue;
      }

      // integrate
      it.vel.y += it.grav * dt;
      pArr[i * 3 + 0] += it.vel.x * dt;
      pArr[i * 3 + 1] += it.vel.y * dt;
      pArr[i * 3 + 2] += it.vel.z * dt;

      it.size += it.grow * dt;
      it.alpha = Math.max(0, 1 - k * it.fade);
      // colour falls from live colour toward the dark base as it dies
      var mix = Math.min(1, k * 1.4);
      it.r = it.br + (it.r - it.br) * mix;
      it.g = it.bg + (it.g - it.bg) * mix;
      it.b = it.bb + (it.b - it.bb) * mix;

      // alpha → colour (PointsMaterial has no per-vertex alpha without a map
      // trick, so we dim toward black; combine with additive = particles burn out)
      cArr[i * 3 + 0] = it.r * it.alpha;
      cArr[i * 3 + 1] = it.g * it.alpha;
      cArr[i * 3 + 2] = it.b * it.alpha;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /* --------------------------------------------------------------------------
   * PUBLIC API
   * ------------------------------------------------------------------------*/
  window.Apollo.FX = {

    /* init(THREE) — one-time setup of the three pools. Call once after the
     * renderer/scene exist. Safe to call more than once (rebuilds pools). */
    init: function (THREE) {
      try {
        T = THREE;
        if (texture) texture.dispose();
        if (plume && plume.points.parent) scene.remove(plume.points);
        if (dust && dust.points.parent) scene.remove(dust.points);
        if (sparks && sparks.points.parent) scene.remove(sparks.points);

        makeSprite();

        var budg = POOL;
        var plumeCount = Math.floor(budg * 0.50);   // biggest spend: the plume
        var dustCount  = Math.floor(budg * 0.30);
        var sparkCount = budg - plumeCount - dustCount;

        // PLUME — additive, depth-write off, bright.
        plume = makePool(plumeCount, new T.PointsMaterial({
          map: texture,
          size: 1.6,
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
          sizeAttenuation: true,
          vertexColors: true
        }));

        // DUST — additive still reads well as ejecta glow off the surface.
        dust = makePool(dustCount, new T.PointsMaterial({
          map: texture,
          size: 1.2,
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
          sizeAttenuation: true,
          vertexColors: true
        }));

        // SPARKS — smallest, brightest.
        sparks = makePool(sparkCount, new T.PointsMaterial({
          map: texture,
          size: 1.0,
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
          sizeAttenuation: true,
          vertexColors: true
        }));
      } catch (e) {
        if (window.console) window.console.warn('FX.init:', e);
      }
    },

    /* Attach/refresh pool visibility each frame so the game never has to own
     * the points geometry. Game calls pulse(t, dt) every frame anyway. */
    pulse: function (t, dt) {
      try {
        dt = (dt > 0.1) ? 0.1 : dt;   // clamp huge frames

        var pools = [plume, dust, sparks];
        for (var p = 0; p < pools.length; p++) {
          var pool = pools[p];
          // pick up the scene from whatever the deferred reference is — in
          // practice the game passes scene objects; to stay decoupled we just
          // ensure pools are attached here via the active scene cache.
          if (pool && pool.points) agePool(pool, dt);
        }
        // Fade the engine glow out when throttle is off (updateThrust only runs
        // while intensity>0, so we decay it here every frame).
        if (glowSprite && glowSprite.material) {
          var op = glowSprite.material.opacity || 0;
          glowSprite.material.opacity = Math.max(0, op - dt * 1.8);
        }
      } catch (e) {
        if (window.console) window.console.warn('FX.pulse:', e);
      }
    },

    /* attach(scene) — internal-ish hook the game may call once to plant the
     * three Points objects. Kept on the namespace so game.js can drive it if
     * it likes; pulse() keeps them visible regardless. */
    attach: function (sc) {
      scene = sc;
      if (plume && plume.points && !plume.points.parent) scene.add(plume.points);
      if (dust && dust.points && !dust.points.parent) scene.add(dust.points);
      if (sparks && sparks.points && !sparks.points.parent) scene.add(sparks.points);
      // Cheap warm 'bloom': an additive glow billboard at the engine that rides
      // throttle (no post-processing pass needed, r128-safe).
      if (T) {
        glowSprite = new T.Sprite(new T.SpriteMaterial({
          map: texture, color: 0xffa34d, blending: T.AdditiveBlending,
          depthWrite: false, transparent: true, opacity: 0
        }));
        glowSprite.scale.set(6, 6, 1);
        glowSprite.renderOrder = 9;
        scene.add(glowSprite);
      }
    },

    /* ------------------------------------------------------------------------
     * updateThrust(pos, dir, intensity, dt)
     *   pos      — Vector3 world position of the engine bell nozzle tip
     *   dir      — Vector3 world "up" of the lander; flame shoots out along -dir
     *   intensity— 0..1 throttle
     *   dt       — frame delta
     * Emits a hot, flickering, expanding orange-white plume while intensity>0.
     * ----------------------------------------------------------------------*/
    updateThrust: function (pos, dir, intensity, dt) {
      if (!plume || !pos) return;
      if (!(intensity > 0)) return;      // engine off → no emission

      dt = (dt > 0.1) ? 0.1 : dt;
      // local frame: -dir is engine-down
      var down = dir.clone().negate();

      // perpendicular basis in the engine plane (tumble-free)
      var up = (Math.abs(dir.y) < 0.99)
        ? new T.Vector3(0, 1, 0)
        : new T.Vector3(0, 0, 1);
      var right = new T.Vector3().crossVectors(dir, up).normalize();
      if (right.lengthSq() < 1e-6) right.set(0, 0, 1);
      var up2 = new T.Vector3().crossVectors(right, dir).normalize();

      // flicker: high-frequency jitter on emission rate + brightness.
      // performance.now() keeps flicker vivid and order-independent of pulse().
      var now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      var flick = 0.75 + 0.35 * Math.sin(now * 0.096) * Math.sin(now * 0.0573);
      var em = (12 + 40 * intensity) * (0.55 + 0.45 * flick);   // particles/sec (audit #6: denser)
      plumeAcc += em * dt;                                       // remainder accumulator
      var n = Math.floor(plumeAcc);
      plumeAcc -= n;

      var colorHot = [1.0, 0.82, 0.45];       // orange-white core
      var colorMid = [1.0, 0.62, 0.20];       // deep orange mid
      var colorDim = [0.85, 0.35, 0.08];      // ember tail

      var coreSpeed = 9 + 20 * intensity;
      var spread = 3.0 + 5.0 * intensity;

      for (var i = 0; i < n; i++) {
        // random offset across the nozzle disk
        var rx = (Math.random() - 0.5) * 0.8;
        var ry = (Math.random() - 0.5) * 0.8;
        var p = new T.Vector3()
          .copy(pos)
          .addScaledVector(right, rx)
          .addScaledVector(up2, ry);

        // velocity: mostly -dir, with radial + slight back-eddy turbulence
        var v = down.clone().multiplyScalar(coreSpeed * (0.82 + 0.4 * Math.random()));
        v.addScaledVector(right, (Math.random() - 0.5) * spread);
        v.addScaledVector(up2,  (Math.random() - 0.5) * spread);
        // flicker pushes whole plume volume
        v.multiplyScalar(0.9 + 0.25 * flick);

        var r = Math.random();
        var col = (r < 0.5) ? colorHot : (r < 0.85 ? colorMid : colorDim);
        var size = 0.7 + 1.7 * intensity * (0.4 + 0.6 * Math.random());
        var life = 0.25 + 0.45 * Math.random();

        spawn(plume, p, v, size, 5.5 + 12 * intensity,
              col, 0.85, life, 0, -2.5, 2.0 + 3.0 * intensity);
      }

      // Drive the additive glow billboard (cheap warm bloom at the nozzle).
      if (glowSprite) {
        var bellTip = pos.clone().addScaledVector(down, 0.35);
        glowSprite.position.copy(bellTip);
        glowSprite.material.opacity = 0.20 + 0.50 * intensity * (0.8 + 0.4 * flick);
        glowSprite.scale.set(4 + 5 * intensity, 4 + 5 * intensity, 1);
      }
    },

    /* ------------------------------------------------------------------------
     * updateDust(pos, contactNormal, intensity, dt)
     *   pos           — Vector3 point of ground contact
     *   contactNormal — Vector3 up from surface
     *   intensity     — 0..1 touchdown violence
     * Kicks grey dust outward along the surface in a radial puff.
     * ----------------------------------------------------------------------*/
    updateDust: function (pos, contactNormal, intensity, dt) {
      if (!dust || !pos) return;
      if (!(intensity > 0)) return;

      dt = (dt > 0.1) ? 0.1 : dt;
      var em = (8 + 34 * intensity);              // particles/sec (audit #7: denser)
      dustAcc += em * dt;
      var n = Math.floor(dustAcc);
      dustAcc -= n;
      var nrm = contactNormal ? contactNormal.clone().normalize() : new T.Vector3(0, 1, 0);

      // tangent frame on the surface
      var t1 = (Math.abs(nrm.y) < 0.99)
        ? new T.Vector3(0, 0, 1).cross(nrm).normalize()
        : new T.Vector3(0, 0, -1).cross(nrm).normalize();
      if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
      var t2 = new T.Vector3().crossVectors(nrm, t1).normalize();

      for (var i = 0; i < n; i++) {
        var ang = Math.random() * Math.PI * 2;
        var p = new T.Vector3().copy(pos);
        // lift slightly off the ground so it reads as a kicked cloud
        p.addScaledVector(nrm, 0.05 + 0.4 * Math.random());

        // outward radial velocity, mostly horizontal, slight upward bounce
        var v = new T.Vector3()
          .addScaledVector(t1, Math.cos(ang) * (2.5 + 5.0 * intensity) * (0.6 + 0.8 * Math.random()))
          .addScaledVector(t2, Math.sin(ang) * (2.5 + 5.0 * intensity) * (0.6 + 0.8 * Math.random()))
          .addScaledVector(nrm, 0.5 + 1.5 * intensity * Math.random());

        var grey = 0.55 + 0.25 * Math.random();
        var col = [grey * 0.9, grey * 0.85, grey * 0.8];

        spawn(dust, p, v,
              0.8 + 1.6 * intensity * Math.random(),
              3.5 + 6 * intensity,
              col, 1.6, 0.6 + 1.0 * Math.random(),
              0, -2.0, 1.5 + 4 * intensity);
      }
    },

    /* ------------------------------------------------------------------------
     * spark(pos) — a quick, bright orange/white impact burst (crash).
     * Emits a tight cone of fast embers that burn out in well under a second.
     * ----------------------------------------------------------------------*/
    spark: function (pos) {
      if (!sparks || !pos) return;
      var n = 20 + Math.floor(Math.random() * 12);
      var colorHot = [1.0, 0.9, 0.55];
      var colorWht = [1.0, 1.0, 0.92];
      var colorOrn = [1.0, 0.55, 0.15];

      for (var i = 0; i < n; i++) {
        // near-spherical fast spray
        var dx = (Math.random() - 0.5) * 2;
        var dy = Math.random() * 1.6;         // biased upward
        var dz = (Math.random() - 0.5) * 2;
        var v = new T.Vector3(dx, dy * 0.8 + 0.3, dz).normalize()
          .multiplyScalar(6 + 14 * Math.random());

        var r = Math.random();
        var col = (r < 0.5) ? colorHot : (r < 0.8 ? colorWht : colorOrn);

        spawn(sparks, pos.clone(), v,
              0.35 + 0.8 * Math.random(),
              6 + 10 * Math.random(),
              col, 2.6, 0.15 + 0.45 * Math.random(),
              (Math.random() - 0.5) * 20, -6.0, 2.0);
      }
    },

    /* ------------------------------------------------------------------------
     * celebrate(pos) — gold/cyan confetti burst for a PERFECT (S-grade)
     * landing. Reuses the sparks pool (vertical gravity so it showers down,
     * additive + bright). One-shot fan-out fanfare (freegle idea #2).
     * ----------------------------------------------------------------------*/
    celebrate: function (pos) {
      if (!sparks || !pos) return;
      var n = 26 + Math.floor(Math.random() * 14);
      var gold = [1.0, 0.85, 0.30];
      var cyan = [0.30, 0.95, 1.0];
      var wht  = [1.0, 1.0, 0.95];
      for (var i = 0; i < n; i++) {
        // wide upward fountain then gravity (spawn 'grav' is applied to vel.y per s²)
        var ang = Math.random() * Math.PI * 2;
        var elev = 0.6 + Math.random() * 0.9;          // mostly up
        var spd = 5 + Math.random() * 11;
        var v = new T.Vector3(
          Math.cos(ang) * Math.cos(elev) * spd,
          Math.sin(elev) * spd,
          Math.sin(ang) * Math.cos(elev) * spd
        );
        var r = Math.random();
        var col = (r < 0.5) ? gold : (r < 0.82 ? cyan : wht);
        spawn(sparks, pos.clone(), v,
              0.3 + 0.5 * Math.random(),
              3 + 6 * Math.random(),
              col, 1.4, 0.6 + 0.7 * Math.random(),
              (Math.random() - 0.5) * 30, -7.5, 1.2);
      }
    }
  };

})();
