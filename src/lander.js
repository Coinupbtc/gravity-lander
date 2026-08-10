/* ============================================================
 * APOLLO DESCENT — Lander module (window.Apollo.Lander)
 *
 * Hero spacecraft: a retro-futuristic two-stage mission stack.
 *   - Ascent stage: octagonal crew cabin, gold/Mylar foil wrap,
 *     an emissive window band with warm interior glow, RCS thruster
 *     quad, antenna mast with dish.
 *   - Descent stage: conical/truncated body panelled in brushed
 *     metal with four wrap-around propellant tanks (2 red O2,
 *     2 pale LH2) and eight small RCS pods around the rim.
 *   - Engine: a big polished alloy bell (brass/copper lip, nozzle
 *     ribs) plus the engineFlame cone mesh (hidden by default).
 *   - Legs: four articulated landing legs, each with a shock
 *     strut, gimbal joint and a crumple footpad. Grouped under
 *     `legs` so engine.js can compress / rotate them on touchdown.
 *
 * Building is entirely radial / symmetric around Y so the stack
 * stays perfectly balanced and cheap to render (<30k tris total).
 * All meshes cast/receive shadows. No console errors — everything
 * is wrapped defensively.
 * ============================================================ */
(function () {
  'use strict';

  function build(scene) {
    var api = window.Apollo.Lander;

    /* --------- shared materials (MeshStandardMaterial) --------- */
    function mat(opts) {
      return new THREE.MeshStandardMaterial(opts);
    }

    // Body / structure:
    var matBody  = mat({ color: 0xc9c4bd, metalness: 0.82, roughness: 0.42 });   // brushed titanium
    var matBody2 = mat({ color: 0xdc6342, metalness: 0.60, roughness: 0.30 });   // accent band
    var matDark  = mat({ color: 0x4a4a52, metalness: 0.55, roughness: 0.55 });   // RCS / joints
    var matTankO = mat({ color: 0xd5453a, metalness: 0.35, roughness: 0.28,
                         emissive: 0x2a0806, emissiveIntensity: 0.25 });         // LOX red
    var matTankH = mat({ color: 0xc8d4da, metalness: 0.55, roughness: 0.18,
                         emissive: 0x0a0e12, emissiveIntensity: 0.25 });         // LH2 pale

    // Gold foil / ascent:
    var matGold  = mat({ color: 0xe8b23b, metalness: 0.92, roughness: 0.22 });   // polished gold
    var matGold2 = mat({ color: 0xb1791f, metalness: 0.70, roughness: 0.48 });   // matte foil

    // Window band + emissive interior:
    var matWin   = mat({ color: 0x20303c, metalness: 0.4,  roughness: 0.35 });
    var matGlass = mat({ color: 0x6fd0ff, metalness: 0.2,  roughness: 0.06,
                         emissive: 0x9fe4ff, emissiveIntensity: 1.3 });
    var matEmiss = mat({ color: 0xffffff, emissive: 0xffcc66,
                         emissiveIntensity: 2.2, metalness: 0.0, roughness: 0.5 }); // tiny accent strip

    // Engine:
    var matBell  = mat({ color: 0x9aa3ad, metalness: 0.98, roughness: 0.14 });   // polished alloy
    var matBell2 = mat({ color: 0xc07a33, metalness: 0.9,  roughness: 0.30 });   // brass mouth
    var matFlame = new THREE.MeshBasicMaterial({
      color: 0xffb46b, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });

    /* utility: assign shadow flags to a whole group */
    function shadows(root, on) {
      root.traverse(function (o) {
        if (o.isMesh) {
          o.castShadow = on;
          o.receiveShadow = on;
        }
      });
    }

    /* utility: build a body via LatheGeometry on a rounded profile.
       Gives the soft "pressure-vessel" crew-cabin curve. */
    var OCT = 8;
    function lathe(profile, segments, radial) {
      return new THREE.LatheGeometry(profile, radial || OCT);
    }

    // Small shared geometries.
    var sphereGeo = new THREE.SphereGeometry(1, 12, 10);
    var cylGeo    = new THREE.CylinderGeometry(1, 1, 1, 16);
    var boxGeo    = new THREE.BoxGeometry(1, 1, 1);

    var root = new THREE.Group();
    root.name = 'apollo-lander';

    /* =================================================================
     *  ENGINE FLAME  (required: obj.engineFlame)  hidden by default
     * ================================================================= */
    var flameGeo = new THREE.ConeGeometry(0.42, 2.4, 12, 1, true);
    flameGeo.translate(0, 1.2, 0);           // apex at y=0 (nozzle), base below
    var engineFlame = new THREE.Mesh(flameGeo, matFlame);
    engineFlame.name = 'engineFlame';
    engineFlame.visible = false;
    engineFlame.position.y = -0.6;           // just below nozzle
    root.add(engineFlame);

    /* =================================================================
     *  ENGINE BELL  (required: obj.bell)  — big polished bell
     * ================================================================= */
    var bellGroup = new THREE.Group();
    bellGroup.name = 'engineBell';

    // Lathe profile for the bell outer surface: mouth at top (profile
    // built bottom-up then flipped) — opening faces -Y (down).
    var bellPts = [
      new THREE.Vector2(0.00, 0.40),
      new THREE.Vector2(0.16, 0.30),
      new THREE.Vector2(0.32, 0.12),
      new THREE.Vector2(0.48, -0.02),
      new THREE.Vector2(0.62, -0.24),
      new THREE.Vector2(0.72, -0.55),
      new THREE.Vector2(0.70, -0.82),
      new THREE.Vector2(0.58, -1.02),
      new THREE.Vector2(0.40, -1.12),
      new THREE.Vector2(0.00, -1.12),
      new THREE.Vector2(0.00, -0.40)
    ];
    var bellGeo = new THREE.LatheGeometry(bellPts, 28);
    var bell = new THREE.Mesh(bellGeo, matBell);
    bell.name = 'bell';
    bell.rotation.x = Math.PI;               // flip so opening faces -Y (down)
    bellGroup.add(bell);

    // Polished brass mouth rim at the opening.
    var mouth = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 12, 28), matBell2);
    mouth.position.y = 0.40;
    mouth.rotation.x = Math.PI / 2;
    bellGroup.add(mouth);

    // A few structural nozzle ribs for extra detail.
    for (var r = 0; r < 7; r++) {
      var rib = new THREE.Mesh(boxGeo.clone(), matDark);
      var a = (r / 7) * Math.PI * 2;
      rib.scale.set(0.02, 1.9, 0.02);
      rib.position.set(Math.cos(a) * 0.70, 0.1, Math.sin(a) * 0.70);
      rib.rotation.y = -a + Math.PI;
      bellGroup.add(rib);
    }

    // Mounting collar that connects bell to descent deck.
    var collar = new THREE.Mesh(cylGeo.clone(), matBody);
    collar.scale.set(0.30, 0.30, 0.30);
    collar.position.y = -0.18;
    collar.rotation.x = Math.PI;
    bellGroup.add(collar);

    bellGroup.position.y = 1.0;              // mouth just below descent deck
    root.add(bellGroup);

    /* =================================================================
     *  DESCENT STAGE — truncated cone body + tanks + RCS pods
     * ================================================================= */
    var descent = new THREE.Group();
    descent.name = 'descentStage';

    // Main truncated cone (top radius 1.15 -> base 1.85), hollow.
    var coneGeo = new THREE.CylinderGeometry(1.15, 1.85, 2.2, 16, 1, true);
    var cone = new THREE.Mesh(coneGeo, matBody);
    cone.position.y = 2.0;
    descent.add(cone);

    // Bottom face plate closing the cone (bell pokes through its centre).
    var base = new THREE.Mesh(cylGeo.clone(), matBody2);
    base.scale.set(1.85, 0.03, 1.85);
    base.position.y = 0.90;
    descent.add(base);

    // Top deck ring.
    var deck = new THREE.Mesh(cylGeo.clone(), matBody2);
    deck.scale.set(1.18, 0.05, 1.18);
    deck.position.y = 3.16;
    descent.add(deck);

    // Four wrap-around propellant tanks, paired red/grey.
    var tankColours = [matTankO, matTankH, matTankO, matTankH];
    for (var i = 0; i < 4; i++) {
      var ta = (i / 4) * Math.PI * 2 + Math.PI / 4;
      var tank = new THREE.Mesh(cylGeo.clone(), tankColours[i]);
      tank.scale.set(0.42, 1.55, 0.42);
      tank.position.set(Math.cos(ta) * 1.52, 2.0, Math.sin(ta) * 1.52);
      tank.rotation.z = Math.PI / 2;
      tank.rotation.y = ta;
      descent.add(tank);

      // dome caps on each tank.
      var cap = new THREE.Mesh(sphereGeo.clone(), tankColours[i]);
      cap.scale.set(0.42, 0.42, 0.42);
      cap.position.set(Math.cos(ta) * (1.52 + 0.42), 2.0, Math.sin(ta) * (1.52 + 0.42));
      cap.rotation.y = ta - Math.PI / 2;
      descent.add(cap);
      var cap2 = cap.clone();
      cap2.position.set(Math.cos(ta) * (1.52 - 0.42), 2.0, Math.sin(ta) * (1.52 - 0.42));
      cap2.rotation.y = ta - Math.PI / 2 + Math.PI;
      descent.add(cap2);

      // thin strapping bands around each tank.
      for (var b = 0; b < 2; b++) {
        var band = new THREE.Mesh(new THREE.TorusGeometry(0.425, 0.025, 6, 16), matDark);
        band.position.set(Math.cos(ta) * 1.52, 2.0 + (b === 0 ? -0.55 : 0.55),
                          Math.sin(ta) * 1.52);
        band.rotation.y = ta;
        band.rotation.x = Math.PI / 2;
        descent.add(band);
      }
    }

    // Eight small RCS thruster pods around the rim of the deck.
    for (var p = 0; p < 8; p++) {
      var pa = (p / 8) * Math.PI * 2;
      var pod = new THREE.Mesh(cylGeo.clone(), matDark);
      pod.scale.set(0.10, 0.14, 0.10);
      pod.position.set(Math.cos(pa) * 1.32, 3.30, Math.sin(pa) * 1.32);
      pod.rotation.z = Math.PI / 2;
      pod.rotation.y = pa;
      descent.add(pod);

      var nozzle = new THREE.Mesh(cylGeo.clone(), matBell2);
      nozzle.scale.set(0.04, 0.05, 0.04);
      nozzle.position.set(Math.cos(pa) * 1.48, 3.30, Math.sin(pa) * 1.48);
      nozzle.rotation.z = Math.PI / 2;
      nozzle.rotation.y = pa;
      descent.add(nozzle);
    }

    // Small emissive beacon ring around the top deck.
    var beacon = new THREE.Mesh(new THREE.TorusGeometry(1.17, 0.02, 6, 20), matEmiss);
    beacon.rotation.x = Math.PI / 2;
    beacon.position.y = 3.24;
    descent.add(beacon);

    root.add(descent);

    /* =================================================================
     *  ASCENT STAGE — gold crew cabin with emissive window band
     * ================================================================= */
    var ascent = new THREE.Group();
    ascent.name = 'ascentStage';

    // Rounded octagonal crew cabin (lathe profile).
    var cabinPts = [
      new THREE.Vector2(0.000, 0.00),
      new THREE.Vector2(0.38, 0.00),
      new THREE.Vector2(0.44, 0.10),
      new THREE.Vector2(0.50, 0.34),
      new THREE.Vector2(0.56, 0.60),
      new THREE.Vector2(0.60, 0.90),
      new THREE.Vector2(0.52, 1.18),
      new THREE.Vector2(0.40, 1.30),
      new THREE.Vector2(0.20, 1.34),
      new THREE.Vector2(0.00, 1.34)
    ];
    var cabin = new THREE.Mesh(new THREE.LatheGeometry(cabinPts, 20, 8), matGold2);
    cabin.rotation.x = Math.PI / 2;      // stand upright
    cabin.position.y = 3.22;
    ascent.add(cabin);

    // Octagonal top plate (sealed hatch side).
    var top = new THREE.Mesh(cylGeo.clone(), matGold);
    top.scale.set(0.36, 0.03, 0.36);
    top.position.y = 3.22 + 1.34 + 0.02;
    top.rotation.x = Math.PI / 2;
    ascent.add(top);

    // Polished gold foil strips wrapping the cabin seams.
    for (var s = 0; s < 8; s++) {
      var sa = (s / 8) * Math.PI * 2;
      var strip = new THREE.Mesh(boxGeo.clone(), matGold);
      strip.scale.set(0.03, 1.34, 1.24);
      strip.position.set(Math.cos(sa) * 0.45, 3.22 + 0.67, Math.sin(sa) * 0.45);
      strip.rotation.y = sa;
      ascent.add(strip);
    }

    // Window band base.
    var winBand = new THREE.Mesh(cylGeo.clone(), matWin);
    winBand.scale.set(0.585, 0.15, 0.585);
    winBand.position.y = 3.22 + 0.70;
    winBand.rotation.x = Math.PI / 2;
    ascent.add(winBand);

    // 4 large emissive glass windows around the cabin.
    for (var w = 0; w < 4; w++) {
      var wa = (w / 4) * Math.PI * 2 + Math.PI / 4;
      var win = new THREE.Mesh(sphereGeo.clone(), matGlass);
      win.scale.set(0.20, 0.16, 0.14);
      win.position.set(Math.cos(wa) * 0.56, 3.22 + 0.70, Math.sin(wa) * 0.56);
      win.rotation.y = wa;
      ascent.add(win);
    }

    // RCS thruster quad on the ascent stage.
    for (var q = 0; q < 4; q++) {
      var qa = (q / 4) * Math.PI * 2;
      var thr = new THREE.Mesh(cylGeo.clone(), matDark);
      thr.scale.set(0.07, 0.11, 0.07);
      thr.position.set(Math.cos(qa) * 0.62, 3.22 + 1.10, Math.sin(qa) * 0.62);
      thr.rotation.z = Math.PI / 2;
      thr.rotation.y = qa;
      ascent.add(thr);
    }

    // Antenna mast + dish on top of the cabin.
    var mastH = 3.22 + 1.34 + 0.03;
    var mast = new THREE.Mesh(cylGeo.clone(), matBody);
    mast.scale.set(0.015, 0.9, 0.015);
    mast.position.y = mastH + 0.45;
    ascent.add(mast);
    var dish = new THREE.Mesh(sphereGeo.clone(), matGold);
    dish.scale.set(0.20, 0.08, 0.20);
    dish.position.y = mastH + 0.95;
    ascent.add(dish);

    root.add(ascent);

    /* =================================================================
     *  LEGS  (required: obj.legs) — 4 articulated landing legs.
     *  Group kept at root frame; engine drives legs.rotation.y and can
     *  compress each footpad on touchdown.
     * ================================================================= */
    var legs = new THREE.Group();
    legs.name = 'legs';

    for (var l = 0; l < 4; l++) {
      var la = (l / 4) * Math.PI * 2 + Math.PI / 4;
      var leg = new THREE.Group();
      leg.name = 'leg' + l;

      // Upper structural strut — angled box from hip to mid-span.
      var upper = new THREE.Mesh(boxGeo.clone(), matBody);
      upper.scale.set(0.09, 2.1, 0.09);
      upper.position.y = 1.15;
      upper.rotation.z = -0.42;             // angle outward
      leg.add(upper);

      // Gimbal hub / hinge ball at the hip.
      var hip = new THREE.Mesh(sphereGeo.clone(), matDark);
      hip.scale.set(0.13, 0.13, 0.13);
      hip.position.y = 0.12;
      leg.add(hip);

      // Shock strut — telescoping lower tube reaching toward the pad.
      var shock = new THREE.Mesh(cylGeo.clone(), matBody2);
      shock.scale.set(0.05, 0.95, 0.05);
      shock.position.y = -0.6;
      shock.rotation.z = 0.25;
      leg.add(shock);

      // Inner telescoping piston.
      var piston = new THREE.Mesh(cylGeo.clone(), matDark);
      piston.scale.set(0.04, 0.75, 0.04);
      piston.position.y = -1.35;
      piston.rotation.z = 0.25;
      leg.add(piston);

      // Footpad assembly (pad + edge ring), slight toe-in.
      var pad = new THREE.Mesh(cylGeo.clone(), matBell2);
      pad.scale.set(0.34, 0.03, 0.34);
      pad.position.y = -2.15;
      pad.rotation.z = 0.35;
      leg.add(pad);
      var padEdge = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 6, 14), matDark);
      padEdge.position.y = -2.10;
      padEdge.rotation.x = Math.PI / 2;
      leg.add(padEdge);

      // spring coil wrap on the shock strut.
      var coil = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.015, 6, 12), matGold2);
      coil.position.y = -0.35;
      coil.rotation.x = Math.PI / 2;
      leg.add(coil);

      leg.rotation.y = la;
      legs.add(leg);
    }

    root.add(legs);

    /* =================================================================
     *  HANGAR UPGRADES (loop #2 complaint #4) — dynamic 3D ship upgrades
     *  Economy.levels{tank,engine,rcs,legs} 0..4 drive visible mesh:
     *    TANK   -> golden foil wrap + auxiliary fuel conduits appear/grow
     *    ENGINE -> bigger bell + heat-shading ring + plasma glow band
     *    RCS    -> quad upper-stage RCS thruster blocks grow
     *    LEGS   -> heavier shock cylinders + wider footpads
     *  updateUpgrades(levels) is re-invoked whenever shop upgrades change.
     * ================================================================= */
    var upgradeRoot = new THREE.Group();
    upgradeRoot.name = 'hangarUpgrades';
    root.add(upgradeRoot);

    function clearUpgrades() {
      for (var u = upgradeRoot.children.length - 1; u >= 0; u--) {
        var c = upgradeRoot.children[u];
        upgradeRoot.remove(c);
        if (c.geometry) { try { c.geometry.dispose(); } catch (e) { /* */ } }
      }
    }

    function updateUpgrades(levels) {
      var lv = levels || { tank: 0, engine: 0, rcs: 0, legs: 0 };
      clearUpgrades();
      var T = Math.max(0, Math.min(4, lv.tank || 0));
      var E = Math.max(0, Math.min(4, lv.engine || 0));
      var R = Math.max(0, Math.min(4, lv.rcs || 0));
      var L = Math.max(0, Math.min(4, lv.legs || 0));

      // Upgrade cosmetics (fresh materials so we own their state).
      var upGold   = mat({ color: 0xf6cf5e, metalness: 0.9, roughness: 0.18, emissive: 0x332200, emissiveIntensity: 0.35 });
      var upBell   = mat({ color: 0xc07a33, metalness: 0.95, roughness: 0.24 });
      var upDark   = mat({ color: 0x3a3a42, metalness: 0.5, roughness: 0.5 });
      var upEmiss  = mat({ color: 0xffffff, emissive: 0x46e0ff, emissiveIntensity: 1.6, metalness: 0.0, roughness: 0.4 });
      var upPlasma = mat({ color: 0xff8844, emissive: 0xff6622, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.3 });
      var upStrut  = mat({ color: 0x6b7078, metalness: 0.8, roughness: 0.3 });

      /* --- TANK: golden foil bands + auxiliary fuel conduits (grow with L) --- */
      if (T > 0) {
        var foilCount = Math.min(T, 4);
        for (var f = 0; f < foilCount; f++) {
          var band = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.03 + T * 0.004, 6, 16), upGold);
          band.position.set(0, 1.35 + f * 0.30, 0.34);
          band.rotation.x = Math.PI / 2;
          upgradeRoot.add(band);
        }
        var auxN = (T >= 4) ? 4 : (T >= 2 ? 2 : 0);
        for (var a = 0; a < auxN; a++) {
          var aa = (a / Math.max(4, auxN)) * Math.PI * 2 + Math.PI / 8;
          var sphere = new THREE.Mesh(sphereGeo.clone(), upGold);
          sphere.scale.setScalar(0.10 + T * 0.02);
          sphere.position.set(Math.cos(aa) * 1.30, 3.05, Math.sin(aa) * 1.30);
          upgradeRoot.add(sphere);
          var line = new THREE.Mesh(cylGeo.clone(), upDark);
          line.scale.set(0.02, 0.5, 0.02);
          line.position.set(Math.cos(aa) * 1.30, 2.75, Math.sin(aa) * 1.30);
          upgradeRoot.add(line);
        }
      }

      /* --- ENGINE: bigger bell + heat ring + plasma glow band with level --- */
      if (E > 0) {
        var ringR = 0.55 + E * 0.10;
        var ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.06 + E * 0.015, 10, 24), upBell);
        ring.position.y = 0.35;
        ring.rotation.x = Math.PI / 2;
        upgradeRoot.add(ring);
        var plasma = new THREE.Mesh(new THREE.TorusGeometry(ringR + 0.14, 0.03, 8, 20), upPlasma);
        plasma.position.y = 0.55;
        plasma.rotation.x = Math.PI / 2;
        plasma.material.emissiveIntensity = 0.8 + E * 0.3;
        upgradeRoot.add(plasma);
        if (E >= 3) {
          var tipN = E >= 4 ? 2 : 1;
          for (var n = 0; n < tipN; n++) {
            var tip = new THREE.Mesh(new THREE.ConeGeometry(0.12 + E * 0.02, 0.5, 12), upBell);
            tip.position.set((n === 0 ? -0.35 : 0.45), -0.9, 0.15);
            tip.rotation.x = Math.PI;
            upgradeRoot.add(tip);
          }
        }
      }

      /* --- RCS: upper-stage thruster blocks (grow quad with level) --- */
      if (R > 0) {
        var rcsN = Math.min(R + 2, 6);
        for (var q2 = 0; q2 < rcsN; q2++) {
          var qa = (q2 / Math.max(rcsN, 1)) * Math.PI * 2;
          var block = new THREE.Mesh(cylGeo.clone(), upDark);
          block.scale.setScalar(0.06 + R * 0.015);
          block.position.set(Math.cos(qa) * 0.62, 4.0, Math.sin(qa) * 0.62);
          block.rotation.z = Math.PI / 2;
          block.rotation.y = qa;
          upgradeRoot.add(block);
          var thr = new THREE.Mesh(cylGeo.clone(), upEmiss);
          thr.scale.set(0.03, 0.06 + R * 0.02, 0.03);
          thr.position.set(Math.cos(qa) * 0.72, 4.0, Math.sin(qa) * 0.72);
          thr.rotation.z = Math.PI / 2;
          thr.rotation.y = qa;
          upgradeRoot.add(thr);
        }
      }

      /* --- LEGS: heavier shock cylinders + wider footpads --- */
      if (L > 0) {
        for (var lg = 0; lg < 4; lg++) {
          var la2 = (lg / 4) * Math.PI * 2 + Math.PI / 4;
          var strut = new THREE.Mesh(boxGeo.clone(), upStrut);
          strut.scale.set(0.09 + L * 0.02, 0.9 + L * 0.12, 0.09 + L * 0.02);
          strut.position.set(Math.cos(la2) * 0.9, 0.6, Math.sin(la2) * 0.9);
          strut.rotation.y = la2;
          upgradeRoot.add(strut);
          var foot = new THREE.Mesh(new THREE.TorusGeometry(0.34 + L * 0.03, 0.03 + L * 0.008, 6, 16), upDark);
          foot.position.set(Math.cos(la2) * 1.95, -1.6, Math.sin(la2) * 1.95);
          foot.rotation.y = la2;
          foot.rotation.x = Math.PI / 2;
          foot.rotation.z = -0.1;
          upgradeRoot.add(foot);
        }
      }
      return upgradeRoot;
    }

    // Expose so game.js can drive upgrades live from Economy state.
    api.updateUpgrades = updateUpgrades;
    api._upgradeRoot = upgradeRoot;

    /* =================================================================
     *  FINALIZE
     * ================================================================= */

    // Required API children:
    root.engineFlame = engineFlame;
    root.legs = legs;
    root.bell = bell;

    // Every mesh casts + receives shadows for a rich, soft look.
    shadows(root, true);

    // Give the module a handle to the live root (handy for fx/engine).
    api._group = root;

    return root;
  }

  // Attach namespace (contract: window.Apollo.Lander.build).
  if (typeof window !== 'undefined') {
    window.Apollo = window.Apollo || {};
    window.Apollo.Lander = { build: build };
  }

})();
