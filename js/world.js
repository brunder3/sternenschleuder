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
  const planets = {}, deep = [];
  // sun high on the right and slightly behind the camera, so terrain and planets are lit from the viewer's side
  const sunDir = new T.Vector3(-0.3, 0.68, 0.66).normalize();
  let lowPower = false;
  const GFX_KEY = 'sternenschleuder.grafik';
  let photoSky = null;
  let composer = null, bloom = null, pmrem = null, envRT = null, envHu = -1, envTime = -99;

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
    h += (fbm(x * 0.031 + 11, z * 0.031 - 5, 2) - 0.5) * 3.2 * smooth(12, 40, rd);   // small bumps and gullies
    const lake = fbm(x * 0.0026 - 50, z * 0.0026 + 90, 3);
    h = lerp(h, -4, smooth(0.6, 0.68, lake) * smooth(200, 500, d));
    return lerp(2.2, h, smooth(110, 300, d));
  }
  // heights on the 30-unit terrain grid, cached because chunks, trees and collisions share vertices
  const GRID = 15, gridCache = new Map();
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

  // natural, slightly muted colours; vertex colours blend smoothly between them
  const C = {
    sand: new T.Color('#cdb683'), grass: new T.Color('#4a8a2c'), grass2: new T.Color('#6a9a34'), field: new T.Color('#a39c45'),
    dry: new T.Color('#ab8a4e'), forest: new T.Color('#2b5a23'), rock: new T.Color('#7b776f'), rock2: new T.Color('#5c5a55'),
    snow: new T.Color('#eef1f4'), bed: new T.Color('#7d735a'),
  };
  const _c = new T.Color(), _c2 = new T.Color();
  function faceColor(h, ny, x, z) {
    const b = biomeAt(x, z), j = (fbm(x * 0.05, z * 0.05, 2) - 0.5) * 0.12;
    // grass, fields and forest blend by biome
    if (b > 0.58) _c.copy(C.grass2).lerp(C.forest, smooth(0.58, 0.66, b));
    else if (b < 0.36) _c.copy(C.dry).lerp(C.field, smooth(0.26, 0.34, b)).lerp(C.grass, smooth(0.32, 0.36, b));
    else _c.copy(C.grass).lerp(C.grass2, clamp((b - 0.36) / 0.22, 0, 1));
    // beaches, river beds, rock on steep or high ground, snow on the peaks
    _c.lerp(C.sand, 1 - smooth(0.5, 1.5, h));
    _c.lerp(C.bed, 1 - smooth(-0.6, 0.6, h));
    _c2.copy(C.rock).lerp(C.rock2, clamp((60 - h) / 60, 0, 1) * 0.6);
    _c.lerp(_c2, Math.max(1 - smooth(0.62, 0.8, ny), smooth(48, 70, h)));
    _c.lerp(C.snow, smooth(82, 98, h) * smooth(0.5, 0.7, ny));
    _c.offsetHSL(0, 0, j);
    return _c;
  }

  // With photo textures: how much grass, rock, sand, soil and snow each vertex shows, plus a colour tint
  // for forests, meadows and dry fields. Same rules as faceColor().
  const SPL = [0, 0, 0, 0], _t = new T.Color(), TINT = { forest: new T.Color(0.55, 0.72, 0.52), lush: new T.Color(1.08, 1.06, 0.9), dry: new T.Color(1.15, 1.0, 0.75) };
  function surfaceMix(h, ny, x, z) {
    const b = biomeAt(x, z);
    let g = 1, r = 0, sa = 0, so = 0;
    const mixIn = (w, k) => { g *= 1 - w; r *= 1 - w; sa *= 1 - w; so *= 1 - w; if (k === 0) g += w; else if (k === 1) r += w; else if (k === 2) sa += w; else so += w; };
    mixIn(1 - smooth(0.28, 0.35, b), 3);                                    // fields and dry ground
    mixIn(1 - smooth(0.5, 1.5, h), 2);                                      // beaches
    mixIn(1 - smooth(-0.6, 0.6, h), 3);                                     // river beds
    mixIn(Math.max(1 - smooth(0.62, 0.8, ny), smooth(48, 70, h)), 1);       // cliffs and high ground
    const snow = smooth(82, 98, h) * smooth(0.5, 0.7, ny);
    SPL[0] = g * (1 - snow); SPL[1] = r * (1 - snow); SPL[2] = sa * (1 - snow); SPL[3] = so * (1 - snow);
    _t.setRGB(1, 1, 1).lerp(TINT.lush, smooth(0.4, 0.55, b)).lerp(TINT.forest, smooth(0.58, 0.68, b)).lerp(TINT.dry, (1 - smooth(0.26, 0.34, b)) * 0.6);
    _t.multiplyScalar(1 + (fbm(x * 0.05, z * 0.05, 2) - 0.5) * 0.22);
    return _t;
  }
  // terrain material: photo textures sampled in world space at two scales, blended by the splat weights
  function photoTerrainMaterial() {
    const P = Models.TEX.photo;
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.35 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { tGrass: { value: P.grass }, tRock: { value: P.rock }, tSand: { value: P.sand }, tSoil: { value: P.soil } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass, tRock, tSand, tSoil;\nvarying vec4 vSplat;\nvarying vec3 vWPos;')
        .replace('#include <map_fragment>', [
          'float camD = length(vWPos - cameraPosition), farK = 0.3 + 0.5 * smoothstep(40.0, 420.0, camD);',
          'vec2 q1 = vWPos.xz / 7.0, q2 = vWPos.xz / 63.0 + 0.37;',
          'vec3 cG = mix(texture2D(tGrass, q1).rgb, texture2D(tGrass, q2).rgb, farK);',
          'vec3 cR = mix(texture2D(tRock, q1 * 0.6).rgb, texture2D(tRock, q2).rgb, farK);',
          'vec3 cS = mix(texture2D(tSand, q1).rgb, texture2D(tSand, q2).rgb, farK);',
          'vec3 cD = mix(texture2D(tSoil, q1).rgb, texture2D(tSoil, q2).rgb, farK);',
          'float snowW = clamp(1.0 - dot(vSplat, vec4(1.0)), 0.0, 1.0);',
          'diffuseColor.rgb *= cG * vSplat.x + cR * vSplat.y + cS * vSplat.z + cD * vSplat.w + vec3(0.85, 0.87, 0.9) * snowW;',
        ].join('\n'));
    };
    return mat;
  }

  // ---------- terrain chunks ----------
  // Smooth-shaded height field. Normals come from the shared height grid, so neighbouring chunks meet
  // without seams; the triangle split per cell matches surfaceAt().
  const CHUNK = 900, SEG = 60, RING = 3;   // CHUNK / SEG must equal GRID
  const chunks = new Map();
  let terrainMat, water, chunkQueue = [], lastChunkKey = '';
  function buildChunk(cx, cz) {
    const n = SEG + 1, x0 = cx * CHUNK, z0 = cz * CHUNK, i0 = cx * SEG, j0 = cz * SEG;
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    const photo = !!Models.TEX.photo, spl = photo ? new Float32Array(n * n * 4) : null;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, gi = i0 + i, gj = j0 + j, x = x0 + i * GRID, z = z0 + j * GRID, h = gridH(gi, gj);
      const nx = gridH(gi - 1, gj) - gridH(gi + 1, gj), nz = gridH(gi, gj - 1) - gridH(gi, gj + 1), ny = 2 * GRID;
      const len = Math.hypot(nx, ny, nz);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      nor[k * 3] = nx / len; nor[k * 3 + 1] = ny / len; nor[k * 3 + 2] = nz / len;
      const c3 = photo ? surfaceMix(h, ny / len, x, z) : faceColor(h, ny / len, x, z);
      if (photo) spl.set(SPL, k * 4);
      col[k * 3] = c3.r; col[k * 3 + 1] = c3.g; col[k * 3 + 2] = c3.b;
      uv[k * 2] = x / 48; uv[k * 2 + 1] = z / 48;
    }
    const idx = new Uint32Array(SEG * SEG * 6);
    let p = 0;
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;   // a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1)
      if ((i0 + i + j0 + j) & 1) { idx.set([a, c, b, b, c, d], p); }
      else { idx.set([a, c, d, a, d, b], p); }
      p += 6;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (photo) geo.setAttribute('splat', new T.BufferAttribute(spl, 4));
    geo.setIndex(new T.BufferAttribute(idx, 1));
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
    let budget = force ? 999 : 1;
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
    // smooth normals are computed on the indexed shape first, then kept when it is unrolled
    const gs = parts.map(p => { p.geo.computeVertexNormals(); const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; count += g.attributes.position.count; return g; });
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
    let o = 0;
    gs.forEach((g, i) => {
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
    const flat = { vertexColors: true, roughness: 0.9, metalness: 0 };
    const roundGeo = mergeColored([
      { geo: new T.CylinderGeometry(0.28, 0.45, 2.8, 8).translate(0, 1.4, 0), color: '#4f3b2a' },
      { geo: Models.jitter(new T.IcosahedronGeometry(1.9, 2), 0.1, 3).translate(0, 4.3, 0), color: '#3d6a2b' },
      { geo: Models.jitter(new T.IcosahedronGeometry(1.35, 2), 0.1, 5).translate(1.1, 3.6, 0.5), color: '#456f30' },
      { geo: Models.jitter(new T.IcosahedronGeometry(1.25, 2), 0.1, 7).translate(-1.0, 3.8, -0.6), color: '#36602a' },
      { geo: Models.jitter(new T.IcosahedronGeometry(1.1, 2), 0.1, 9).translate(0.2, 5.6, -0.2), color: '#4a7834' },
    ]);
    const pineGeo = mergeColored([
      { geo: new T.CylinderGeometry(0.22, 0.38, 2, 8).translate(0, 1, 0), color: '#4a3524' },
      { geo: new T.ConeGeometry(2.0, 3.0, 12).translate(0, 2.9, 0), color: '#24452b' },
      { geo: new T.ConeGeometry(1.6, 2.7, 12).translate(0, 4.4, 0), color: '#2a4f31' },
      { geo: new T.ConeGeometry(1.15, 2.4, 12).translate(0, 5.8, 0), color: '#2e5635' },
      { geo: new T.ConeGeometry(0.7, 1.9, 10).translate(0, 7.0, 0), color: '#335c38' },
    ]);
    const houseGeo = mergeColored([
      { geo: new T.BoxGeometry(5, 3.4, 4).translate(0, 1.7, 0).toNonIndexed(), color: '#ddd5c6' },
      { geo: new T.ConeGeometry(4.1, 2.6, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.85).translate(0, 4.7, 0).toNonIndexed(), color: '#8f3b2c' },
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
        'void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(pow(vColor.rgb, vec3(2.2)), vColor.a * t.a);\n' +
        '  #include <colorspace_fragment>\n' +
        '}',
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
    // photographed sky with real clouds near the ground; it fades into the drawn sky on the way up
    if (Models.TEX.skyCube) {
      photoSky = new T.Mesh(new T.BoxGeometry(4600, 4600, 4600), new T.ShaderMaterial({
        uniforms: { cube: { value: Models.TEX.skyCube }, fade: { value: 1 }, gain: { value: 1.25 } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform samplerCube cube; uniform float fade; uniform float gain; varying vec3 vDir;\n' +
          'void main(){ vec3 c = textureCube(cube, vec3(-vDir.x, vDir.y, vDir.z)).rgb * gain; gl_FragColor = vec4(c, fade);\n#include <colorspace_fragment>\n}',
        side: T.BackSide, transparent: true, depthWrite: false, depthTest: false,
      }));
      photoSky.rotation.y = 2.2; photoSky.renderOrder = -9.5; bgScene.add(photoSky);
    }
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
    galaxy.position.set(1500, 2300, -2600); galaxy.lookAt(0, 0, 0); galaxy.rotateZ(-0.5); galaxy.renderOrder = -8;
    if (Models.TEX.photo) {
      // a real panorama of the Milky Way wrapped around the sky, tilted like the galactic plane
      galaxy = new T.Mesh(new T.CylinderGeometry(4200, 4200, 2100, 64, 1, true), new T.MeshBasicMaterial({ map: Models.TEX.photo.milkyway, side: T.BackSide, transparent: false, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
      galaxy.rotation.set(1.05, 0.4, 0.3); galaxy.renderOrder = -8;
    }
    bgScene.add(galaxy);
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
    bgScene.add(new T.AmbientLight(0x404a66, 0.6));
    earth = Models.planet('earth', 1000); earth.visible = false; earth.rotation.set(1.15, 0, 0.35); bgScene.add(earth);
    earthGlow = new T.Sprite(new T.SpriteMaterial({ map: Models.TEX.glow, color: 0x7cc4ff, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }));
    earthGlow.visible = false; earthGlow.renderOrder = -1; bgScene.add(earthGlow);
    for (const [k, r0] of [['moon', 1000], ['mars', 1000], ['jupiter', 1000], ['saturn', 1000]]) {
      const p = Models.planet(k, r0); p.visible = false; bgScene.add(p); planets[k] = p;
    }
    // stars and nebulae between here and Andromeda: glowing sprites that grow while you approach
    const glow = (color, opacity) => new T.SpriteMaterial({ map: Models.TEX.glow, color, transparent: false, opacity, blending: T.AdditiveBlending, depthWrite: false, depthTest: false });
    const star = (color, core) => { const g = new T.Group(); const h = new T.Sprite(glow(color, 0.9)); g.add(h); const c = new T.Sprite(glow(0xffffff, 1)); c.scale.setScalar(core); g.add(c); return g; };
    const cluster = new T.Group();
    for (const [x, y, s] of [[0, 0, 1], [0.5, 0.2, 0.7], [-0.45, 0.3, 0.8], [0.2, -0.45, 0.65], [-0.3, -0.35, 0.6], [0.75, -0.2, 0.5], [-0.7, -0.05, 0.55]]) {
      const st = star(0x9ec4ff, 0.3); st.scale.setScalar(s * 0.45); st.position.set(x * 0.5, y * 0.5, 0); cluster.add(st);
    }
    const nebula = new T.Sprite(new T.SpriteMaterial({ map: Models.TEX.nebula, transparent: false, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
    deep.push(
      { obj: star(0xff6a40, 0.22), H: ZH.proxima, next: ZH.wega, size: 0.3, az: 0.3 },
      { obj: star(0xbcd6ff, 0.3), H: ZH.wega, next: ZH.plejaden, size: 0.36, az: -0.3 },
      { obj: cluster, H: ZH.plejaden, next: ZH.orionnebel, size: 0.3, az: 0.45 },
      { obj: nebula, H: ZH.orionnebel, next: ZH.zentrum, size: 0.5, az: -0.35 },
      { obj: star(0xffd28a, 0.35), H: ZH.zentrum, next: ZH.andromeda, size: 0.7, az: 0.25 },
    );
    for (const d of deep) { d.obj.visible = false; d.obj.renderOrder = -7; d.obj.traverse(o => { o.renderOrder = -7; }); bgScene.add(d.obj); }
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
    // quality: phones and small machines skip bloom; the menu switch (stored per browser) or
    // ?grafik=hoch / ?grafik=niedrig overrides the guess
    let q = null; try { q = new URLSearchParams(location.search).get('grafik'); } catch (e) { /* no query */ }
    if (q !== 'hoch' && q !== 'niedrig') { try { q = localStorage.getItem(GFX_KEY); } catch (e) { /* storage blocked */ } }
    lowPower = q === 'niedrig' ? true : q === 'hoch' ? false : /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;
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
    camera = new T.PerspectiveCamera(60, 1, 1, 9000);   // a nearer near plane would cost depth precision (flicker at the shores)
    bgCamera = new T.PerspectiveCamera(60, 1, 1, 2e6);
    scene.fog = new T.Fog(0xcfe9ff, 600, 3200);
    hemi = new T.HemisphereLight(0xcfe8ff, 0x4a6a3a, 0.35); scene.add(hemi);
    sunLight = new T.DirectionalLight(0xfff2dc, 3.2);
    sunLight.position.copy(sunDir).multiplyScalar(120);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    const sc = sunLight.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight); scene.add(sunLight.target);
    Models.buildTextures();
    terrainMat = Models.TEX.photo ? photoTerrainMaterial() : new T.MeshStandardMaterial({ vertexColors: true, map: Models.TEX.ground, roughness: 0.95, metalness: 0, envMapIntensity: 0.4 });
    Models.TEX.waterNormal.repeat.set(110, 110);
    water = new T.Mesh(new T.PlaneGeometry(14000, 14000), new T.MeshPhysicalMaterial({ color: 0x15405c, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.93,
      normalMap: Models.TEX.waterNormal, normalScale: new T.Vector2(0.22, 0.22), envMapIntensity: 0.85, clearcoat: 0.4, clearcoatRoughness: 0.05,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0; water.receiveShadow = true; water.renderOrder = -1; scene.add(water);
    groundMats.push(terrainMat, water.material);
    buildSky();
    buildDeco();
    buildClouds();
    buildHelio();
    // reflections and soft ambient light come from the sky itself (image-based lighting)
    pmrem = new T.PMREMGenerator(renderer);
    if (!lowPower) buildComposer();
    fxAdd = makeParticles(lowPower ? 500 : 900, T.AdditiveBlending);
    fxNorm = makeParticles(lowPower ? 400 : 700, T.NormalBlending);
    scene.add(fxNorm.pts); scene.add(fxAdd.pts);
    updateTerrain(0, 0, true);
    updateDeco(0, 0, 0, true, 0, true);
    updateClouds(0, 30, true);
  }
  // bloom for flames, sun and stars, with multisampled anti-aliasing (skipped on phones)
  function buildComposer() {
    if (!T.EffectComposer) return;
    const rt = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: 4 });
    composer = new T.EffectComposer(renderer, rt);
    composer.addPass(new T.RenderPass(bgScene, bgCamera));
    const main = new T.RenderPass(scene, camera); main.clear = false; main.clearDepth = true;
    composer.addPass(main);
    bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.32, 0.45, 1.0);
    composer.addPass(bloom);
    composer.addPass(new T.OutputPass());
  }
  // switch the quality while playing: bloom and MSAA, pixel ratio and shadow resolution
  function setQuality(high) {
    lowPower = !high;
    try { localStorage.setItem(GFX_KEY, high ? 'hoch' : 'niedrig'); } catch (e) { /* storage blocked */ }
    if (high && !composer) buildComposer();
    if (!high && composer) { bloom.dispose(); composer.dispose(); composer = null; bloom = null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
    const m = lowPower ? 1024 : 2048;
    if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    sunLight.shadow.mapSize.set(m, m);
    if (size) resize(size[0], size[1]);
  }
  let size = null;
  function resize(w, h) {
    size = [w, h];
    renderer.setSize(w, h, false);
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
    camera.aspect = w / h; camera.updateProjectionMatrix();
    updateParticleScale();
  }
  function updateParticleScale() {
    const hpx = renderer.domElement.height;
    const s = hpx / (2 * Math.tan(camera.fov * Math.PI / 360));
    if (fxAdd) { fxAdd.mat.uniforms.scale.value = s; fxNorm.mat.uniforms.scale.value = s; }
  }

  // ---------- per-frame ----------
  const _sky = [new T.Color(), new T.Color(), new T.Color()], _fogPhoto = new T.Color('#a3b6c4');
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
    updateEnv(Hu, t);
    // fog: the haze thins out with altitude; terrain disappears once we are in space
    scene.fog.color.copy(sky[2]);
    if (photoSky) {
      const f = 1 - smooth(ZH.jet, zoneFrac('strato', 0.5), Hu);
      photoSky.material.uniforms.fade.value = f; photoSky.visible = f > 0.002;
      scene.fog.color.lerp(_fogPhoto, f);
    }
    // fog ends before the edge of the loaded terrain ring (2700 units to the side and behind)
    scene.fog.near = Math.min(420 + cy * 2.5, 1700);
    scene.fog.far = Math.min(2550 + cy * 1.2, 3000);
    // high up the ground fades into the Earth of the backdrop instead of vanishing at once
    const groundFade = 1 - smooth(ZH.space * S * 1.08, ZH.space * S * 1.56, cy);
    const groundVis = groundFade > 0.001;
    setGroundFade(groundFade);
    water.visible = groundVis;
    for (const m of chunks.values()) m.visible = groundVis;
    if (groundVis) { updateTerrain(cx, cz, false); water.position.set(cx, 0, cz); water.material.normalMap.offset.set(t * 0.006 + cx / 14000 * 110, t * 0.004 - cz / 14000 * 110); }
    updateDeco(cx, cz, cy, groundVis, t, false);
    for (const h of deco.turbines) h.rotation.x += dt * 1.3;
    updateClouds(cx, cy, false);
    hemi.intensity = lerp(0.35, 0.2, space);
    sunLight.intensity = lerp(3.2, 3.4, space);
    // stars, galaxy, sun
    stars.material.opacity = smooth(zoneFrac('strato', 0.6), zoneFrac('space', 0.3), Hu);
    galaxy.material.opacity = smooth(ZH.space, zoneFrac('orbit', 0.5), Hu) * (Models.TEX.photo ? 1 : composer ? 0.32 : 0.5);
    // Andromeda: a faint smudge from the galactic centre on, filling the view on arrival
    const andro = smooth(ZH.zentrum, ZH.andromeda, Hu);
    spiral.material.opacity = smooth(zoneFrac('zentrum', 0.1), zoneFrac('zentrum', 0.5), Hu) * 0.95;
    spiral.scale.setScalar(900 + 5200 * andro * andro);
    const far = 1 / (1 + Math.max(0, Hu - ZH.moon) / (ZH.jupiter - ZH.moon) * 2);
    // beyond the Heliopause the Sun becomes one star among many
    const gone = smooth(ZH.edge, ZH.proxima, Hu);
    sunCore.scale.setScalar(lerp(260, 420, space) * (0.4 + 0.6 * far) * (1 - 0.85 * gone));
    sunSprite.material.opacity = lerp(0.7, 0.45, space) * (1 - 0.95 * gone);
    aurora.material.uniforms.time.value = t;
    aurora.material.uniforms.alpha.value = smooth(zoneFrac('meso', -0.15), zoneFrac('meso', 0.35), Hu) * (1 - smooth(zoneFrac('space', 0.2), zoneFrac('space', 0.8), Hu));
    aurora.visible = aurora.material.uniforms.alpha.value > 0.01;
    // Earth: a horizon below at first, then a shrinking globe ahead and below
    if (Hu > ZH.meso * 0.9 && Hu < ZH.oort) {
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
    for (const d of deep) {
      const dd = (Hu - d.H) / ((d.next - d.H) * 0.8);
      if (dd < -1.8 || dd > 1.4) { d.obj.visible = false; continue; }
      d.obj.visible = true;
      const el = -dd * 0.45 + 0.4, ang = d.size / (1 + Math.abs(dd) * 1.6);
      _v.set(Math.cos(el) * Math.cos(d.az), Math.sin(el), Math.cos(el) * Math.sin(d.az)).normalize();
      d.obj.position.copy(_v).multiplyScalar(60000);
      d.obj.scale.setScalar(2 * 60000 * Math.tan(ang));
    }
    // heliopause shimmer at the edge of the Solar System
    const gy = ZH.edge * S;
    helio.visible = cy > gy - 2500;
    if (helio.visible) { helio.position.set(cx, gy, cz); helio.material.uniforms.time.value = t; helio.material.uniforms.alpha.value = smooth(gy - 2500, gy - 300, cy) * (1 - smooth(gy + 200, gy + 800, cy)); }
    // shadow camera follows the action near the ground
    sunLight.target.position.set(cx + 20, Math.max(0, cy - 15), cz * 0.3);
    sunLight.position.copy(sunLight.target.position).addScaledVector(sunDir, 150);
    fxAdd.update(dt); fxNorm.update(dt);
  }
  // re-render the sky into the environment map when the view of it has changed noticeably
  let envPhoto = null;
  function updateEnv(Hu, t) {
    if (Hu < ZH.jet && Models.TEX.skyCubeReady) {
      // near the ground the reflections come from the photographed sky, built once, so water and paint stay calm
      if (!envPhoto) envPhoto = pmrem.fromCubemap(Models.TEX.skyCube);
      scene.environment = envPhoto.texture; envHu = -1;
      return;
    }
    if (envRT && envHu >= 0 && Math.abs(Math.log((Hu + 300) / (envHu + 300))) < 0.15 && t - envTime < 10 && t >= envTime) return;
    envHu = Hu; envTime = t;
    bgCamera.position.set(0, 0, 0);
    const old = envRT;
    envRT = pmrem.fromScene(bgScene, 0.03, 1, 2e5);
    scene.environment = envRT.texture;
    if (old && old !== envRT) old.dispose();
  }
  function render() {
    bgCamera.quaternion.copy(camera.quaternion);
    if (bgCamera.fov !== camera.fov || bgCamera.aspect !== camera.aspect) { bgCamera.fov = camera.fov; bgCamera.aspect = camera.aspect; bgCamera.updateProjectionMatrix(); updateParticleScale(); }
    if (composer) { composer.render(); return; }
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
    get lowPower() { return lowPower; }, setQuality,
  };
})();
