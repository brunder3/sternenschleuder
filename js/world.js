/* Sternenschleuder world: renderer, sky, low-poly terrain, clouds, particles and the space backdrop.
   Two scenes are drawn per frame: a backdrop scene (sky, stars, sun, Earth and planets) that only
   copies the camera's rotation, then the main scene (terrain, launch site, objects, rocket). */
const World = (() => {
  'use strict';
  const T = THREE;
  const S = 0.1;                 // three.js units per physics unit
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  let renderer, scene, camera, bgScene, bgCamera;
  let hemi, sunLight, bgSunLight, skyMat, stars, sunSprite, sunCore, earth, earthGlow, galaxy, spiral, aurora, helio;
  const planets = {};
  // sun high on the right and slightly behind the camera, so terrain and planets are lit from the viewer's side
  const sunDir = new T.Vector3(-0.3, 0.68, 0.66).normalize();
  let lowPower = false;

  // ---------- noise ----------
  function hash(ix, iz) {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }
  function fbm(x, z, oct) {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f); n += amp; f *= 2.03; amp *= 0.5; }
    return s / n;
  }

  // ---------- terrain shape (three.js units) ----------
  const RIVER_Z = x => 150 * Math.sin(x * 0.0021) + 90 * Math.sin(x * 0.0057 + 1.3) - 230;
  function heightAt(x, z) {
    const d = Math.hypot(x, z);
    let h = 3 + (fbm(x * 0.004, z * 0.004, 4) - 0.5) * 18;
    const mask = clamp((fbm(x * 0.0011 + 31, z * 0.0011 - 17, 3) - 0.42) / 0.4, 0, 1) * smooth(350, 1400, d);
    const ridged = 1 - Math.abs(fbm(x * 0.0042 + 7, z * 0.0042 + 3, 4) * 2 - 1);
    h += Math.pow(mask, 1.5) * (36 + 80 * ridged * ridged);
    const rd = Math.abs(z - RIVER_Z(x));
    h = lerp(-3, h, smooth(12, 46, rd));
    const lake = fbm(x * 0.0026 - 50, z * 0.0026 + 90, 3);
    h = lerp(h, -4, smooth(0.6, 0.68, lake) * smooth(200, 500, d));
    return lerp(2.2, h, smooth(110, 300, d));
  }
  // heights on the 30-unit terrain grid, cached because chunks, trees and collisions share vertices
  const GRID = 30, gridCache = new Map();
  function gridH(i, j) {
    const k = i * 1048576 + j;
    let h = gridCache.get(k);
    if (h === undefined) {
      if (gridCache.size > 250000) gridCache.clear();
      h = heightAt(i * GRID, j * GRID); gridCache.set(k, h);
    }
    return h;
  }
  // height of the drawn surface: interpolates the same two triangles per grid cell as buildChunk
  function surfaceAt(x, z) {
    const i = Math.floor(x / GRID), j = Math.floor(z / GRID), fx = x / GRID - i, fz = z / GRID - j;
    const h00 = gridH(i, j), h10 = gridH(i + 1, j), h01 = gridH(i, j + 1), h11 = gridH(i + 1, j + 1);
    if ((i + j) & 1) {
      return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
        : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    }
    return fz >= fx ? h00 + (h01 - h00) * fz + (h11 - h01) * fx : h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  }
  // biome 0..1: fields (low) .. forest (high)
  function biomeAt(x, z) { return fbm(x * 0.006 + 300, z * 0.006 - 200, 3); }

  const C = {
    sand: new T.Color('#e3d293'), grass: new T.Color('#5fbd4b'), grass2: new T.Color('#79c94c'), field: new T.Color('#b9c252'),
    dry: new T.Color('#d39a4c'), forest: new T.Color('#3d8b3c'), rock: new T.Color('#8c918a'), rock2: new T.Color('#6f7a74'),
    snow: new T.Color('#f1f4f7'), bed: new T.Color('#c9b98a'),
  };
  const _c = new T.Color();
  function faceColor(h, ny, x, z) {
    const b = biomeAt(x, z), j = hash(Math.floor(x * 0.37), Math.floor(z * 0.37)) * 0.08 - 0.04;
    if (h < 0.4) _c.copy(C.bed);
    else if (h < 2.0) _c.copy(C.sand);
    else if (h > 92 && ny > 0.55) _c.copy(C.snow);
    else if (ny < 0.72 || h > 60) _c.copy(C.rock).lerp(C.rock2, clamp((60 - h) / 60, 0, 1) * 0.6);
    else if (b > 0.58) _c.copy(C.forest);
    else if (b < 0.36) _c.copy(b < 0.3 ? C.dry : C.field);
    else _c.copy(C.grass).lerp(C.grass2, clamp((b - 0.36) / 0.22, 0, 1));
    _c.offsetHSL(0, 0, j);
    return _c;
  }

  // ---------- terrain chunks ----------
  const CHUNK = 900, SEG = 30, RING = 3;   // CHUNK / SEG must equal GRID
  const chunks = new Map();
  let terrainMat, water, chunkQueue = [], lastChunkKey = '';
  function buildChunk(cx, cz) {
    const n = SEG + 1, step = CHUNK / SEG, x0 = cx * CHUNK, z0 = cz * CHUNK;
    const hs = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = gridH(cx * SEG + i, cz * SEG + j);
    const quads = SEG * SEG, pos = new Float32Array(quads * 18), col = new Float32Array(quads * 18);
    let p = 0;
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3(), nrm = new T.Vector3();
    function tri(ax, az, ah, bx, bz, bh, qx, qz, qh) {
      a.set(ax, ah, az); b.set(bx, bh, bz); c.set(qx, qh, qz);
      e1.subVectors(b, a); e2.subVectors(c, a); nrm.crossVectors(e2, e1).normalize();
      if (nrm.y < 0) nrm.negate();
      const col3 = faceColor((ah + bh + qh) / 3, nrm.y, (ax + bx + qx) / 3, (az + bz + qz) / 3);
      for (const v of [a, b, c]) { pos[p] = v.x; pos[p + 1] = v.y; pos[p + 2] = v.z; col[p] = col3.r; col[p + 1] = col3.g; col[p + 2] = col3.b; p += 3; }
    }
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const xa = x0 + i * step, xb = xa + step, za = z0 + j * step, zb = za + step;
      const h00 = hs[j * n + i], h10 = hs[j * n + i + 1], h01 = hs[(j + 1) * n + i], h11 = hs[(j + 1) * n + i + 1];
      if ((i + j) & 1) { tri(xa, za, h00, xa, zb, h01, xb, za, h10); tri(xb, za, h10, xa, zb, h01, xb, zb, h11); }
      else { tri(xa, za, h00, xa, zb, h01, xb, zb, h11); tri(xa, za, h00, xb, zb, h11, xb, za, h10); }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = new T.Mesh(geo, terrainMat);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  }
  function updateTerrain(camX, camZ, force) {
    const cx = Math.floor(camX / CHUNK), cz = Math.floor(camZ / CHUNK);
    const key = cx + ',' + cz;
    if (key !== lastChunkKey || force) {
      lastChunkKey = key;
      const want = new Set();
      for (let dz = -RING; dz <= RING; dz++) for (let dx = -RING; dx <= RING + 1; dx++) want.add((cx + dx) + ',' + (cz + dz));
      for (const [k, m] of chunks) if (!want.has(k)) { scene.remove(m); m.geometry.dispose(); chunks.delete(k); }
      chunkQueue = [...want].filter(k => !chunks.has(k)).sort((p, q) => {
        const [px, pz] = p.split(',').map(Number), [qx, qz] = q.split(',').map(Number);
        return Math.hypot(px - cx, pz - cz) - Math.hypot(qx - cx, qz - cz);
      });
    }
    // build a couple of chunks per frame so travelling never stalls
    let budget = force ? 999 : 2;
    while (chunkQueue.length && budget-- > 0) {
      const k = chunkQueue.shift();
      if (chunks.has(k)) continue;
      const [x, z] = k.split(',').map(Number);
      const m = buildChunk(x, z);
      chunks.set(k, m); scene.add(m);
    }
  }

  // ---------- trees, houses, flowers ----------
  function mergeColored(parts) {
    // parts: [{geo, color}] -> one non-indexed geometry with vertex colors
    let count = 0;
    const gs = parts.map(p => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; count += g.attributes.position.count; return g; });
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
    let o = 0;
    gs.forEach((g, i) => {
      g.computeVertexNormals();
      const c = new T.Color(parts[i].color);
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      for (let k = 0; k < g.attributes.position.count; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
      o += g.attributes.position.count;
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    return geo;
  }
  const deco = {};
  const groundMats = [];   // terrain, water and deco materials, faded together when the ground drops away
  const TREE_CELL = 11, TREE_R = 620;
  let lastDecoX = 1e9, lastDecoZ = 1e9, lastDecoT = -1;
  function buildDeco() {
    const flat = { flatShading: true, vertexColors: true, roughness: 0.9, metalness: 0 };
    const roundGeo = mergeColored([
      { geo: new T.CylinderGeometry(0.35, 0.5, 2.4, 5).translate(0, 1.2, 0), color: '#6b4a2b' },
      { geo: Models.jitter(new T.IcosahedronGeometry(2.1, 0), 0.12, 3).translate(0, 4.1, 0), color: '#4c9a45' },
    ]);
    const pineGeo = mergeColored([
      { geo: new T.CylinderGeometry(0.3, 0.42, 2, 5).translate(0, 1, 0), color: '#5a3d22' },
      { geo: new T.ConeGeometry(2.1, 3.6, 6).translate(0, 3.4, 0), color: '#2f7a48' },
      { geo: new T.ConeGeometry(1.6, 3, 6).translate(0, 5.4, 0), color: '#378a52' },
    ]);
    const houseGeo = mergeColored([
      { geo: new T.BoxGeometry(5, 3.4, 4).translate(0, 1.7, 0), color: '#e8e2d6' },
      { geo: new T.ConeGeometry(4.1, 2.6, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.85).translate(0, 4.7, 0), color: '#c8402f' },
      { geo: new T.BoxGeometry(1, 1.8, 0.1).translate(0.8, 0.9, 2.02), color: '#7a5a3a' },
    ]);
    const flowerGeo = new T.IcosahedronGeometry(0.35, 0);
    const mat = new T.MeshStandardMaterial(flat);
    deco.round = new T.InstancedMesh(roundGeo, mat, lowPower ? 1400 : 2200);
    deco.pine = new T.InstancedMesh(pineGeo, mat, lowPower ? 1100 : 1600);
    deco.house = new T.InstancedMesh(houseGeo, mat, 90);
    deco.flower = new T.InstancedMesh(flowerGeo, new T.MeshStandardMaterial({ roughness: 0.8 }), 600);
    groundMats.push(mat, deco.flower.material);
    for (const k of ['round', 'pine', 'house', 'flower']) { deco[k].castShadow = k !== 'flower'; deco[k].receiveShadow = true; deco[k].count = 0; deco[k].frustumCulled = false; scene.add(deco[k]); }
    const fc = ['#ff5a6e', '#ffd34d', '#ffffff', '#c86bff', '#ff8fb0'].map(c => new T.Color(c));
    for (let i = 0; i < 600; i++) deco.flower.setColorAt(i, fc[i % fc.length]);
    // wind turbines near the launch site
    deco.turbines = []; deco.turbineGroups = [];
    const tMat = Models.std('#e9edf3', 0.5, 0.2);
    for (const [x, z, s] of [[-140, 120, 1], [-210, 170, 0.9], [160, -150, 1.1], [260, 210, 0.95], [-60, -180, 0.85]]) {
      const g = new T.Group();
      const tower = new T.Mesh(new T.CylinderGeometry(0.5, 1, 30, 8), tMat); tower.position.y = 15; g.add(tower);
      const hub = new T.Group(); hub.position.set(0.9, 30, 0); g.add(hub);
      const nac = new T.Mesh(new T.BoxGeometry(3, 1.4, 1.4), tMat); nac.position.set(-0.6, 30, 0); g.add(nac);
      for (let k = 0; k < 3; k++) { const bl = new T.Mesh(new T.BoxGeometry(0.3, 12, 0.9).translate(0, 6, 0), tMat); bl.rotation.x = k * TAU / 3; hub.add(bl); }
      hub.rotation.y = 0;
      g.position.set(x, surfaceAt(x, z) - 0.5, z); g.scale.setScalar(s); g.rotation.y = Math.PI / 2 + 0.3;
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(g); deco.turbines.push(hub); deco.turbineGroups.push(g);
    }
  }
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _e = new T.Euler();
  function updateDeco(camX, camZ, camY, groundVis, t, force) {
    const visible = groundVis && camY < 900;
    for (const k of ['round', 'pine', 'house', 'flower']) deco[k].visible = visible;
    for (const g of deco.turbineGroups) g.visible = visible;
    if (!visible) return;
    if (Math.hypot(camX - lastDecoX, camZ - lastDecoZ) < 160) return;
    // a rebuild costs a few milliseconds: at most four per second, however fast the camera moves
    if (!force && t - lastDecoT < 0.25 && t >= lastDecoT) return;
    lastDecoX = camX; lastDecoZ = camZ; lastDecoT = t;
    let nr = 0, np = 0, nh = 0, nf = 0;
    const cap = { r: deco.round.instanceMatrix.count, p: deco.pine.instanceMatrix.count };
    const i0 = Math.floor((camX - TREE_R * 0.6) / TREE_CELL), i1 = Math.floor((camX + TREE_R * 1.6) / TREE_CELL);
    const jc = Math.floor(camZ / TREE_CELL), jr = Math.ceil(TREE_R / TREE_CELL);
    // rows are filled from the camera outwards, so a full instance buffer only loses the farthest rows
    for (let r = 0; r <= 2 * jr; r++) for (let i = i0; i <= i1; i++) {
      const j = jc + (r & 1 ? (r + 1) >> 1 : -(r >> 1));
      const hsh = hash(i * 7 + 3, j * 13 + 5);
      const x = i * TREE_CELL + hash(i, j) * TREE_CELL, z = j * TREE_CELL + hash(j, i) * TREE_CELL;
      const d = Math.hypot(x, z);
      if (d < 70) continue;
      const b = biomeAt(x, z);
      const dens = b > 0.58 ? 0.75 : b > 0.45 ? 0.16 : 0.035;
      if (hsh > dens) {
        // houses in open fields, flowers near the launch site
        if (nh < 90 && hsh > 0.996 && b < 0.5 && d > 120) {
          const h = surfaceAt(x, z);
          if (h > 2.5 && h < 30) { _e.set(0, hash(i, j * 3) * TAU, 0); _q.setFromEuler(_e); _s.setScalar(0.9 + hash(j, i * 5) * 0.4); _p.set(x, h - 0.2, z); _m.compose(_p, _q, _s); deco.house.setMatrixAt(nh++, _m); }
        } else if (nf < 600 && d < 320 && hsh < dens + 0.06) {
          const h = surfaceAt(x, z);
          if (h > 2) { _q.identity(); _s.setScalar(1); _p.set(x, h + 0.25, z); _m.compose(_p, _q, _s); deco.flower.setMatrixAt(nf++, _m); }
        }
        continue;
      }
      const h = surfaceAt(x, z);
      if (h < 2.4 || h > 70) continue;
      const pine = h > 25 || hash(i * 3, j) < 0.35;
      _e.set(0, hash(i, j * 7) * TAU, 0); _q.setFromEuler(_e);
      const sc = 0.75 + hash(j * 3, i) * 0.7;
      _s.set(sc, sc * (0.85 + hash(i, i + j) * 0.4), sc); _p.set(x, h - 0.3, z); _m.compose(_p, _q, _s);
      if (pine) { if (np < cap.p) deco.pine.setMatrixAt(np++, _m); }
      else if (nr < cap.r) deco.round.setMatrixAt(nr++, _m);
    }
    deco.round.count = nr; deco.pine.count = np; deco.house.count = nh; deco.flower.count = nf;
    for (const k of ['round', 'pine', 'house', 'flower']) deco[k].instanceMatrix.needsUpdate = true;
    if (deco.flower.instanceColor) deco.flower.instanceColor.needsUpdate = true;
  }

  // ---------- clouds ----------
  const clouds = [];
  let cloudMats;
  function cloudDensityU(Hu) { return typeof cloudDensity === 'function' ? cloudDensity(Hu) : 0; }
  function placeCloud(c, camX, camY, ahead) {
    // pick a height band around the camera, weighted by cloud density
    for (let tries = 0; tries < 6; tries++) {
      const y = Math.max(25, camY + (Math.random() * 2 - 1) * 420);
      const d = cloudDensityU(y / S) + (y < 140 ? 0.12 : 0);
      if (Math.random() < d * 1.6) {
        c.position.set(camX + (ahead ? 900 + Math.random() * 1700 : (Math.random() - 0.3) * 2400), y, (Math.random() * 2 - 1) * 900);
        const s = 50 + Math.random() * 110;
        c.scale.set(s, s * (0.45 + Math.random() * 0.2), 1);
        c.visible = true;
        return;
      }
    }
    c.visible = false;
    c.position.set(camX + 1200 + Math.random() * 1600, -500, 0);
  }
  function buildClouds() {
    const n = lowPower ? 50 : 90;
    for (let i = 0; i < n; i++) {
      // one material per cloud so each can fade on its own when the camera gets close
      const s = new T.Sprite(new T.SpriteMaterial({ map: Models.TEX.clouds[i % Models.TEX.clouds.length], transparent: true, depthWrite: false, fog: true, opacity: 0.95 }));
      s.visible = false; scene.add(s); clouds.push(s);
    }
  }
  function updateClouds(camX, camY, reset) {
    const cp = camera.position;
    const lowFade = groundFadeNow;   // clouds below the camera fade out together with the ground
    for (const c of clouds) {
      if (reset) { placeCloud(c, camX, camY, false); continue; }
      if (c.position.x < camX - 600 || Math.abs(c.position.y - camY) > 700) placeCloud(c, camX, camY, true);
      // fade clouds that come close to the camera instead of filling the screen with white
      const d = c.position.distanceTo(cp) - c.scale.x * 0.35;
      c.material.opacity = 0.95 * smooth(8, 70, d) * (c.position.y < camY - 60 ? lowFade : 1);
    }
  }

  // ---------- particles ----------
  function makeParticles(max, blending) {
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max);
    geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('pcolor', new T.BufferAttribute(col, 4).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('psize', new T.BufferAttribute(size, 1).setUsage(T.DynamicDrawUsage));
    const mat = new T.ShaderMaterial({
      uniforms: { map: { value: Models.TEX.dot }, scale: { value: 400 } },
      vertexShader: 'attribute float psize; attribute vec4 pcolor; varying vec4 vColor; uniform float scale;\n' +
        'void main(){ vColor = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vColor;\n' +
        'void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); }',
      transparent: true, depthWrite: false, blending,
    });
    geo.boundingSphere = new T.Sphere(new T.Vector3(), 1e5);
    const pts = new T.Points(geo, mat);
    pts.frustumCulled = false;
    const list = [];
    return {
      pts, mat, list,
      spawn(p) { if (list.length < max) { p.max = p.life; list.push(p); } },
      update(dt) {
        let n = 0, sx = 0, sy = 0, sz = 0;
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.life -= dt;
          if (p.life <= 0) { list[i] = list[list.length - 1]; list.pop(); continue; }
          const dr = Math.exp(-(p.drag || 0) * dt);
          p.vx *= dr; p.vy = p.vy * dr - (p.grav || 0) * dt; p.vz *= dr;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        }
        for (const p of list) {
          const k = p.life / p.max;
          pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
          sx += p.x; sy += p.y; sz += p.z;
          const c = k > 0.55 || !p.c2 ? p.c : p.c2;
          col[n * 4] = c[0]; col[n * 4 + 1] = c[1]; col[n * 4 + 2] = c[2];
          col[n * 4 + 3] = (p.a == null ? 1 : p.a) * (p.fadeIn ? Math.min(1, (1 - k) * 6) : 1) * Math.min(1, k * 1.6);
          size[n] = p.size * (1 + (1 - k) * (p.grow || 0));
          n++;
        }
        geo.setDrawRange(0, n);
        if (n) geo.boundingSphere.center.set(sx / n, sy / n, sz / n);
        geo.attributes.position.needsUpdate = true; geo.attributes.pcolor.needsUpdate = true; geo.attributes.psize.needsUpdate = true;
      },
      clear() { list.length = 0; geo.setDrawRange(0, 0); },
    };
  }
  let fxAdd, fxNorm;

  // ---------- sky & backdrop ----------
  function buildSky() {
    skyMat = new T.ShaderMaterial({
      uniforms: { top: { value: new T.Color() }, mid: { value: new T.Color() }, hor: { value: new T.Color() }, sunDir: { value: sunDir }, space: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunDir; uniform float space; varying vec3 vDir;',
        'void main(){',
        '  float y = vDir.y;',
        '  vec3 c = y > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.28, y)), top, smoothstep(0.25, 0.85, y)) : mix(hor, hor * 0.82, smoothstep(0.0, -0.4, y));',
        '  float s = max(dot(normalize(vDir), sunDir), 0.0);',
        '  c += vec3(1.0, 0.93, 0.78) * (pow(s, 8.0) * 0.22 * (1.0 - space) + pow(s, 90.0) * 0.5);',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
      side: T.BackSide, depthWrite: false,
    });
    const sky = new T.Mesh(new T.SphereGeometry(5000, 32, 16), skyMat);
    sky.renderOrder = -10; bgScene.add(sky);
    // stars, galaxy, sun and aurora: additive, but kept in the opaque pass (renderOrder decides their
    // order) so the planets and the Earth, which are opaque and drawn after them, cover them
    const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), r = Models.mulberry(7);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * 4200; pos[i * 3 + 1] = u * 4200; pos[i * 3 + 2] = Math.sin(a) * s * 4200;
      const t = r(), b = 0.55 + r() * 0.45;
      const c = t < 0.15 ? [0.7, 0.8, 1] : t < 0.25 ? [1, 0.88, 0.7] : [1, 1, 1];
      col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
    }
    const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.BufferAttribute(pos, 3)); sg.setAttribute('color', new T.BufferAttribute(col, 3));
    stars = new T.Points(sg, new T.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: false, blending: T.AdditiveBlending, opacity: 0, depthWrite: false, depthTest: false }));
    stars.renderOrder = -9; bgScene.add(stars);
    galaxy = new T.Mesh(new T.PlaneGeometry(9000, 4500), new T.MeshBasicMaterial({ map: Models.TEX.galaxy, transparent: false, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
    galaxy.position.set(1500, 2300, -2600); galaxy.lookAt(0, 0, 0); galaxy.rotateZ(-0.5); galaxy.renderOrder = -8; bgScene.add(galaxy);
    spiral = new T.Sprite(new T.SpriteMaterial({ map: Models.TEX.spiral, transparent: false, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
    spiral.position.set(3200, 700, 1400); spiral.scale.set(1500, 1500, 1); spiral.renderOrder = -8; bgScene.add(spiral);
    sunSprite = new T.Sprite(new T.SpriteMaterial({ map: Models.TEX.glow, color: 0xfff1c8, transparent: false, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
    sunSprite.position.copy(sunDir).multiplyScalar(4500); sunSprite.scale.set(1500, 1500, 1); sunSprite.renderOrder = -7; bgScene.add(sunSprite);
    sunCore = new T.Sprite(new T.SpriteMaterial({ map: Models.TEX.glow, color: 0xffffff, transparent: false, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
    sunCore.position.copy(sunSprite.position); sunCore.scale.set(380, 380, 1); sunCore.renderOrder = -7; bgScene.add(sunCore);
    // aurora curtain: an open cylinder segment ahead of the camera
    aurora = new T.Mesh(new T.CylinderGeometry(3000, 3000, 1300, 64, 1, true, -1.1 + Math.PI / 2, 2.2), new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, alpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform float time; uniform float alpha; varying vec2 vUv;',
        'void main(){',
        '  float x = vUv.x * 40.0;',
        '  float curtain = 0.5 + 0.5 * sin(x + sin(x * 0.37 + time * 0.6) * 2.0 + time * 0.3);',
        '  float band = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));',
        '  vec3 col = mix(vec3(0.25, 1.0, 0.6), vec3(1.0, 0.35, 0.85), smoothstep(0.35, 0.95, vUv.y));',
        '  gl_FragColor = vec4(col, alpha * band * (0.35 + 0.65 * curtain) * 0.55);',
        '}'].join('\n'),
      transparent: false, blending: T.AdditiveBlending, depthWrite: false, depthTest: false, side: T.DoubleSide,
    }));
    aurora.position.y = 700; aurora.renderOrder = -6; bgScene.add(aurora);
    // Earth seen from space and the planets on the way out
    bgSunLight = new T.DirectionalLight(0xffffff, 2.6); bgSunLight.position.copy(sunDir); bgScene.add(bgSunLight);
    bgScene.add(new T.AmbientLight(0x404a66, 0.35));
    earth = Models.planet('earth', 1000); earth.visible = false; earth.rotation.set(1.15, 0, 0.35); bgScene.add(earth);
    earthGlow = new T.Sprite(new T.SpriteMaterial({ map: Models.TEX.glow, color: 0x7cc4ff, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }));
    earthGlow.visible = false; earthGlow.renderOrder = -1; bgScene.add(earthGlow);
    for (const [k, r0] of [['moon', 1000], ['mars', 1000], ['jupiter', 1000], ['saturn', 1000]]) {
      const p = Models.planet(k, r0); p.visible = false; bgScene.add(p); planets[k] = p;
    }
  }

  // ---------- heliopause ----------
  function buildHelio() {
    helio = new T.Mesh(new T.PlaneGeometry(14000, 14000, 1, 1), new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, alpha: { value: 0 } },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform float time; uniform float alpha; varying vec3 vPos;',
        'void main(){',
        '  float w = sin(vPos.x * 0.004 + time) * sin(vPos.y * 0.005 - time * 0.7);',
        '  float r = length(vPos.xy) / 7000.0;',
        '  vec3 col = mix(vec3(0.55, 0.35, 1.0), vec3(0.35, 0.85, 1.0), 0.5 + 0.5 * w);',
        '  gl_FragColor = vec4(col, alpha * (0.35 + 0.25 * w) * (1.0 - r));',
        '}'].join('\n'),
      transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide,
    }));
    helio.rotation.x = -Math.PI / 2;
    helio.visible = false;
    scene.add(helio);
  }

  // ---------- init ----------
  function init(canvas) {
    lowPower = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;
    renderer = new T.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.autoClear = false;
    scene = new T.Scene();
    bgScene = new T.Scene();
    camera = new T.PerspectiveCamera(60, 1, 0.5, 9000);
    bgCamera = new T.PerspectiveCamera(60, 1, 1, 2e6);
    scene.fog = new T.Fog(0xcfe9ff, 600, 3200);
    hemi = new T.HemisphereLight(0xcfe8ff, 0x4a6a3a, 1.35); scene.add(hemi);
    sunLight = new T.DirectionalLight(0xfff2dc, 2.4);
    sunLight.position.copy(sunDir).multiplyScalar(120);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    const sc = sunLight.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight); scene.add(sunLight.target);
    Models.buildTextures();
    terrainMat = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
    water = new T.Mesh(new T.PlaneGeometry(14000, 14000), new T.MeshStandardMaterial({ color: 0x3f93e6, roughness: 0.22, metalness: 0.15, transparent: true, opacity: 0.9 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0; water.receiveShadow = true; water.renderOrder = -1; scene.add(water);
    groundMats.push(terrainMat, water.material);
    buildSky();
    buildDeco();
    buildClouds();
    buildHelio();
    fxAdd = makeParticles(lowPower ? 500 : 900, T.AdditiveBlending);
    fxNorm = makeParticles(lowPower ? 400 : 700, T.NormalBlending);
    scene.add(fxNorm.pts); scene.add(fxAdd.pts);
    updateTerrain(0, 0, true);
    updateDeco(0, 0, 0, true, 0, true);
    updateClouds(0, 30, true);
  }
  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    updateParticleScale();
  }
  function updateParticleScale() {
    const hpx = renderer.domElement.height;
    const s = hpx / (2 * Math.tan(camera.fov * Math.PI / 360));
    if (fxAdd) { fxAdd.mat.uniforms.scale.value = s; fxNorm.mat.uniforms.scale.value = s; }
  }

  // ---------- per-frame ----------
  const _sky = [new T.Color(), new T.Color(), new T.Color()];
  let skyStops = null;
  function skyAt(Hu) {
    if (!skyStops) skyStops = SKY_STOPS.map(s => ({ H: s.H, c: s.c.map(x => new T.Color(x)) }));
    let i = 0;
    while (i < skyStops.length - 1 && Hu >= skyStops[i + 1].H) i++;
    if (i >= skyStops.length - 1) { skyStops[i].c.forEach((c, k) => _sky[k].copy(c)); return _sky; }
    const a = skyStops[i], b = skyStops[i + 1], t = smooth(a.H, b.H, Hu);
    for (let k = 0; k < 3; k++) _sky[k].copy(a.c[k]).lerp(b.c[k], t);
    return _sky;
  }
  let groundFadeNow = 1;
  function setGroundFade(f) {
    if (f === groundFadeNow) return;
    const tr = f < 0.999, was = groundFadeNow < 0.999;
    groundFadeNow = f;
    for (const m of groundMats) {
      if (m === water.material) { m.opacity = 0.9 * f; continue; }
      m.opacity = f;
      if (tr !== was) { m.transparent = tr; m.needsUpdate = true; }
    }
  }
  // Earth seen from the rocket: altitude in Earth radii at each zone height. It stays a flat horizon
  // while the terrain is still drawn, then shrinks to a globe and a distant dot at the Heliopause.
  // (x = height / ZH.meso: 2.15 end of the terrain fade, 2.59 geostationary, 3.55 Moon, 4.86 Mars, 17.1 Heliopause)
  const EARTH_HV = [[0.9, 0.0025], [1.6, 0.006], [2.15, 0.015], [2.59, 0.15], [3.0, 0.6], [3.55, 2], [4.86, 8], [6.66, 20], [9.13, 40], [12.48, 70], [17.1, 120]];
  function earthHv(Hu) {
    const x = Hu / ZH.meso, A = EARTH_HV;
    if (x <= A[0][0]) return A[0][1];
    for (let i = 1; i < A.length; i++) {
      if (x <= A[i][0]) {
        const k = (x - A[i - 1][0]) / (A[i][0] - A[i - 1][0]);
        return Math.exp(lerp(Math.log(A[i - 1][1]), Math.log(A[i][1]), k));
      }
    }
    return A[A.length - 1][1];
  }
  const _v = new T.Vector3();
  function placeBody(obj, dir, dist, radius) {
    obj.position.copy(dir).multiplyScalar(dist);
    obj.scale.setScalar(radius / 1000);
  }
  function update(dt, t, Hu) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const sky = skyAt(Hu);
    skyMat.uniforms.top.value.copy(sky[0]); skyMat.uniforms.mid.value.copy(sky[1]); skyMat.uniforms.hor.value.copy(sky[2]);
    const space = smooth(ZH.meso, zoneFrac('space', 0.4), Hu);
    skyMat.uniforms.space.value = space;
    // fog: the haze thins out with altitude; terrain disappears once we are in space
    scene.fog.color.copy(sky[2]);
    // fog ends before the edge of the loaded terrain ring (2700 units to the side and behind)
    scene.fog.near = Math.min(260 + cy * 2.5, 1700);
    scene.fog.far = Math.min(2550 + cy * 1.2, 3000);
    // high up the ground fades into the Earth of the backdrop instead of vanishing at once
    const groundFade = 1 - smooth(ZH.space * S * 1.08, ZH.space * S * 1.56, cy);
    const groundVis = groundFade > 0.001;
    setGroundFade(groundFade);
    water.visible = groundVis;
    for (const m of chunks.values()) m.visible = groundVis;
    if (groundVis) { updateTerrain(cx, cz, false); water.position.set(cx, 0, cz); }
    updateDeco(cx, cz, cy, groundVis, t, false);
    for (const h of deco.turbines) h.rotation.x += dt * 1.3;
    updateClouds(cx, cy, false);
    hemi.intensity = lerp(1.35, 0.45, space);
    sunLight.intensity = lerp(2.4, 3.0, space);
    // stars, galaxy, sun
    stars.material.opacity = smooth(zoneFrac('strato', 0.6), zoneFrac('space', 0.3), Hu);
    galaxy.material.opacity = smooth(ZH.space, zoneFrac('orbit', 0.5), Hu) * 0.55;
    spiral.material.opacity = smooth(ZH.saturn, zoneFrac('saturn', 0.8), Hu) * 0.9;
    const far = 1 / (1 + Math.max(0, Hu - ZH.moon) / (ZH.jupiter - ZH.moon) * 2);
    sunCore.scale.setScalar(lerp(260, 420, space) * (0.4 + 0.6 * far));
    sunSprite.material.opacity = lerp(0.7, 0.45, space);
    aurora.material.uniforms.time.value = t;
    aurora.material.uniforms.alpha.value = smooth(zoneFrac('meso', -0.15), zoneFrac('meso', 0.35), Hu) * (1 - smooth(zoneFrac('space', 0.2), zoneFrac('space', 0.8), Hu));
    aurora.visible = aurora.material.uniforms.alpha.value > 0.01;
    // Earth: a horizon below at first, then a shrinking globe ahead and below
    if (Hu > ZH.meso * 0.9) {
      const hv = earthHv(Hu);
      const dist = 1000 * (1 + hv);
      const k = smooth(0, 1, clamp(hv / 1.5, 0, 1));
      _v.set(lerp(0, 0.75, k), -1, lerp(0, -0.45, k)).normalize();
      earth.visible = true; earthGlow.visible = true;
      earth.position.copy(_v).multiplyScalar(dist); earth.scale.setScalar(1);
      // the home continent stays below while the Earth is still a horizon, then the globe turns
      earth.userData.sphere.rotation.y += dt * 0.01 * smooth(0.2, 2, hv);
      earthGlow.position.copy(earth.position); earthGlow.scale.setScalar(2900);
      earthGlow.material.opacity = 0.75;
    } else { earth.visible = false; earthGlow.visible = false; earth.userData.sphere.rotation.y = 0; }
    // planets pass by as the altitude climbs through their zones
    const BODIES = [['moon', ZH.moon, ZH.mars - ZH.moon, 0.27, 0.42], ['mars', ZH.mars, ZH.belt - ZH.mars, 0.21, -0.45], ['jupiter', ZH.jupiter, ZH.saturn - ZH.jupiter, 0.42, 0.5], ['saturn', ZH.saturn, ZH.edge - ZH.saturn, 0.3, -0.5]];
    for (const [k, Hc, span, size, az] of BODIES) {
      const p = planets[k], d = (Hu - Hc) / (span * 0.8);
      if (d < -1.8 || d > 1.6) { p.visible = false; continue; }
      p.visible = true;
      const el = -d * 0.6 + 0.05, ang = size / (1 + Math.abs(d) * 1.6);
      _v.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
      const dist = 60000;
      placeBody(p, _v, dist, dist * Math.tan(ang));
      p.userData.sphere.rotation.y += dt * 0.02;
    }
    // heliopause shimmer above the goal height
    const gy = GOAL_H * S;
    helio.visible = cy > gy - 2500;
    if (helio.visible) { helio.position.set(cx, gy, cz); helio.material.uniforms.time.value = t; helio.material.uniforms.alpha.value = smooth(gy - 2500, gy - 300, cy) * (1 - smooth(gy + 200, gy + 800, cy)); }
    // shadow camera follows the action near the ground
    sunLight.target.position.set(cx + 20, Math.max(0, cy - 15), cz * 0.3);
    sunLight.position.copy(sunLight.target.position).addScaledVector(sunDir, 150);
    fxAdd.update(dt); fxNorm.update(dt);
  }
  function render() {
    bgCamera.quaternion.copy(camera.quaternion);
    if (bgCamera.fov !== camera.fov || bgCamera.aspect !== camera.aspect) { bgCamera.fov = camera.fov; bgCamera.aspect = camera.aspect; bgCamera.updateProjectionMatrix(); updateParticleScale(); }
    renderer.clear();
    renderer.render(bgScene, bgCamera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  return {
    S, init, resize, update, render, heightAt, surfaceAt, RIVER_Z,
    get renderer() { return renderer; }, get scene() { return scene; }, get camera() { return camera; },
    fx: { add: p => fxAdd.spawn(p), norm: p => fxNorm.spawn(p), clear() { fxAdd.clear(); fxNorm.clear(); } },
    resetClouds(x, y) { updateClouds(x, y, true); },
    get lowPower() { return lowPower; },
  };
})();
