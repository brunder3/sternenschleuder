/* Sternenschleuder 3D models and procedural textures (three.js r159 classic build).
   Every model is built from primitives at runtime: no model or image files.
   Scale: 1 three.js unit = 10 physics units (u). The rocket is about 7 units long. */
const Models = (() => {
  'use strict';
  const T = THREE;
  const TAU = Math.PI * 2;

  // ---------- helpers ----------
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function mulberry(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function canvasTex(c, rx, ry) {
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    if (rx) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry || rx); }
    t.anisotropy = 4;
    return t;
  }
  const matCache = new Map();
  function std(color, rough = 0.5, metal = 0.1, extra) {
    const key = [color, rough, metal, extra ? JSON.stringify(extra) : ''].join('|');
    if (!matCache.has(key)) matCache.set(key, new T.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra || {})));
    return matCache.get(key);
  }
  // car-like paint: a glossy clear coat over the colour reflects the sky
  const paintCache = new Map();
  function paint(color, rough = 0.4, metal = 0.1) {
    const key = color + '|' + rough + '|' + metal;
    if (!paintCache.has(key)) paintCache.set(key, new T.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, clearcoat: 0.85, clearcoatRoughness: 0.12 }));
    return paintCache.get(key);
  }
  function glowMat(color, opacity = 1) {
    return new T.SpriteMaterial({ map: TEX.glow, color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false });
  }
  function additive(color, opacity = 1) {
    return new T.MeshBasicMaterial({ color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
  }
  // deterministic jitter so shared vertex positions move together (no cracks in non-indexed geometry)
  function jitter(geo, amount, seed) {
    const p = geo.attributes.position, v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + seed) * 43758.5453;
      const f = 1 + (h - Math.floor(h) - 0.5) * 2 * amount;
      p.setXYZ(i, v.x * f, v.y * f, v.z * f);
    }
    geo.computeVertexNormals();
    return geo;
  }
  // orient a unit-height cylinder (along Y) between two points
  const _up = new T.Vector3(0, 1, 0), _d = new T.Vector3();
  function stretchBetween(mesh, a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    mesh.position.copy(a).addScaledVector(_d, 0.5);
    mesh.scale.set(1, Math.max(0.001, len), 1);
    mesh.quaternion.setFromUnitVectors(_up, _d.normalize());
  }

  // ---------- textures ----------
  const TEX = {};
  function radial(size, stops) {
    const c = makeCanvas(size, size), g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return c;
  }
  function grassCanvas() {
    const S = 512, c = makeCanvas(S, S), g = c.getContext('2d'), r = mulberry(11);
    g.fillStyle = '#5aa84a'; g.fillRect(0, 0, S, S);
    // mowed stripes
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,40,0,.04)'; g.fillRect(0, i * S / 8, S, S / 8); }
    for (let i = 0; i < 9000; i++) {
      const x = r() * S, y = r() * S, l = 2 + r() * 5;
      g.strokeStyle = `hsla(${95 + r() * 30},${45 + r() * 25}%,${28 + r() * 26}%,${0.35 + r() * 0.4})`;
      g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y - l); g.stroke();
    }
    for (let i = 0; i < 70; i++) {
      g.fillStyle = r() < 0.4 ? '#ffe066' : r() < 0.6 ? '#ffffff' : '#ff8fb0';
      g.beginPath(); g.arc(r() * S, r() * S, 1.2 + r() * 1.3, 0, TAU); g.fill();
    }
    return c;
  }
  // cumulus: many soft puffs, sunlit tops, grey flat bases
  function cloudCanvas(seed) {
    const S = 512, c = makeCanvas(S, S), g = c.getContext('2d'), r = mulberry(seed * 97 + 3);
    const puffs = [];
    for (let i = 0; i < 46; i++) {
      const a = r() * TAU, d = Math.pow(r(), 0.6) * 130, x = S / 2 + Math.cos(a) * d * 1.25, y = S / 2 + 20 + Math.sin(a) * d * 0.5 - Math.max(0, 70 - d) * 0.9 * r();
      puffs.push([x, Math.min(y, S / 2 + 70), 26 + r() * 52]);
    }
    puffs.sort((p, q) => q[1] - p[1]);   // back (low) puffs first
    for (const [x, y, rad] of puffs) {
      const gr = g.createRadialGradient(x - rad * 0.25, y - rad * 0.35, rad * 0.05, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.96)'); gr.addColorStop(0.5, 'rgba(242,246,252,0.82)'); gr.addColorStop(0.85, 'rgba(214,224,238,0.35)'); gr.addColorStop(1, 'rgba(200,214,232,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
    // flat, shadowed base
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, S * 0.42, 0, S * 0.66);
    sh.addColorStop(0, 'rgba(120,135,160,0)'); sh.addColorStop(1, 'rgba(118,132,158,.62)');
    g.fillStyle = sh; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'destination-out';
    const cut = g.createLinearGradient(0, S * 0.64, 0, S * 0.72);
    cut.addColorStop(0, 'rgba(0,0,0,0)'); cut.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = cut; g.fillRect(0, S * 0.64, S, S * 0.36);
    g.globalCompositeOperation = 'source-over';
    return c;
  }
  // fine grain for the ground: speckles and blotches around a light grey, multiplied with the vertex colours
  function groundCanvas() {
    const S = 256, c = makeCanvas(S, S), g = c.getContext('2d'), r = mulberry(77);
    g.fillStyle = '#ececec'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const x = r() * S, y = r() * S, rad = 4 + r() * 22, v = 200 + r() * 55 | 0;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${v},${v},${v},.5)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.fillStyle = gr; g.save(); g.translate(dx, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }
    }
    const img = g.getImageData(0, 0, S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 34; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    return c;
  }
  // water ripples: a tiling height field turned into a normal map
  function waterNormalCanvas() {
    const S = 256, c = makeCanvas(S, S), g = c.getContext('2d'), r = mulberry(5);
    const waves = Array.from({ length: 14 }, () => ({ kx: Math.round((r() - 0.5) * 12), ky: Math.round((r() - 0.5) * 12) || 1, ph: r() * TAU, a: 0.4 + r() }));
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let h = 0;
      for (const w of waves) h += w.a * Math.sin((w.kx * x + w.ky * y) / S * TAU + w.ph) / Math.hypot(w.kx, w.ky);
      hgt[y * S + x] = h;
    }
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + (x + 1) % S] - hgt[y * S + (x + S - 1) % S], hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const nx = -hx * 3, ny = -hy * 3, nz = 1, l = Math.hypot(nx, ny, nz), k = (y * S + x) * 4;
      d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (nz / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function latticeCanvas() {
    const c = makeCanvas(64, 256), g = c.getContext('2d');
    g.strokeStyle = '#5b6372'; g.lineWidth = 6;
    g.strokeRect(3, -3, 58, 262);
    g.lineWidth = 3.5;
    for (let y = 0; y < 256; y += 64) { g.beginPath(); g.moveTo(3, y); g.lineTo(61, y + 64); g.moveTo(61, y); g.lineTo(3, y + 64); g.moveTo(0, y); g.lineTo(64, y); g.stroke(); }
    return c;
  }
  function hazardCanvas() {
    const c = makeCanvas(256, 32), g = c.getContext('2d');
    g.fillStyle = '#ffcc33'; g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#1d1d22';
    for (let x = -32; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 32); g.closePath(); g.fill(); }
    return c;
  }
  function windowsCanvas() {
    const c = makeCanvas(256, 128), g = c.getContext('2d');
    g.fillStyle = '#e4e8ef'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#c9cfd9'; g.fillRect(0, 0, 256, 14);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#2b4a7a'; g.fillRect(14 + i * 60, 40, 44, 34);
      g.fillStyle = 'rgba(180,230,255,.6)'; g.fillRect(14 + i * 60, 40, 14, 34);
    }
    g.fillStyle = '#e2402f'; g.fillRect(0, 112, 256, 16);
    return c;
  }
  function panelCanvas() {
    const c = makeCanvas(128, 64), g = c.getContext('2d');
    g.fillStyle = '#1f3b78'; g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#7fa8ee'; g.lineWidth = 2;
    for (let x = 0; x <= 128; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
    for (let y = 0; y <= 64; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
    return c;
  }
  function stripesCanvas(a, b, n) {
    const c = makeCanvas(128, 16), g = c.getContext('2d');
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 128 / n, 0, 128 / n + 1, 16); }
    return c;
  }
  // equirectangular planet maps
  function planetCanvas(type) {
    // the Earth is seen from close up right after the terrain fades out, so it gets twice the resolution
    const W = 1024, H = 512, SC = type === 'earth' ? 2 : 1, c = makeCanvas(W * SC, H * SC), g = c.getContext('2d'), r = mulberry(type.length * 131 + 7);
    g.scale(SC, SC);
    const blob = (x, y, rx, ry, col) => { for (const dx of [-W, 0, W]) { g.fillStyle = col; g.beginPath(); g.ellipse(x + dx, y, rx, ry, 0, 0, TAU); g.fill(); } };
    if (type === 'moon') {
      g.fillStyle = '#bdb8ae'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 18; i++) blob(r() * W, 80 + r() * 350, 40 + r() * 120, 30 + r() * 70, 'rgba(90,88,96,.28)');
      for (let i = 0; i < 260; i++) {
        const x = r() * W, y = 30 + r() * 450, rad = 3 + Math.pow(r(), 3) * 30;
        blob(x, y, rad, rad * 0.8, 'rgba(80,76,72,.32)');
        g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y, rad, rad * 0.8, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      }
    } else if (type === 'mars') {
      g.fillStyle = '#c45a2c'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) blob(r() * W, 60 + r() * 400, 30 + r() * 110, 12 + r() * 40, `rgba(${90 + r() * 60},30,15,.35)`);
      for (let i = 0; i < 30; i++) blob(r() * W, 60 + r() * 400, 20 + r() * 60, 8 + r() * 20, 'rgba(240,150,90,.25)');
      g.fillStyle = 'rgba(255,250,245,.92)'; g.fillRect(0, 0, W, 34); g.fillRect(0, H - 26, W, 26);
    } else if (type === 'jupiter' || type === 'saturn') {
      const bands = type === 'jupiter'
        ? ['#e9d6b4', '#c48a58', '#f1e4cc', '#b06c42', '#e6cfa8', '#9a5a36', '#efe0c4', '#c79466', '#e2c9a0', '#b8784a', '#efe2c6']
        : ['#f0e2b8', '#d9c08a', '#f4e9c8', '#cfb27a', '#ecdcb0', '#d6bd88', '#f1e5c2', '#d3b884'];
      const n = bands.length;
      for (let i = 0; i < n; i++) {
        const y0 = (i / n) * H;
        g.fillStyle = bands[i]; g.beginPath(); g.moveTo(0, y0);
        for (let x = 0; x <= W; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.02 + i * 1.7) * 5);
        g.lineTo(W, y0 + H / n + 8); g.lineTo(0, y0 + H / n + 8); g.closePath(); g.fill();
      }
      if (type === 'jupiter') {
        blob(W * 0.62, H * 0.64, 70, 34, '#c0533a');
        g.strokeStyle = 'rgba(250,220,190,.6)'; g.lineWidth = 5; g.beginPath(); g.ellipse(W * 0.62, H * 0.64, 78, 40, 0, 0, TAU); g.stroke();
      }
    } else if (type === 'earth') {
      g.fillStyle = '#1f62b8'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 16; i++) {
        const x = r() * W, y = 90 + r() * 330, desert = r() < 0.3;
        for (let k = 0; k < 6; k++) blob(x + (r() - 0.5) * 160, y + (r() - 0.5) * 80, 30 + r() * 70, 20 + r() * 45, desert ? '#c7a86c' : '#4c9a4a');
      }
      // home continent: the spot below the launch site when the terrain hands over to this globe
      // (u 0.73, latitude 23 deg with the rotation World gives the Earth)
      const HX = 743, HY = 192;
      for (let k = 0; k < 9; k++) blob(HX + (r() - 0.5) * 220, HY + (r() - 0.5) * 90, 50 + r() * 60, 26 + r() * 30, k % 4 === 3 ? '#79b84c' : '#4c9a4a');
      blob(HX + 30, HY + 40, 26, 8, '#2f78c8');
      g.fillStyle = 'rgba(245,250,255,.95)'; g.fillRect(0, 0, W, 26); g.fillRect(0, H - 30, W, 30);
      for (let i = 0; i < 70; i++) {
        const x = r() * W, y = 40 + r() * 430, rx = 30 + r() * 90, ry = 5 + r() * 9;
        if (Math.abs(x - HX) < 150 && Math.abs(y - HY) < 70) continue;   // clear sky over the home continent
        blob(x, y, rx, ry, 'rgba(255,255,255,.7)');
      }
    }
    return c;
  }
  function ringCanvas() {
    const c = makeCanvas(512, 8), g = c.getContext('2d');
    for (let x = 0; x < 512; x++) {
      const t = x / 512, a = (0.25 + 0.6 * Math.abs(Math.sin(t * 40))) * (t < 0.05 || t > 0.97 ? 0 : 1) * (t > 0.62 && t < 0.66 ? 0.15 : 1);
      g.fillStyle = `rgba(${220 - t * 40},${200 - t * 50},${160 - t * 40},${a})`; g.fillRect(x, 0, 1, 8);
    }
    return c;
  }
  function galaxyCanvas() {
    const c = makeCanvas(1024, 512), g = c.getContext('2d'), r = mulberry(4242);
    for (let i = 0; i < 26; i++) {
      const x = r() * 1024, y = 256 + (r() - 0.5) * 200, col = [[150, 120, 255], [255, 140, 210], [120, 190, 255]][i % 3];
      const gr = g.createRadialGradient(x, y, 0, x, y, 70 + r() * 110);
      gr.addColorStop(0, `rgba(${col},.16)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(x - 200, y - 200, 400, 400);
    }
    for (let i = 0; i < 2600; i++) {
      const x = r() * 1024, y = 256 + (r() + r() + r() - 1.5) * 140;
      g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.55})`;
      g.fillRect(x, y, r() < 0.08 ? 2 : 1, r() < 0.08 ? 2 : 1);
    }
    // fade every edge to transparent so the band has no visible rectangle around it
    g.globalCompositeOperation = 'destination-in';
    const fx = g.createLinearGradient(0, 0, 1024, 0);
    fx.addColorStop(0, 'rgba(0,0,0,0)'); fx.addColorStop(0.2, 'rgba(0,0,0,1)'); fx.addColorStop(0.8, 'rgba(0,0,0,1)'); fx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fx; g.fillRect(0, 0, 1024, 512);
    const fy = g.createLinearGradient(0, 0, 0, 512);
    fy.addColorStop(0, 'rgba(0,0,0,0)'); fy.addColorStop(0.3, 'rgba(0,0,0,1)'); fy.addColorStop(0.7, 'rgba(0,0,0,1)'); fy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fy; g.fillRect(0, 0, 1024, 512);
    g.globalCompositeOperation = 'source-over';
    return c;
  }
  function spiralCanvas() {
    const c = makeCanvas(512, 512), g = c.getContext('2d'), r = mulberry(99);
    const core = g.createRadialGradient(256, 256, 0, 256, 256, 120);
    core.addColorStop(0, 'rgba(255,240,220,.95)'); core.addColorStop(0.3, 'rgba(255,190,230,.4)'); core.addColorStop(1, 'rgba(120,80,255,0)');
    g.fillStyle = core; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      const arm = i % 2, t = r() * 4.2, rad = 14 + t * 54 + r() * 20, a = t * 1.25 + arm * Math.PI + (r() - 0.5) * 0.5;
      g.fillStyle = r() < 0.5 ? `rgba(190,170,255,${0.2 + r() * 0.5})` : `rgba(255,200,240,${0.2 + r() * 0.5})`;
      g.fillRect(256 + Math.cos(a) * rad, 256 + Math.sin(a) * rad * 0.62, 2, 2);
    }
    return c;
  }
  // emission nebula: soft pink, teal and gold clouds with a few young stars
  function nebulaCanvas() {
    const c = makeCanvas(512, 512), g = c.getContext('2d'), r = mulberry(1344);
    const cols = [[255, 110, 180], [90, 220, 230], [255, 190, 120], [170, 110, 255]];
    for (let i = 0; i < 60; i++) {
      const a = r() * TAU, d = Math.pow(r(), 0.7) * 170, x = 256 + Math.cos(a) * d, y = 256 + Math.sin(a) * d * 0.75, rad = 40 + r() * 90, col = cols[i % 4];
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${col},${0.10 + r() * 0.12})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; const x = 256 + (r() - 0.5) * 300, y = 256 + (r() - 0.5) * 220; g.fillRect(x, y, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1); }
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(256, 256, 120, 256, 256, 256);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'source-over';
    return c;
  }
  function chevronCanvas() {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const x of [38, 72]) { g.beginPath(); g.moveTo(x, 30); g.lineTo(x + 26, 64); g.lineTo(x, 98); g.stroke(); }
    return c;
  }
  function buildTextures() {
    TEX.glow = canvasTex(radial(128, [[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,.5)'], [0.55, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']]));
    TEX.dot = canvasTex(radial(64, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]));
    TEX.grass = canvasTex(grassCanvas(), 1);
    TEX.clouds = [0, 1, 2, 3, 4].map(i => canvasTex(cloudCanvas(i)));
    TEX.ground = canvasTex(groundCanvas(), 1); TEX.ground.anisotropy = 8;
    TEX.waterNormal = canvasTex(waterNormalCanvas(), 1); TEX.waterNormal.colorSpace = T.NoColorSpace;
    TEX.lattice = canvasTex(latticeCanvas()); TEX.lattice.wrapT = T.RepeatWrapping;
    TEX.hazard = canvasTex(hazardCanvas()); TEX.hazard.wrapS = T.RepeatWrapping;
    TEX.windows = canvasTex(windowsCanvas());
    TEX.panel = canvasTex(panelCanvas());
    TEX.sock = canvasTex(stripesCanvas('#ff6a2a', '#ffffff', 6));
    TEX.ring = canvasTex(ringCanvas());
    TEX.galaxy = canvasTex(galaxyCanvas());
    TEX.spiral = canvasTex(spiralCanvas());
    TEX.nebula = canvasTex(nebulaCanvas());
    TEX.chevron = canvasTex(chevronCanvas());
    for (const p of ['moon', 'mars', 'jupiter', 'saturn', 'earth']) TEX[p] = canvasTex(planetCanvas(p));
  }

  // ---------- rocket ----------
  const FLAME_COLORS = {
    warm: [0xfffae0, 0xffbe46, 0xff5a1e], blue: [0xe6faff, 0x6ed2ff, 0x286eff], water: [0xffffff, 0xbeebff, 0x78bef0],
    gold: [0xfffce6, 0xffd764, 0xf08c1e], violet: [0xfff0ff, 0xf078ff, 0x823cff], green: [0xf0fff5, 0x64ffbe, 0x14aa8c], void: [0xffffff, 0xc8a0ff, 0x5a28c8],
    cyan: [0xf0ffff, 0x6ff6ff, 0x1a9cff], white: [0xffffff, 0xe8f4ff, 0x9cc4ff], red: [0xfff0e0, 0xff6a3a, 0xc4101e], pink: [0xfff0fa, 0xff8ad8, 0xc23c9c],
  };
  function lathe(points, segs) { return new T.LatheGeometry(points.map(p => new T.Vector2(Math.max(0.0001, p[0]), p[1])), segs || 32); }
  function noseProfile(kind, R, y0, len, n = 14) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let r;
      if (kind === 'cone') r = R * (1 - t) * (1 + 0.18 * Math.sin(t * Math.PI));
      else if (kind === 'blunt') r = R * Math.sqrt(Math.max(0, 1 - t * t));
      else r = R * Math.pow(Math.cos(t * Math.PI / 2), 0.75);
      pts.push([r, y0 + t * len]);
    }
    return pts;
  }
  function finShape(kind, R, L) {
    const s = new T.Shape();
    if (kind === 'swept') { s.moveTo(0, L * 0.26); s.quadraticCurveTo(R * 0.6, L * 0.14, R * 1.35, -L * 0.07); s.lineTo(R * 1.1, -L * 0.09); s.lineTo(0, L * 0.03); }
    else if (kind === 'round') { s.moveTo(0, L * 0.22); s.quadraticCurveTo(R * 1.9, L * 0.12, R * 1.05, -L * 0.04); s.lineTo(0, L * 0.02); }
    else if (kind === 'wing') { s.moveTo(0, L * 0.5); s.lineTo(R * 1.7, L * 0.05); s.lineTo(R * 1.6, -L * 0.03); s.lineTo(0, L * 0.04); }
    else { s.moveTo(0, L * 0.26); s.lineTo(R * 1.3, -L * 0.03); s.lineTo(R * 1.25, -L * 0.06); s.lineTo(0, L * 0.02); }
    s.closePath();
    return s;
  }
  function rocket(look) {
    const root = new T.Group();
    const inner = new T.Group();          // built along +Y, turned so the nose points along +X
    inner.rotation.z = -Math.PI / 2;
    root.add(inner);
    const L = 7.2 * look.len, R = 1.05 * look.w;
    const noseLen = look.nose === 'blunt' ? L * 0.17 : look.nose === 'cone' ? L * 0.3 : L * 0.34;
    const y0 = -L / 2, yB = L / 2 - noseLen;
    const bodyMat = paint(look.body, 0.45, 0.1), accMat = paint(look.accent, 0.4, 0.2), trimMat = paint(look.trim, 0.3, 0.6);
    const darkMetal = std('#3a3f4a', 0.35, 0.8, { side: T.DoubleSide });
    // body and nose
    inner.add(new T.Mesh(lathe([[R * 0.78, y0], [R * 0.96, y0 + L * 0.025], [R, y0 + L * 0.06], [R, yB]]), bodyMat));
    inner.add(new T.Mesh(lathe(noseProfile(look.nose, R, yB, noseLen)), accMat));
    // stripes
    const ring = (y, h, mat) => { const m = new T.Mesh(new T.CylinderGeometry(R * 1.012, R * 1.012, h, 32, 1, true), mat); m.position.y = y; inner.add(m); };
    if (look.stripes >= 3 && look.body === '#ffcd2e') for (let i = 0; i < 3; i++) ring(y0 + L * (0.18 + i * 0.16), L * 0.07, accMat);
    else if (look.stripes >= 3) for (let i = 0; i < 5; i++) ring(y0 + L * (0.12 + i * 0.11), L * 0.045, accMat);
    else {
      ring(yB - L * 0.05, L * 0.035, accMat);
      if (look.stripes > 1) ring(y0 + L * 0.2, L * 0.035, trimMat);
    }
    if (look.flame === 'water') ring(y0 + L * 0.34, L * 0.2, trimMat);
    // fins
    const nFins = look.fins === 'wing' ? 2 : look.fins === 'grid' ? 4 : look.len < 1 ? 3 : 4;
    const finGeo = new T.ExtrudeGeometry(finShape(look.fins === 'grid' ? 'delta' : look.fins, R, L), { depth: R * 0.14, bevelEnabled: false });
    finGeo.translate(0, 0, -R * 0.07);
    for (let i = 0; i < nFins; i++) {
      const pivot = new T.Group();
      pivot.rotation.y = (i / nFins) * TAU + (nFins === 2 ? Math.PI / 2 : Math.PI / 4);
      const f = new T.Mesh(finGeo, std(look.accent, 0.5, 0.2, { side: T.DoubleSide }));
      f.position.set(R * 0.92, y0, 0);
      pivot.add(f); inner.add(pivot);
    }
    if (look.fins === 'grid') {
      const gm = new T.MeshStandardMaterial({ map: TEX.lattice, color: 0x9aa3b2, transparent: true, alphaTest: 0.4, side: T.DoubleSide, metalness: 0.6, roughness: 0.4 });
      for (let i = 0; i < 4; i++) {
        const pivot = new T.Group(); pivot.rotation.y = i * Math.PI / 2;
        const p = new T.Mesh(new T.PlaneGeometry(R * 0.9, R * 0.9), gm);
        p.position.set(R * 1.45, yB - L * 0.08, 0); pivot.add(p); inner.add(pivot);
      }
    }
    // windows (on the side the chase camera sees)
    const glass = std('#6fd3ff', 0.08, 0.3, { emissive: new T.Color('#1a5a88'), emissiveIntensity: 0.6 });
    for (let i = 0; i < (look.windows || 0); i++) {
      const y = yB - R * (1.0 + i * 1.6);
      const rim = new T.Mesh(new T.TorusGeometry(R * 0.42, R * 0.08, 8, 24), trimMat);
      rim.position.set(0, y, R * 0.97); inner.add(rim);
      const w = new T.Mesh(new T.SphereGeometry(R * 0.42, 20, 12, 0, TAU, 0, Math.PI / 2), glass);
      w.rotation.x = Math.PI / 2; w.scale.set(1, 0.35, 1); w.position.set(0, y, R * 0.95); inner.add(w);
    }
    // nozzle
    const noz = new T.Mesh(new T.CylinderGeometry(R * 0.55, R * 0.8, L * 0.09, 24, 1, true), darkMetal);
    noz.position.y = y0 - L * 0.04; inner.add(noz);
    // flames
    const cols = FLAME_COLORS[look.flame] || FLAME_COLORS.warm;
    const flames = [];
    function addFlame(x, z, r, len) {
      const g = new T.Group();
      g.position.set(x, y0 - L * 0.085, z);
      const layers = [[1, 1, cols[2], 0.75], [0.7, 0.72, cols[1], 0.9], [0.4, 0.42, cols[0], 1]];
      for (const [lm, wm, col, op] of layers) {
        const geo = new T.ConeGeometry(r * wm, len * lm, 24, 6, true);
        // soft flame: full brightness at the nozzle, fading out toward the tip
        const pos = geo.attributes.position, rgba = new Float32Array(pos.count * 4), hh = len * lm / 2;
        for (let i = 0; i < pos.count; i++) { const a = Math.pow((hh - pos.getY(i)) / (2 * hh), 1.4); rgba.set([1, 1, 1, a], i * 4); }
        geo.setAttribute('color', new T.BufferAttribute(rgba, 4));
        const mat = new T.MeshBasicMaterial({ color: col, vertexColors: true, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
        const c = new T.Mesh(geo, mat);
        c.rotation.x = Math.PI; c.position.y = -len * lm / 2;
        g.add(c);
      }
      const glowS = new T.Sprite(glowMat(cols[1], 0.9));
      glowS.scale.set(r * 6, r * 6, 1); glowS.position.y = -r * 0.5;
      g.add(glowS);
      g.userData.baseLen = len;
      inner.add(g);
      flames.push(g);
    }
    addFlame(0, 0, R * 0.62, L * 0.75);
    // boosters
    if (look.boosters) {
      for (const s of [-1, 1]) {
        const br = R * 0.48, bl = L * 0.55, bx = s * R * 1.42;
        const b = new T.Mesh(lathe([[br * 0.8, 0], [br, bl * 0.06], [br, bl * 0.8], ...noseProfile('ogive', br, bl * 0.8, bl * 0.2).slice(1)], 20), trimMat);
        b.position.set(bx, y0 + L * 0.02, 0); inner.add(b);
        const bn = new T.Mesh(new T.CylinderGeometry(br * 0.55, br * 0.8, L * 0.06, 16, 1, true), darkMetal);
        bn.position.set(bx, y0 - L * 0.01, 0); inner.add(bn);
        const strap = new T.Mesh(new T.BoxGeometry(R * 0.9, L * 0.03, br * 0.5), accMat);
        strap.position.set(s * R * 0.95, y0 + L * 0.4, 0); inner.add(strap);
        addFlame(bx, 0, br * 0.62, L * 0.5);
        flames[flames.length - 1].position.y = y0 - L * 0.05;
      }
    }
    if (look.flame === 'void') {
      const halo = new T.Mesh(new T.TorusGeometry(R * 1.3, R * 0.05, 8, 40), additive(0xb48cff, 0.8));
      halo.rotation.x = Math.PI / 2; halo.position.y = yB - L * 0.1; inner.add(halo);
    }
    // glowing parts (flames, halo) are light, not solid: they cast no shadow
    root.traverse(o => { if (o.isMesh) o.castShadow = o.material.blending !== T.AdditiveBlending; });
    let flick = 0;
    root.userData = {
      length: L, radius: R, flames,
      // level 0..1.6 (1 = boost, >1 = turbo)
      setThrust(level, t) {
        flick = 0.85 + Math.sin(t * 47) * 0.07 + Math.random() * 0.14;
        flames.forEach((f, i) => {
          const l = level * (i === 0 ? 1 : 0.8);
          f.visible = l > 0.02;
          if (f.visible) f.scale.set(0.7 + 0.3 * Math.min(1, l), Math.max(0.05, l * flick), 0.7 + 0.3 * Math.min(1, l));
        });
      },
    };
    root.userData.setThrust(0, 0);
    return root;
  }

  // ---------- launch site ----------
  // launch pad: concrete deck with a flame trench, a service tower and a tilting launch rail (the erector)
  // that holds the rocket at the launch angle. The rail pivots at (0, PAD_PIVOT) and lies behind the rocket (z < 0).
  const PAD_PIVOT = 3.2;
  function launchPad() {
    const g = new T.Group();
    const concrete = std('#a9afba', 0.85, 0.02);
    const base = new T.Mesh(new T.BoxGeometry(34, 1.6, 26), concrete);
    base.position.y = 0.8; base.receiveShadow = true; g.add(base);
    const top = new T.Mesh(new T.BoxGeometry(33.6, 0.1, 25.6), std('#c3c8d1', 0.9, 0));
    top.position.y = 1.62; top.receiveShadow = true; g.add(top);
    const hz = new T.MeshStandardMaterial({ map: TEX.hazard, roughness: 0.8 });
    TEX.hazard.repeat.set(8, 1);
    for (const [w, d, x, z, ry] of [[34, 0.12, 0, 13.02, 0], [34, 0.12, 0, -13.02, 0], [26, 0.12, 17.02, 0, Math.PI / 2], [26, 0.12, -17.02, 0, Math.PI / 2]]) {
      const s = new T.Mesh(new T.BoxGeometry(w, 0.9, d), hz);
      s.position.set(x, 1.0, z); s.rotation.y = ry; g.add(s);
    }
    // flame trench with a soot-dark deflector and a hazard rim
    const trench = new T.Mesh(new T.BoxGeometry(9, 0.12, 7), std('#2b2d33', 0.95, 0.1));
    trench.position.set(1.5, 1.66, 0); g.add(trench);
    const soot = new T.Mesh(new T.BoxGeometry(6, 0.13, 4.6), std('#15161a', 1, 0));
    soot.position.set(2.2, 1.67, 0); g.add(soot);
    for (const [w, d, x, z] of [[9.4, 0.4, 1.5, 3.7], [9.4, 0.4, 1.5, -3.7], [0.4, 7.4, 6.2, 0], [0.4, 7.4, -3.2, 0]]) {
      const r = new T.Mesh(new T.BoxGeometry(w, 0.3, d), hz); r.position.set(x, 1.75, z); g.add(r);
    }
    const metal = std('#8a93a3', 0.45, 0.6), white = std('#e9edf3', 0.6, 0.15), red = std('#e2402f', 0.5, 0.2);
    const latMat = new T.MeshStandardMaterial({ map: TEX.lattice, transparent: true, alphaTest: 0.35, side: T.DoubleSide, metalness: 0.5, roughness: 0.5 });
    const lightMat = new T.MeshStandardMaterial({ color: 0xff4a3a, emissive: 0xff2010, emissiveIntensity: 2 });
    // pivot blocks the rail hinges on
    for (const z of [-3.4, -1.2]) {
      const blk = new T.Mesh(new T.BoxGeometry(2.2, PAD_PIVOT - 1.2, 0.8), metal);
      blk.position.set(0, 1.6 + (PAD_PIVOT - 1.6) / 2, z); g.add(blk);
    }
    const axle = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 3, 12), white);
    axle.rotation.x = Math.PI / 2; axle.position.set(0, PAD_PIVOT, -2.3); g.add(axle);
    // the launch rail: a lattice beam with clamp arms, rotated by setRail()
    const rail = new T.Group(); rail.position.set(0, PAD_PIVOT, 0); g.add(rail);
    const beam = new T.Mesh(new T.BoxGeometry(17, 1.3, 1.3), latMat); beam.position.set(8.2, 0, -2.6); rail.add(beam);
    const spine = new T.Mesh(new T.BoxGeometry(17, 0.3, 0.3), red); spine.position.set(8.2, 0.75, -2.6); rail.add(spine);
    const clamps = [];
    for (const x of [3, 8, 13]) {
      const hinge = new T.Group(); hinge.position.set(x, 0, -2); rail.add(hinge);
      const arm = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 1.6), white); arm.position.z = 0.8; hinge.add(arm);
      const pad = new T.Mesh(new T.BoxGeometry(0.7, 0.9, 0.25), red); pad.position.z = 1.6; hinge.add(pad);
      clamps.push(hinge);
    }
    const foot = new T.Mesh(new T.CylinderGeometry(1.2, 1.4, 0.6, 16), metal);
    foot.rotation.z = Math.PI / 2; foot.position.set(-0.2, 0, 0); rail.add(foot);
    // service tower with a swing arm and a warning light on top
    const tower = new T.Group(); tower.position.set(-6, 1.6, -8.5); g.add(tower);
    const tw = new T.Mesh(new T.BoxGeometry(3.2, 26, 3.2), latMat); tw.position.y = 13; tower.add(tw);
    for (let y = 4; y < 26; y += 5.5) { const deck = new T.Mesh(new T.BoxGeometry(3.8, 0.3, 3.8), metal); deck.position.y = y; tower.add(deck); }
    const cap = new T.Mesh(new T.BoxGeometry(3.8, 1.2, 3.8), red); cap.position.y = 26.4; tower.add(cap);
    const lamp = new T.Mesh(new T.SphereGeometry(0.45, 12, 8), lightMat); lamp.position.y = 27.4; tower.add(lamp);
    const antenna = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 5, 6), metal); antenna.position.y = 29.5; tower.add(antenna);
    const swing = new T.Group(); swing.position.set(1.6, 15, 0); tower.add(swing);
    const sarm = new T.Mesh(new T.BoxGeometry(6, 0.8, 1), latMat); sarm.position.x = 3; swing.add(sarm);
    const hose = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 6, 8), std('#2a2d33', 0.8, 0)); hose.rotation.z = Math.PI / 2; hose.position.set(3, -0.6, 0); swing.add(hose);
    // water tower for the sound-suppression deluge
    const wt = new T.Group(); wt.position.set(13, 1.6, -9); g.add(wt);
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { const leg = new T.Mesh(new T.CylinderGeometry(0.2, 0.25, 12, 6), metal); leg.position.set(x, 6, z); wt.add(leg); }
    const tank = new T.Mesh(new T.SphereGeometry(3.2, 20, 14), white); tank.position.y = 14; tank.scale.y = 0.8; wt.add(tank);
    const band = new T.Mesh(new T.CylinderGeometry(3.25, 3.25, 0.7, 20, 1, true), red); band.position.y = 14; wt.add(band);
    // floodlight masts at the corners
    for (const [x, z] of [[15, 11], [15, -11], [-15, -11]]) {   // none on the camera side (x < 0, z > 0)
      const pole = new T.Mesh(new T.CylinderGeometry(0.15, 0.2, 14, 6), metal); pole.position.set(x, 8.6, z); g.add(pole);
      const head = new T.Mesh(new T.BoxGeometry(1.6, 0.8, 0.5), std('#fff6d8', 0.4, 0, { emissive: 0xfff2c0, emissiveIntensity: 0.6 }));
      head.position.set(x, 15.8, z); head.lookAt(0, 6, 0); g.add(head);
    }
    const capMat = red;   // roof of the control hut
    g.userData = {
      lamp: lightMat,
      pivot: PAD_PIVOT,
      // tilt the rail; open (0..1) swings the clamp arms and the tower arm away after ignition
      setRail(angle, open) {
        rail.rotation.z = angle;
        for (const c of clamps) c.rotation.x = -open * 1.4;
        swing.rotation.y = open * 1.3;
      },
    };
    g.userData.setRail(0.8, 0);
    // control hut
    const hut = new T.Group();
    const walls = new T.Mesh(new T.BoxGeometry(12, 6, 8), [std('#d9dde6', 0.8, 0), std('#d9dde6', 0.8, 0), std('#b5bcc9', 0.8, 0), std('#b5bcc9', 0.8, 0), new T.MeshStandardMaterial({ map: TEX.windows, roughness: 0.7 }), std('#d9dde6', 0.8, 0)]);
    walls.position.y = 3; walls.castShadow = true; hut.add(walls);
    const roof = new T.Mesh(new T.BoxGeometry(13, 0.8, 9), capMat); roof.position.y = 6.4; hut.add(roof);
    const mast = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 6, 6), std('#8a93a3', 0.4, 0.7)); mast.position.set(-3, 9.5, 0); hut.add(mast);
    const dish = new T.Mesh(new T.SphereGeometry(1.4, 16, 8, 0, TAU, 0, Math.PI / 3), std('#e6e9ef', 0.4, 0.3, { side: T.DoubleSide }));
    dish.position.set(-3, 12.4, 0); dish.rotation.z = 2.4; hut.add(dish);
    hut.position.set(-34, 0, -26); hut.rotation.y = 0.35;
    g.add(hut);
    // windsock
    const pole = new T.Mesh(new T.CylinderGeometry(0.12, 0.15, 9, 6), std('#9aa3b3', 0.4, 0.6)); pole.position.set(24, 4.5, 20); g.add(pole);
    const sock = new T.Mesh(new T.CylinderGeometry(0.9, 0.45, 5, 12, 1, true), new T.MeshStandardMaterial({ map: TEX.sock, side: T.DoubleSide, roughness: 0.9 }));
    sock.rotation.z = Math.PI / 2 - 0.25; sock.position.set(26.5, 8.6, 20); g.add(sock);
    g.userData.sock = sock;
    // crates and fuel barrels
    const crate = std('#a9773f', 0.9, 0), barrel = std('#d8342a', 0.5, 0.3);
    [[-22, 1.1, -14, 0.3], [-20, 1.1, -16.5, 0.9], [-21, 3.3, -15.2, 0.1]].forEach(([x, y, z, r]) => { const c = new T.Mesh(new T.BoxGeometry(2.2, 2.2, 2.2), crate); c.position.set(x, y, z); c.rotation.y = r; c.castShadow = true; g.add(c); });
    [[20, -18], [22, -16.5], [19.2, -15.6]].forEach(([x, z]) => { const b = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 2.6, 14), barrel); b.position.set(x, 1.3, z); b.castShadow = true; g.add(b); });
    g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
    return g;
  }

  // ---------- scenery ----------
  function treeParts() {
    return {
      trunk: new T.CylinderGeometry(0.35, 0.5, 3, 6).translate(0, 1.5, 0),
      crown: jitter(new T.IcosahedronGeometry(2.6, 1), 0.12, 3).translate(0, 5.2, 0),
      pine: (() => {
        const a = new T.ConeGeometry(2.6, 4, 7).translate(0, 4, 0);
        return a;
      })(),
      pine2: new T.ConeGeometry(2, 3.4, 7).translate(0, 6.4, 0),
      trunkMat: std('#6b4a2b', 0.9, 0),
      crownMat: std('#4f9a4a', 0.85, 0, { flatShading: true }),
      pineMat: std('#2f7a48', 0.85, 0, { flatShading: true }),
    };
  }
  function mountain(seed) {
    const r = mulberry(seed);
    const g = new T.Group();
    const h = 140 + r() * 160, rad = 120 + r() * 120;
    const body = new T.Mesh(jitter(new T.ConeGeometry(rad, h, 7, 3), 0.08, seed), std('#7f92b0', 0.95, 0, { flatShading: true }));
    body.position.y = h / 2; g.add(body);
    const cap = new T.Mesh(jitter(new T.ConeGeometry(rad * 0.32, h * 0.32, 7, 1), 0.06, seed + 1), std('#f4f7fb', 0.8, 0, { flatShading: true }));
    cap.position.y = h - h * 0.16 + 0.5; g.add(cap);
    return g;
  }
  function hill(seed) {
    const r = mulberry(seed);
    const m = new T.Mesh(jitter(new T.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2), 0.05, seed), std(r() < 0.5 ? '#5fa356' : '#549a4f', 0.95, 0, { flatShading: true }));
    m.scale.set(60 + r() * 80, 18 + r() * 26, 50 + r() * 60);
    return m;
  }

  // ---------- pickups ----------
  const SHARED = {};
  function shared() {
    if (SHARED.ready) return SHARED;
    SHARED.coinGeo = new T.CylinderGeometry(1, 1, 0.22, 28).rotateX(Math.PI / 2);
    // coins glow a little so they read against sky and terrain without an environment map
    SHARED.coinMats = [
      new T.MeshStandardMaterial({ color: '#e0904a', roughness: 0.35, metalness: 0.15, emissive: '#b8561c', emissiveIntensity: 0.55 }),
      new T.MeshStandardMaterial({ color: '#eef3fb', roughness: 0.3, metalness: 0.15, emissive: '#8c9ab4', emissiveIntensity: 0.6 }),
      new T.MeshStandardMaterial({ color: '#ffd03a', roughness: 0.3, metalness: 0.15, emissive: '#e09a00', emissiveIntensity: 0.7 }),
    ];
    SHARED.gemGeo = new T.OctahedronGeometry(1.25, 0).scale(0.8, 1.25, 0.8);
    SHARED.ready = true;
    return SHARED;
  }
  function gem() {
    const g = new T.Group();
    const m = new T.Mesh(shared().gemGeo, new T.MeshStandardMaterial({ color: 0xe996ff, emissive: 0xb03cff, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.3, flatShading: true }));
    m.name = 'spin'; g.add(m);
    const s = new T.Sprite(glowMat(0xe996ff, 0.8)); s.scale.set(6, 6, 1); g.add(s);
    return g;
  }
  function fuelCan(space) {
    const g = new T.Group();
    if (!space) {
      const body = new T.Mesh(new T.BoxGeometry(1.5, 1.9, 0.8), std('#d8342a', 0.45, 0.25)); g.add(body);
      const handle = new T.Mesh(new T.TorusGeometry(0.42, 0.11, 6, 12, Math.PI), std('#8a1b14', 0.5, 0.3)); handle.position.y = 1.05; g.add(handle);
      const cap = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.4, 10), std('#ffd34d', 0.4, 0.4)); cap.position.set(0.5, 1.1, 0); g.add(cap);
      const drop = new T.Mesh(new T.SphereGeometry(0.32, 10, 8).scale(1, 1.35, 0.4), std('#ffd34d', 0.4, 0.2)); drop.position.z = 0.42; g.add(drop);
    } else {
      const body = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 2.2, 14), std('#1c3550', 0.4, 0.6)); g.add(body);
      const core = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 1.6, 14), new T.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x2fb6e6, emissiveIntensity: 1.6 })); g.add(core);
      for (const y of [-1.15, 1.15]) { const c = new T.Mesh(new T.CylinderGeometry(0.65, 0.65, 0.2, 14), std('#9aa1ad', 0.4, 0.7)); c.position.y = y; g.add(c); }
    }
    const s = new T.Sprite(glowMat(space ? 0x50e6ff : 0xff7850, 0.55)); s.scale.set(7, 7, 1); s.name = 'glow'; g.add(s);
    return g;
  }
  function boostRing() {
    const g = new T.Group();
    const torus = new T.Mesh(new T.TorusGeometry(4.4, 0.42, 12, 48), new T.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x29b8ff, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.2 }));
    torus.rotation.y = Math.PI / 2; torus.name = 'torus'; g.add(torus);
    const chev = new T.Mesh(new T.PlaneGeometry(4.4, 4.4), new T.MeshBasicMaterial({ map: TEX.chevron, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, color: 0x9ff3ff }));
    chev.rotation.y = Math.PI / 2; chev.name = 'chev'; g.add(chev);
    const s = new T.Sprite(glowMat(0x5ad8ff, 0.45)); s.scale.set(16, 16, 1); g.add(s);
    return g;
  }

  // ---------- obstacles and friendly objects ----------
  function bird() {
    const g = new T.Group();
    const body = new T.Mesh(new T.SphereGeometry(0.8, 12, 8).scale(1.5, 0.8, 0.8), std('#3d4658', 0.8, 0)); g.add(body);
    const head = new T.Mesh(new T.SphereGeometry(0.5, 10, 8), std('#3d4658', 0.8, 0)); head.position.set(1.2, 0.35, 0); g.add(head);
    const beak = new T.Mesh(new T.ConeGeometry(0.18, 0.6, 6), std('#ffb02e', 0.6, 0)); beak.rotation.z = -Math.PI / 2; beak.position.set(1.8, 0.3, 0); g.add(beak);
    const wingGeo = new T.BoxGeometry(1.2, 0.08, 2.2).translate(0, 0, 1.1);
    const wm = std('#56627a', 0.8, 0);
    const w1 = new T.Mesh(wingGeo, wm), w2 = new T.Mesh(wingGeo, wm);
    w2.rotation.y = Math.PI; w1.name = w2.name = 'wing'; g.add(w1, w2);
    return g;
  }
  function partyBalloons() {
    const g = new T.Group();
    const cols = ['#ff5a6e', '#ffd34d', '#4f9dff'];
    const pos = [[-0.9, 1.0, 0.3], [0.9, 1.4, -0.3], [0, 2.4, 0]];
    pos.forEach(([x, y, z], i) => {
      const b = new T.Mesh(new T.SphereGeometry(0.85, 16, 12).scale(1, 1.18, 1), std(cols[i], 0.25, 0.05, { emissive: new T.Color(cols[i]), emissiveIntensity: 0.15 }));
      b.position.set(x, y, z); g.add(b);
    });
    const strings = new T.BufferGeometry().setFromPoints(pos.flatMap(([x, y, z]) => [new T.Vector3(x, y - 1, z), new T.Vector3(0, -1.2, 0)]));
    g.add(new T.LineSegments(strings, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
    return g;
  }
  function weatherBalloon() {
    const g = new T.Group();
    const b = new T.Mesh(new T.SphereGeometry(2.4, 20, 14), std('#f4f6fb', 0.3, 0, { transparent: true, opacity: 0.88 })); b.position.y = 1.5; g.add(b);
    const line = new T.BufferGeometry().setFromPoints([new T.Vector3(0, -0.9, 0), new T.Vector3(0, -3.6, 0)]);
    g.add(new T.Line(line, new T.LineBasicMaterial({ color: 0xffffff })));
    const box = new T.Mesh(new T.BoxGeometry(0.9, 0.7, 0.9), std('#f2a33a', 0.6, 0.1)); box.position.y = -4; g.add(box);
    return g;
  }
  function ufo() {
    const g = new T.Group();
    const saucer = new T.Mesh(lathe([[0.2, -0.5], [2.4, -0.15], [3.2, 0], [2.4, 0.25], [0.6, 0.45]], 28), std('#aab3c4', 0.25, 0.8));
    g.add(saucer);
    const dome = new T.Mesh(new T.SphereGeometry(1.25, 18, 10, 0, TAU, 0, Math.PI / 2), std('#c8ffe6', 0.05, 0.1, { transparent: true, opacity: 0.75, emissive: new T.Color('#3cdc9a'), emissiveIntensity: 0.4 }));
    dome.position.y = 0.4; g.add(dome);
    const lights = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      const l = new T.Mesh(new T.SphereGeometry(0.18, 8, 6), new T.MeshStandardMaterial({ color: 0x9dffcc, emissive: 0x4dff9a, emissiveIntensity: 1 }));
      l.position.set(Math.cos(a) * 2.75, 0.02, Math.sin(a) * 2.75); l.name = 'light'; g.add(l); lights.push(l);
    }
    const beam = new T.Mesh(new T.ConeGeometry(3, 9, 20, 1, true), additive(0x8cffbe, 0.22));
    beam.position.y = -4.8; g.add(beam);
    return g;
  }
  function drone() {
    const g = new T.Group();
    const arm = std('#2e3340', 0.6, 0.4);
    for (const r of [Math.PI / 4, -Math.PI / 4]) { const a = new T.Mesh(new T.BoxGeometry(5, 0.25, 0.3), arm); a.rotation.y = r; g.add(a); }
    const body = new T.Mesh(new T.BoxGeometry(1.6, 0.7, 1.2), std('#3d4352', 0.5, 0.3)); g.add(body);
    const pkg = new T.Mesh(new T.BoxGeometry(1, 0.8, 1), std('#c47a1a', 0.9, 0)); pkg.position.y = -0.8; g.add(pkg);
    const rotors = [];
    for (const [x, z] of [[1.75, 1.75], [-1.75, 1.75], [1.75, -1.75], [-1.75, -1.75]]) {
      const r = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 0.04, 16), new T.MeshBasicMaterial({ color: 0xd0d8e6, transparent: true, opacity: 0.35 }));
      r.position.set(x * 0.72, 0.25, z * 0.72); r.name = 'rotor'; g.add(r); rotors.push(r);
    }
    const led = new T.Mesh(new T.SphereGeometry(0.15, 8, 6), new T.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0xff2020, emissiveIntensity: 2 }));
    led.position.set(0.85, 0.1, 0); led.name = 'led'; g.add(led);
    return g;
  }
  function zeppelin() {
    const g = new T.Group();
    const hull = new T.Mesh(new T.SphereGeometry(1, 24, 14).scale(7, 2.2, 2.2), std('#c4cad6', 0.35, 0.5)); g.add(hull);
    const band = new T.Mesh(new T.CylinderGeometry(2.25, 2.25, 0.9, 24, 1, true).rotateZ(Math.PI / 2), std('#e2402f', 0.5, 0.1, { side: T.DoubleSide }));
    band.position.x = -1.5; g.add(band);
    const finMat = std('#8b93a5', 0.5, 0.3, { side: T.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const p = new T.Group(); p.rotation.x = i * Math.PI / 2;
      const f = new T.Mesh(new T.BoxGeometry(2, 0.15, 2.2), finMat); f.position.set(-6.2, 0, 1.6); p.add(f); g.add(p);
    }
    const gondola = new T.Mesh(new T.BoxGeometry(2.6, 0.9, 1), std('#4a5160', 0.5, 0.3)); gondola.position.y = -2.4; g.add(gondola);
    return g;
  }
  function rock(kind, seed) {
    const ice = kind === 'ice';
    const geo = jitter(new T.IcosahedronGeometry(1, kind === 'asteroid' ? 1 : 0), ice ? 0.18 : 0.25, seed);
    const mat = ice ? std('#bfe6f8', 0.15, 0.1, { flatShading: true, transparent: true, opacity: 0.92, emissive: new T.Color('#2a5f80'), emissiveIntensity: 0.25 })
      : std(kind === 'meteor' ? '#6b5546' : '#8a7c70', 0.95, 0, { flatShading: true });
    const g = new T.Group();
    const m = new T.Mesh(geo, mat); m.name = 'spin'; g.add(m);
    return g;
  }
  function meteor(comet) {
    const g = rock(comet ? 'ice' : 'meteor', comet ? 5 : 9);
    const tail = new T.Mesh(new T.ConeGeometry(1.1, comet ? 18 : 9, 14, 1, true), additive(comet ? 0xaae6ff : 0xffa03c, 0.55));
    tail.rotation.z = Math.PI / 2; tail.position.x = -(comet ? 9 : 4.5);   // trails along -X; the game turns it against the motion
    tail.name = 'tail'; g.add(tail);
    const s = new T.Sprite(glowMat(comet ? 0xaae6ff : 0xff8c32, 0.7)); s.scale.set(6, 6, 1); g.add(s);
    return g;
  }
  function satellite(big) {
    const g = new T.Group();
    const foil = std('#d9a441', 0.35, 0.8, { emissive: new T.Color('#4a3000'), emissiveIntensity: 0.3 });
    const body = new T.Mesh(new T.BoxGeometry(1.8, 2, 1.8), foil); g.add(body);
    const pm = new T.MeshStandardMaterial({ map: TEX.panel, roughness: 0.3, metalness: 0.5, side: T.DoubleSide });
    for (const s of [-1, 1]) {
      const arm = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 1.4, 6).rotateZ(Math.PI / 2), std('#9aa1ad', 0.4, 0.7)); arm.position.x = s * 1.6; g.add(arm);
      const p = new T.Mesh(new T.BoxGeometry(big ? 5 : 3.6, 0.08, 1.8), pm); p.position.x = s * (big ? 4.8 : 4.1); g.add(p);
    }
    const dish = new T.Mesh(new T.SphereGeometry(big ? 1.4 : 0.9, 16, 8, 0, TAU, 0, Math.PI / 3), std('#e6e9ef', 0.4, 0.3, { side: T.DoubleSide }));
    dish.position.y = 1.3; dish.rotation.x = Math.PI; g.add(dish);
    if (big) { const ant = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 3, 6), std('#d0d4dc', 0.4, 0.7)); ant.position.y = -2.4; g.add(ant); }
    return g;
  }
  function debris() {
    const g = new T.Group();
    const m = new T.Mesh(jitter(new T.BoxGeometry(1.8, 0.7, 1.2, 2, 1, 2), 0.3, 7), std('#8a909c', 0.5, 0.7, { flatShading: true }));
    g.add(m);
    const stripe = new T.Mesh(new T.BoxGeometry(0.6, 0.72, 0.4), std('#e2402f', 0.6, 0.2)); stripe.position.x = 0.4; g.add(stripe);
    return g;
  }
  function plasma() {
    const g = new T.Group();
    const core = new T.Mesh(new T.SphereGeometry(0.9, 18, 12), new T.MeshStandardMaterial({ color: 0xf6e9ff, emissive: 0xc070ff, emissiveIntensity: 1.6 }));
    g.add(core);
    const s = new T.Sprite(glowMat(0xc878ff, 0.85)); s.scale.set(7, 7, 1); g.add(s);
    const shell = new T.Mesh(new T.IcosahedronGeometry(1.6, 1), new T.MeshBasicMaterial({ color: 0xd8a0ff, wireframe: true, transparent: true, opacity: 0.35, blending: T.AdditiveBlending }));
    shell.name = 'spin'; s.name = 'glow'; g.add(shell);
    return g;
  }

  // ---------- backdrop bodies ----------
  function planet(type, radius) {
    const g = new T.Group();
    const mat = new T.MeshStandardMaterial({ map: TEX[type], roughness: 1, metalness: 0 });
    const s = new T.Mesh(new T.SphereGeometry(radius, 48, 32), mat);
    g.add(s);
    if (type === 'saturn') {
      const rg = new T.RingGeometry(radius * 1.3, radius * 2.3, 96, 1);
      // map u along the radius
      const pos = rg.attributes.position, uv = rg.attributes.uv, v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); uv.setXY(i, (v.length() - radius * 1.3) / (radius * 1.0), 0.5); }
      const ring = new T.Mesh(rg, new T.MeshBasicMaterial({ map: TEX.ring, transparent: true, side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = Math.PI / 2 - 0.35;
      g.add(ring);
    }
    g.userData.sphere = s;
    return g;
  }

  return {
    TEX, buildTextures, std, glowMat, additive, stretchBetween, mulberry, jitter, FLAME_COLORS,
    rocket, launchPad, treeParts, mountain, hill, shared, gem, fuelCan, boostRing,
    bird, partyBalloons, weatherBalloon, ufo, drone, zeppelin, rock, meteor, satellite, debris, plasma, planet,
  };
})();
