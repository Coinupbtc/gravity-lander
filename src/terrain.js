/*
 * APOLLO DESCENT — terrain module
 * window.Apollo.Terrain.build(scene, cfg) → { groundMesh, pads:[{x,y,z}], heightAt(x,z) }
 *
 * Procedural lunar heightfield (craters, ridges, mountains), starfield skybox with
 * nebula + textured Earth, warm Sun light with soft shadows + cool/warm hemisphere fill.
 * heightAt(x,z) is derived from the SAME pure height function that displaced the mesh,
 * so collision and visuals line up exactly.
 */
(function () {
  'use strict';

  var Apollo = window.Apollo = window.Apollo || {};

  Apollo.Terrain = (function () {

    // ---- deterministic pseudo-random / value-noise helpers --------------------
    // Seeded PRNG so the landscape is stable across frames and consistent between
    // the mesh build and any later heightAt() sampling / pad placement.

    function mulberry32(seed) {
      var a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // 2D value noise with smooth interpolation.
    function makeNoise(seed) {
      var rand = mulberry32(seed);
      var perm = new Uint8Array(512);
      var p = new Uint8Array(256);
      for (var i = 0; i < 256; i++) p[i] = i;
      for (var i = 255; i > 0; i--) {
        var r = Math.floor(rand() * (i + 1));
        var tmp = p[i]; p[i] = p[r]; p[r] = tmp;
      }
      for (var i = 0; i < 512; i++) perm[i] = p[i & 255];

      function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
      function grad(h, x, y) {
        switch (h & 3) {
          case 0: return x + y;
          case 1: return -x + y;
          case 2: return x - y;
          default: return -x - y;
        }
      }
      function noise2(x, y) {
        var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        x -= Math.floor(x); y -= Math.floor(y);
        var u = fade(x), v = fade(y);
        var A = perm[X] + Y, B = perm[X + 1] + Y;
        return 0.5 + 0.5 * (
          lerp(
            lerp(grad(perm[A], x, y), grad(perm[B], x - 1, y), u),
            lerp(grad(perm[A + 1], x, y - 1), grad(perm[B + 1], x - 1, y - 1), u),
            v
          )
        );
      }
      function lerp(a, b, t) { return a + (b - a) * t; }

      // Fractal Brownian motion: layered octaves for broad ridges + fine detail.
      function fbm(x, y, octaves, lacunarity, gain) {
        var amp = 1, freq = 1, sum = 0, norm = 0;
        for (var o = 0; o < octaves; o++) {
          sum += noise2(x * freq, y * freq) * amp;
          norm += amp;
          amp *= gain;
          freq *= lacunarity;
        }
        return sum / norm;
      }

      return { fbm: fbm, noise2: noise2, rand: rand };
    }

    // ---- shared pure height function ------------------------------------------
    // BIG CACHE of field state so heightAt() can be rebuilt identically after build().
    var FIELD = null;

    // A single crater: a bowl depression with a raised rim.
    function craterHeight(px, pz, cx, cz, radius) {
      var dx = px - cx, dz = pz - cz;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d >= radius) return 0;
      var t = d / radius;
      // smooth bowl; negative (below surface) inside, slight positive ring on rim
      var bowl = -(t * t) * 1.0 + 0.4;
      // raised rim just inside the edge
      var rim = 0.0;
      if (t > 0.55 && t < 0.95) {
        var rt = (t - 0.55) / 0.40;
        rim = 0.9 * Math.sin(rt * Math.PI) * 0.6;
      }
      return (bowl + rim) * radius * 0.9;
    }

    // Pure height at (x, z) in world space. Guarded so it never returns NaN.
    function heightAt(x, z) {
      if (!FIELD) return 0;

      // Flat tops for every landing pad (multi-pad career worlds).
      if (FIELD.pads && FIELD.pads.length) {
        for (var pi = 0; pi < FIELD.pads.length; pi++) {
          var pd = FIELD.pads[pi];
          var pdx = x - pd.x, pdz = z - pd.z;
          var pr = pd.r + 0.6;
          if (pdx * pdx + pdz * pdz <= pr * pr) return pd.y;
        }
      } else if (FIELD.pad) {
        // legacy single-pad
        var pdx0 = x - FIELD.pad.x, pdz0 = z - FIELD.pad.z;
        var pr0 = FIELD.pad.r + 0.6;
        if (pdx0 * pdx0 + pdz0 * pdz0 <= pr0 * pr0) return FIELD.pad.y;
      }

      var h = FIELD.base;

      // broad rolling ridges / hills
      h += FIELD.sm.fbm(x * FIELD.ridgeFreq, z * FIELD.ridgeFreq, 4, 2.1, 0.5) * FIELD.ridgeAmp
         - FIELD.ridgeAmp * 0.5;

      // sharper medium mountains (second octave band)
      h += (FIELD.sm.fbm(x * FIELD.mtnFreq, z * FIELD.mtnFreq, 5, 2.2, 0.55) - 0.5) * FIELD.mtnAmp;

      // fine surface detail / albedo wobble
      h += (FIELD.sm.fbm(x * FIELD.detFreq, z * FIELD.detFreq, 3, 2.0, 0.5) - 0.5) * FIELD.detAmp;

      // craters (well-separated, dominant shapes)
      var cs = FIELD.craters;
      for (var i = 0; i < cs.length; i++) {
        h += craterHeight(x, z, cs[i].x, cs[i].z, cs[i].r);
      }

      // NaN guard — never poison physics
      if (!isFinite(h)) h = FIELD.base;
      return h;
    }

    // ---- palette / textures -----------------------------------------------------
    function makeGroundTexture(colors) {
      var cols = colors || ['#4a4540', '#5a544b', '#443f38'];
      var cv = document.createElement('canvas');
      cv.width = 1024; cv.height = 1024;   // audit #9: 512->1024 to hide tiling at ground level
      var g = cv.getContext('2d');
      var rand = mulberry32(9918);
      // planet-tinted regolith gradient
      var grad = g.createLinearGradient(0, 0, 512, 512);
      grad.addColorStop(0, cols[0] || '#4a4540');
      grad.addColorStop(0.5, cols[1] || '#5a544b');
      grad.addColorStop(1, cols[2] || cols[0] || '#443f38');
      g.fillStyle = grad;
      g.fillRect(0, 0, 1024, 1024);
      // Soft regolith — fewer hard speckles (they read as pie-crust grid on phone).
      for (var i = 0; i < 8000; i++) {
        var v = rand();
        g.fillStyle = 'rgba(' + (v < 0.5 ? 40 : 230) + ',' + (v < 0.5 ? 36 : 220) + ',' +
          (v < 0.5 ? 32 : 205) + ',' + (0.03 + rand() * 0.05) + ')';
        g.beginPath();
        g.arc(rand() * 1024, rand() * 1024, 1.2 + rand() * 3.5, 0, Math.PI * 2);
        g.fill();
      }
      // Large soft blotches — primary surface character (not fine waffle).
      for (var c = 0; c < 90; c++) {
        g.fillStyle = 'rgba(30,26,22,' + (0.05 + rand() * 0.09) + ')';
        g.beginPath();
        g.ellipse(rand() * 1024, rand() * 1024, 28 + rand() * 120, 22 + rand() * 95, rand() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      var tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      // Very few tiles so seams + mottling don't read as a grid from orbit cam.
      tex.repeat.set(2.2, 2.2);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 8;
      if (tex.minFilter != null) tex.minFilter = THREE.LinearMipmapLinearFilter;
      if (tex.magFilter != null) tex.magFilter = THREE.LinearFilter;
      return tex;
    }

    // Soft normal detail — big blobs, not 1px noise (that looked like waffle iron).
    function makeGroundNormTexture() {
      var cv = document.createElement('canvas');
      cv.width = 256; cv.height = 256;
      var g = cv.getContext('2d');
      g.fillStyle = 'rgb(128,128,255)';
      g.fillRect(0, 0, 256, 256);
      var rand = mulberry32(4441);
      // Soft elliptical bumps only — no hard pixel speckles.
      for (var i = 0; i < 48; i++) {
        var o = 128 + Math.floor((rand() - 0.5) * 36);
        g.fillStyle = 'rgba(' + o + ',' + o + ',255,0.35)';
        g.beginPath();
        g.ellipse(rand() * 256, rand() * 256, 12 + rand() * 40, 10 + rand() * 32,
          rand() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      var tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2.5, 2.5);
      if (tex.minFilter != null) tex.minFilter = THREE.LinearMipmapLinearFilter;
      if (tex.magFilter != null) tex.magFilter = THREE.LinearFilter;
      return tex;
    }

    // Landing pad: concentric red/white circles on dark grey.
    function makePadTexture() {
      var cv = document.createElement('canvas');
      cv.width = 256; cv.height = 256;
      var g = cv.getContext('2d');
      var cx = 128, cy = 128;
      // base
      g.fillStyle = '#2a2a26';
      g.fillRect(0, 0, 256, 256);
      // rings
      var rings = [
        { r: 128, color: '#3a3a36' },
        { r: 118, color: '#c8302f' },
        { r: 106, color: '#e8e4da' },
        { r: 84, color: '#c8302f' },
        { r: 62, color: '#e8e4da' },
        { r: 40, color: '#c8302f' },
        { r: 18, color: '#e8e4da' },
        { r: 6, color: '#6a6a60' }
      ];
      for (var i = 0; i < rings.length; i++) {
        g.beginPath();
        g.arc(cx, cy, rings[i].r, 0, Math.PI * 2);
        g.fillStyle = rings[i].color;
        g.fill();
      }
      // radial hatch marks
      g.strokeStyle = 'rgba(232,228,218,0.35)';
      g.lineWidth = 2;
      for (var a = 0; a < 12; a++) {
        var ang = (a / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * 130, cy + Math.sin(ang) * 130);
        g.lineTo(cx + Math.cos(ang) * 122, cy + Math.sin(ang) * 122);
        g.stroke();
      }
      var tex = new THREE.CanvasTexture(cv);
      tex.encoding = THREE.sRGBEncoding; // r128 name (colorSpace is r152, ignored on this build)
      tex.anisotropy = 4;
      return tex;
    }

    // Nebula texture for skybox band of colour.
    function makeNebulaTexture() {
      var cv = document.createElement('canvas');
      cv.width = 512; cv.height = 512;
      var g = cv.getContext('2d');
      g.fillStyle = '#050510';
      g.fillRect(0, 0, 512, 512);
      var rand = mulberry32(77);
      function blob(rx, ry, color) {
        var x = 140 + rand() * 230, y = 120 + rand() * 270;
        var r = 30 + rand() * 80;
        var gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, color);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(x, y, r * rx, r * ry, rand() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      blob(1.4, 0.9, 'rgba(90,40,140,0.35)');
      blob(1.1, 1.3, 'rgba(30,70,180,0.30)');
      blob(1.6, 0.7, 'rgba(180,60,120,0.22)');
      blob(0.8, 1.5, 'rgba(40,140,180,0.20)');
      var tex = new THREE.CanvasTexture(cv);
      tex.encoding = THREE.sRGBEncoding; // r128 name (colorSpace is r152, ignored on this build)
      return tex;
    }

    // Earth texture: hand-painted blue marble + continents.
    function makeEarthTexture() {
      var cv = document.createElement('canvas');
      cv.width = 256; cv.height = 128;
      var g = cv.getContext('2d');
      var grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, '#0a2a5e');
      grad.addColorStop(0.5, '#1c5fa8');
      grad.addColorStop(1, '#0a2a5e');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
      g.globalAlpha = 0.9;
      var rand = mulberry32(313);
      for (var i = 0; i < 26; i++) {
        g.fillStyle = 'hsl(' + (90 + rand() * 60) + ',45%,' + (30 + rand() * 18) + '%)';
        var x = rand() * 256, y = rand() * 128;
        g.beginPath();
        g.ellipse(x, y, 6 + rand() * 22, 3 + rand() * 9, rand() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 0.5;
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (var w = 0; w < 10; w++) {
        g.beginPath();
        g.arc(rand() * 256, rand() * 128, 0.4 + rand() * 1.2, 0, Math.PI * 2);
        g.fill();
      }
      var tex = new THREE.CanvasTexture(cv);
      tex.encoding = THREE.sRGBEncoding; // r128 name (colorSpace is r152, ignored on this build)
      return tex;
    }

    // ---- skybox / lights --------------------------------------------------------
    function addSkybox(scene) {
      // Star points: thousands of tiny stars on a large sphere.
      var starCount = 4000;
      var positions = new Float32Array(starCount * 3);
      var colors = new Float32Array(starCount * 3);
      var rand = mulberry32(2024);
      var R = 900;
      for (var i = 0; i < starCount; i++) {
        // random point on sphere
        var u = rand() * 2 - 1;
        var phi = rand() * Math.PI * 2;
        var s = Math.sqrt(1 - u * u);
        positions[i * 3] = R * s * Math.cos(phi);
        positions[i * 3 + 1] = R * u;
        positions[i * 3 + 2] = R * s * Math.sin(phi);
        var b = 0.5 + rand() * 0.5;
        var tint = rand();
        if (tint < 0.18) { colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.85 + rand() * 0.15; colors[i * 3 + 2] = 0.65 + rand() * 0.2; }
        else if (tint < 0.30) { colors[i * 3] = 0.7 + rand() * 0.3; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 1.0; }
        else { colors[i * 3] = b; colors[i * 3 + 1] = b; colors[i * 3 + 2] = b; }
      }
      var sGeo = new THREE.BufferGeometry();
      sGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      sGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      var sMat = new THREE.PointsMaterial({
        size: 1.4, sizeAttenuation: false, vertexColors: true,
        transparent: true, opacity: 0.95, depthWrite: false
      });
      var stars = new THREE.Points(sGeo, sMat);
      stars.frustumCulled = false;
      scene.add(stars);

      // Nebula shells (very dim, so stars + Earth stay readable).
      var nebMat = new THREE.MeshBasicMaterial({
        map: makeNebulaTexture(), side: THREE.BackSide, transparent: true, opacity: 0.16, depthWrite: false
      });
      var neb = new THREE.Mesh(new THREE.SphereGeometry(760, 48, 32), nebMat);
      neb.frustumCulled = false;
      scene.add(neb);

      // Earth — textured, lit by the sun, hangs in the sky.
      var earth = new THREE.Mesh(
        new THREE.SphereGeometry(70, 48, 32),
        new THREE.MeshStandardMaterial({ map: makeEarthTexture(), roughness: 0.9, metalness: 0.05, emissive: 0x081018 })
      );
      earth.position.set(-520, 260, -680);
      earth.frustumCulled = false;
      scene.add(earth);

      // A soft Moon-lit ambience in case the sun is hidden behind the planet.
      var shell = new THREE.MeshBasicMaterial({ color: 0x05060c, side: THREE.BackSide, depthWrite: false, fog: false });
      var bg = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 32), shell);
      bg.frustumCulled = false;
      scene.add(bg);
    }

    function addLights(scene) {
      var hemi = new THREE.HemisphereLight(0xbcd8ff, 0x706048, 0.9);
      scene.add(hemi);

      var sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
      sun.position.set(300, 500, 240);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 2048;
      sun.shadow.mapSize.height = 2048;
      sun.shadow.camera.near = 50;
      sun.shadow.camera.far = 1400;
      var s = 220;
      sun.shadow.camera.left = -s;
      sun.shadow.camera.right = s;
      sun.shadow.camera.top = s;
      sun.shadow.camera.bottom = -s;
      sun.shadow.bias = -0.0015;
      sun.shadow.normalBias = 0.6;
      scene.add(sun);
      scene.add(sun.target);

      // warm fill opposite the sun for richer modelling
      var warm = new THREE.DirectionalLight(0xffb37a, 0.45);
      warm.position.set(-220, 80, -140);
      scene.add(warm);

      // Cool rim/key from the camera side (−Z). The sun sits at +Z behind the
      // default chase camera, so without this the lander reads as a dark
      // backlit silhouette; this edge light makes the gold foil + tanks pop.
      var rim = new THREE.DirectionalLight(0x9fb8ff, 0.45);
      rim.position.set(-150, 80, -300);
      scene.add(rim);
    }

    // ---- main build -------------------------------------------------------------
    function build(scene, cfg) {
      cfg = cfg || {};

      // Drop previous world root if rebuilding a planet.
      if (Apollo.Terrain.root && scene) {
        try { scene.remove(Apollo.Terrain.root); } catch (e) { /* */ }
      }

      // Size of the playfield in world units.
      var SIZE = cfg.size || 1100;
      var SEGS = cfg.segments || 384;
      var root = new THREE.Group();
      root.name = 'terrain-root';

      // ---- field parameters (seeded, shared with heightAt) ----------------------
      var seed = cfg.seed || 1337;
      var sm = makeNoise(seed);
      var craters = [];
      // Keep clear zones around every career pad (not just origin).
      var clearPads = (cfg.padDefs && cfg.padDefs.length)
        ? cfg.padDefs
        : [{ x: 0, z: 0 }];
      var crand = mulberry32(seed ^ 0x5eed);
      function placeCraters() {
        var placed = [];
        var attempts = 0;
        while (placed.length < 90 && attempts < 3000) {
          attempts++;
          var x = (crand() * 2 - 1) * SIZE * 0.46;
          var z = (crand() * 2 - 1) * SIZE * 0.46;
          var blocked = false;
          for (var ci = 0; ci < clearPads.length; ci++) {
            var cpx = clearPads[ci].x || 0, cpz = clearPads[ci].z || 0;
            if (Math.abs(x - cpx) < 70 && Math.abs(z - cpz) < 70) { blocked = true; break; }
          }
          if (blocked) continue;
          var r = 6 + crand() * 42;
          var ok = true;
          for (var i = 0; i < placed.length; i++) {
            var dx = x - placed[i].x, dz = z - placed[i].z;
            var minD = r + placed[i].r + 4;
            if (dx * dx + dz * dz < minD * minD) { ok = false; break; }
          }
          if (ok) placed.push({ x: x, z: z, r: r });
        }
        return placed;
      }
      craters = placeCraters();

      var tallMountains = [
        { x: 340, z: -280, r: 30 },
        { x: -370, z: -330, r: 36 },
        { x: 300, z: 350, r: 34 },
        { x: -300, z: 300, r: 28 },
        { x: 40, z: -460, r: 30 },
        { x: -420, z: 60, r: 26 },
        { x: 460, z: 40, r: 32 }
      ];
      craters = craters.concat(tallMountains.map(function (m) { return { x: m.x, z: m.z, r: m.r }; }));

      FIELD = {
        base: cfg.baseHeight || 0,
        sm: sm,
        ridgeFreq: cfg.ridgeFreq || 0.009,
        ridgeAmp: cfg.ridgeAmp || 28,
        mtnFreq: cfg.mtnFreq || 0.016,
        mtnAmp: cfg.mtnAmp || 16,
        // Fine detail faceted into a “pie crust” waffle on phone — nearly off.
        detFreq: cfg.detFreq || 0.028,
        detAmp: cfg.detAmp || 0.22,
        craters: craters
      };

      // ---- heightfield mesh -------------------------------------------------------
      var geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
      geo.rotateX(-Math.PI / 2);   // plane lies in XZ, +Y up

      var pos = geo.attributes.position;
      var count = pos.count;
      // displace + colour in one pass
      var colArr = new Float32Array(count * 3);
      var sm2 = makeNoise(seed ^ 0x77);
      for (var i = 0; i < count; i++) {
        var x = pos.getX(i), z = pos.getZ(i);
        var h = heightAt(x, z);
        pos.setY(i, h);

        // subtle albedo variation from a second noise field
        var a = sm2.fbm(x * 0.02, z * 0.02, 3, 2.0, 0.5);
        var lightness = 0.42 + (a - 0.5) * 0.35;
        colArr[i * 3] = lightness * 1.0;
        colArr[i * 3 + 1] = lightness * 0.96;
        colArr[i * 3 + 2] = lightness * 0.90;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      geo.computeVertexNormals();

      var groundCols = (cfg.palette && cfg.palette.ground) ? cfg.palette.ground : null;
      var groundTex = makeGroundTexture(groundCols);
      var normalTex = makeGroundNormTexture();
      var groundMat = new THREE.MeshStandardMaterial({
        map: groundTex,
        normalMap: normalTex,
        // Keep bump whisper-quiet — strong normals + dense mesh = pie crust.
        normalScale: new THREE.Vector2(0.12, 0.12),
        vertexColors: true,
        roughness: 0.98,
        metalness: 0.01,
        flatShading: false
      });

      var ground = new THREE.Mesh(geo, groundMat);
      ground.castShadow = false;
      ground.receiveShadow = true;
      ground.name = 'terrain-ground';
      root.add(ground);

      // ---- multi landing pads (career) -------------------------------------------
      var padDefs = (cfg.padDefs && cfg.padDefs.length)
        ? cfg.padDefs
        : [{ id: 'default', x: 0, z: 0, r: 8, name: 'PAD' }];
      var beaconHex = (cfg.palette && cfg.palette.beacon != null)
        ? cfg.palette.beacon : 0x35ff9e;

      // Clear FIELD.pads before measuring so heightAt samples raw terrain.
      FIELD.pads = [];
      FIELD.pad = null;

      var builtPads = [];
      var padMeshes = [];
      var pillars = [];

      function placeOnePad(def) {
        var PAD_RADIUS = def.r != null ? def.r : 8;
        var ox = def.x || 0, oz = def.z || 0;
        var padAvg = 0, padN = 0;
        for (var a = 0; a < 40; a++) {
          var ang = (a / 40) * Math.PI * 2;
          var px = ox + Math.cos(ang) * (PAD_RADIUS + 3);
          var pz = oz + Math.sin(ang) * (PAD_RADIUS + 3);
          padAvg += heightAt(px, pz);
          padN++;
        }
        padAvg /= Math.max(1, padN);
        var padY = padAvg + 0.6;
        var rec = {
          id: def.id || ('pad-' + builtPads.length),
          name: def.name || 'PAD',
          x: ox, z: oz, r: PAD_RADIUS, y: padY,
          mult: def.mult != null ? def.mult : 1,
          diff: def.diff != null ? def.diff : 1
        };
        builtPads.push(rec);
        FIELD.pads.push(rec);

        // Flatten terrain under this pad
        for (var i = 0; i < count; i++) {
          var x = pos.getX(i), z = pos.getZ(i);
          var dx = x - ox, dz = z - oz;
          var d = Math.sqrt(dx * dx + dz * dz);
          if (d <= PAD_RADIUS) {
            pos.setY(i, padY);
          } else if (d <= PAD_RADIUS + 3) {
            var t = (d - PAD_RADIUS) / 3;
            // use raw field height (temporarily ignore pads)
            var saved = FIELD.pads;
            FIELD.pads = [];
            var baseH = heightAt(x, z);
            FIELD.pads = saved;
            pos.setY(i, padY * (1 - t) + baseH * t);
          }
        }

        var padGeo = new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.6, 0.6, 40, 1, false);
        var padMat = new THREE.MeshStandardMaterial({
          map: makePadTexture(),
          roughness: 0.85,
          metalness: 0.12
        });
        var pad = new THREE.Mesh(padGeo, padMat);
        pad.position.set(ox, padY - 0.3, oz);
        pad.receiveShadow = true;
        pad.castShadow = true;
        pad.name = 'landing-pad';
        pad.userData.padId = rec.id;
        root.add(pad);
        padMeshes.push(pad);

        var beacon = new THREE.Mesh(
          new THREE.TorusGeometry(Math.max(1.5, PAD_RADIUS - 0.15), 0.16, 10, 48),
          new THREE.MeshStandardMaterial({
            color: 0xff5544, emissive: 0xcc2211, emissiveIntensity: 1.2, roughness: 0.5
          })
        );
        beacon.rotation.x = Math.PI / 2;
        beacon.position.set(ox, padY + 0.35, oz);
        beacon.name = 'landing-beacon';
        root.add(beacon);

        var pGeo = new THREE.CylinderGeometry(1.1, 1.1, 90, 20, 1, true);
        var pMat = new THREE.MeshBasicMaterial({
          color: beaconHex, transparent: true, opacity: 0.18,
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide
        });
        var pillar = new THREE.Mesh(pGeo, pMat);
        pillar.position.set(ox, padY + 45, oz);
        pillar.name = 'pad-pillar';
        pillar.userData.padId = rec.id;
        root.add(pillar);
        var pLight = new THREE.PointLight(beaconHex, 1.0, 140, 2);
        pLight.position.set(ox, padY + 40, oz);
        root.add(pLight);
        pillars.push({ mesh: pillar, light: pLight, padId: rec.id });
      }

      for (var pi = 0; pi < padDefs.length; pi++) placeOnePad(padDefs[pi]);

      // Primary pad (first / active) for legacy FIELD.pad + pulse targets
      FIELD.pad = builtPads[0] || null;
      // Soften vertex normals once more after pad flatten (kills hard faceting).
      geo.computeVertexNormals();
      ground.geometry.attributes.position.needsUpdate = true;
      if (ground.geometry.attributes.normal) ground.geometry.attributes.normal.needsUpdate = true;

      // ---- sky & lights ------------------------------------------------------------
      addSkybox(root, cfg);
      addLights(root, cfg);
      scene.add(root);

      // Active target pillar refs (game pulses the active one)
      var activePillar = pillars[0] ? pillars[0].mesh : null;
      var activeLight = pillars[0] ? pillars[0].light : null;
      Apollo.Terrain.pillar = activePillar;
      Apollo.Terrain.pillarLight = activeLight;
      Apollo.Terrain.pillars = pillars;
      Apollo.Terrain.root = root;

      return {
        groundMesh: ground,
        pads: builtPads,
        padMeshes: padMeshes,
        pillars: pillars,
        heightAt: heightAt,
        pillar: activePillar,
        pillarLight: activeLight,
        root: root,
        setActivePad: function (padId) {
          var found = null;
          for (var i = 0; i < pillars.length; i++) {
            var isOn = pillars[i].padId === padId;
            pillars[i].mesh.material.opacity = isOn ? 0.30 : 0.10;
            pillars[i].light.intensity = isOn ? 1.4 : 0.35;
            if (isOn) found = pillars[i];
          }
          if (found) {
            Apollo.Terrain.pillar = found.mesh;
            Apollo.Terrain.pillarLight = found.light;
          }
          for (var j = 0; j < builtPads.length; j++) {
            if (builtPads[j].id === padId) FIELD.pad = builtPads[j];
          }
          return found;
        }
      };
    }

    return {
      build: build,
      dispose: function (scene) {
        if (Apollo.Terrain.root && scene) {
          try { scene.remove(Apollo.Terrain.root); } catch (e) { /* */ }
        }
        Apollo.Terrain.root = null;
        Apollo.Terrain.pillar = null;
        Apollo.Terrain.pillarLight = null;
        Apollo.Terrain.pillars = null;
        FIELD = null;
      }
    };
  })();

})();
