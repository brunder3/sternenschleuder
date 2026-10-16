/* Sternenschleuder 3D models and procedural textures (three.js r159 classic build).
   Most models are built from primitives at runtime. Photos come from js/photos.js, and three real
   launchers plus the launch tower are NASA glTF models from js/nasa.js; the procedural ones stay as fallbacks.
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
  // painted metal: a clear coat over the colour reflects the sky
  const paintCache = new Map();
  function paint(color, rough = 0.4, metal = 0.1) {
    const key = color + '|' + rough + '|' + metal;
    if (!paintCache.has(key)) paintCache.set(key, new T.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, clearcoat: 0.5, clearcoatRoughness: 0.2 }));
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
  function coinNormalCanvas() {
    const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    g.lineWidth = 7; g.beginPath(); g.arc(S / 2, S / 2, S * 0.4, 0, TAU); g.stroke();
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; g.beginPath(); g.arc(S / 2 + Math.cos(a) * S * 0.345, S / 2 + Math.sin(a) * S * 0.345, 3.4, 0, TAU); g.fill(); }
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i / 10 * TAU, r = i % 2 ? S * 0.11 : S * 0.26; g.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); }
    g.closePath(); g.fill();
    // soften, then turn the heights into normals
    const blur = makeCanvas(S, S), bg = blur.getContext('2d'); bg.filter = 'blur(2.2px)'; bg.drawImage(c, 0, 0);
    const src = bg.getImageData(0, 0, S, S).data, img = g.createImageData(S, S), d = img.data;
    const h = (x, y) => src[(Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))) * 4] / 255;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = (h(x - 1, y) - h(x + 1, y)) * 2.2, ny = (h(x, y + 1) - h(x, y - 1)) * 2.2, l = Math.hypot(nx, ny, 1), k = (y * S + x) * 4;
      d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function chevronCanvas() {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const x of [38, 72]) { g.beginPath(); g.moveTo(x, 30); g.lineTo(x + 26, 64); g.lineTo(x, 98); g.stroke(); }
    return c;
  }
  // turn a grey height canvas into a tangent-space normal map (rows wrap only when wrapY is set)
  function heightToNormal(src, strength, wrapY) {
    const w = src.width, h = src.height, sd = src.getContext('2d').getImageData(0, 0, w, h).data;
    const c = makeCanvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    const H = (x, y) => sd[(((y + h) % h) * w + (x + w) % w) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const yu = wrapY ? y - 1 : Math.max(0, y - 1), yd = wrapY ? y + 1 : Math.min(h - 1, y + 1);
      // canvas rows run down while texture v runs up, hence the sign of ny
      const nx = -(H(x + 1, y) - H(x - 1, y)) * strength, ny = (H(x, yd) - H(x, yu)) * strength, l = Math.hypot(nx, ny, 1), k = (y * w + x) * 4;
      d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  // rocket skin, wrapped once around and once along the body: welded panel rings with rivets,
  // faint weathering streaks and engine soot toward the tail (the bottom of the canvas)
  function hullCanvases() {
    const W = 512, H = 1024, rnd = mulberry(77);
    const c = makeCanvas(W, H), g = c.getContext('2d');
    const hc = makeCanvas(W, H), hg = hc.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {                    // large, soft paint variation
      g.fillStyle = `rgba(${rnd() < 0.5 ? '120,120,130' : '255,255,255'},${0.025 + rnd() * 0.03})`;
      g.fillRect(rnd() * W, rnd() * H, 20 + rnd() * 120, 10 + rnd() * 60);
    }
    const rings = 7;
    for (let k = 0; k <= rings; k++) {
      const y = Math.round(k * H / rings);
      g.fillStyle = 'rgba(40,44,52,.28)'; g.fillRect(0, y - 1, W, 2);
      g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, y + 1, W, 1);
      hg.fillStyle = '#3a3a3a'; hg.fillRect(0, y - 2, W, 4);
      for (let x = 4; x < W; x += 9) for (const dy of [-7, 7]) {   // rivet rows either side of the weld
        hg.fillStyle = '#d0d0d0'; hg.beginPath(); hg.arc(x, y + dy, 1.6, 0, TAU); hg.fill();
        g.fillStyle = 'rgba(60,64,72,.22)'; g.fillRect(x - 1, y + dy - 1, 2, 2);
      }
      if (k < rings) {                                // staggered vertical panel seams
        const off = rnd();
        for (let j = 0; j < 6; j++) {
          const x = Math.round(((j + off) / 6) * W) % W;
          g.fillStyle = 'rgba(40,44,52,.2)'; g.fillRect(x, y, 1.5, H / rings);
          hg.fillStyle = '#505050'; hg.fillRect(x - 1, y, 3, H / rings);
        }
      }
    }
    for (let i = 0; i < 70; i++) {                    // rain and frost streaks
      const x = rnd() * W, y = rnd() * H, len = 40 + rnd() * 200;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, `rgba(90,84,76,${0.05 + rnd() * 0.07})`); gr.addColorStop(1, 'rgba(90,84,76,0)');
      g.fillStyle = gr; g.fillRect(x, y, 1 + rnd() * 3, len);
    }
    const soot = g.createLinearGradient(0, H, 0, H * 0.74);   // engine soot at the tail
    soot.addColorStop(0, 'rgba(26,22,18,.7)'); soot.addColorStop(0.35, 'rgba(40,34,28,.28)'); soot.addColorStop(1, 'rgba(40,34,28,0)');
    g.fillStyle = soot; g.fillRect(0, H * 0.7, W, H * 0.3);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W, len = H * (0.05 + rnd() * 0.22), gr = g.createLinearGradient(0, H, 0, H - len);
      gr.addColorStop(0, `rgba(20,16,12,${0.15 + rnd() * 0.25})`); gr.addColorStop(1, 'rgba(20,16,12,0)');
      g.fillStyle = gr; g.fillRect(x, H - len, 1 + rnd() * 4, len);
    }
    return { map: c, normal: heightToNormal(hc, 6, false) };
  }
  // engine bell along v: dome and chamber in steel, brazed copper tubes at the throat,
  // heat-tinted blue and gold toward the exit, soot at the lip
  function bellCanvas() {
    const c = makeCanvas(128, 256), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    [[0, '#9aa0aa'], [0.22, '#7d838e'], [0.32, '#b4774a'], [0.45, '#a8673c'], [0.58, '#6d6a86'], [0.74, '#8a7a5a'], [0.9, '#4a4440'], [1, '#1d1a18']]
      .forEach(([t, col]) => gr.addColorStop(t, col));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 256);
    for (let x = 0; x < 128; x += 2) { g.fillStyle = x % 4 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.08)'; g.fillRect(x, 60, 1, 196); }
    for (const y of [56, 84, 150, 200]) { g.fillStyle = 'rgba(30,30,34,.55)'; g.fillRect(0, y, 128, 3); }
    return c;
  }
  // poured concrete apron: slab joints, tyre and rust stains, scorch around the flame trench
  function concreteCanvas() {
    const W = 1024, H = 784, rnd = mulberry(5), c = makeCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#b9bcc2'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      const v = 150 + rnd() * 70 | 0;
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.08 + rnd() * 0.12})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    for (let i = 0; i < 40; i++) {
      const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 90, gr = g.createRadialGradient(x, y, 0, x, y, r);
      const col = rnd() < 0.25 ? '120,84,50' : '70,72,78';
      gr.addColorStop(0, `rgba(${col},${0.05 + rnd() * 0.1})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    g.fillStyle = 'rgba(70,72,78,.55)';
    for (let x = 0; x <= W; x += W / 8) g.fillRect(x - 1, 0, 2, H);
    for (let y = 0; y <= H; y += H / 6) g.fillRect(0, y - 1, W, 2);
    // scorch: the flame trench sits at x = 1.5 on the 33.6 x 25.6 deck
    const tx = (1.5 + 16.8) / 33.6 * W, ty = H / 2;
    for (const [r, a] of [[360, 0.35], [220, 0.5], [140, 0.6]]) {
      const gr = g.createRadialGradient(tx + 40, ty, 0, tx + 40, ty, r);
      gr.addColorStop(0, `rgba(22,20,18,${a})`); gr.addColorStop(1, 'rgba(22,20,18,0)');
      g.fillStyle = gr; g.fillRect(tx + 40 - r, ty - r, 2 * r, 2 * r);
    }
    return c;
  }
  // vertical name on the hull, read from tail to nose like the lettering on real launchers
  function labelCanvas(text, color) {
    const c = makeCanvas(128, 640), g = c.getContext('2d');
    g.translate(64, 320); g.rotate(-Math.PI / 2);
    let size = 84;
    g.font = `800 ${size}px system-ui, sans-serif`;
    const w = g.measureText(text).width;
    if (w > 600) { size = Math.floor(size * 600 / w); g.font = `800 ${size}px system-ui, sans-serif`; }
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 0, 4);
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
    TEX.coinNormal = canvasTex(coinNormalCanvas()); TEX.coinNormal.colorSpace = T.NoColorSpace;
    const hc = hullCanvases();
    TEX.hull = canvasTex(hc.map); TEX.hull.wrapS = T.RepeatWrapping;
    TEX.hullN = canvasTex(hc.normal); TEX.hullN.wrapS = T.RepeatWrapping; TEX.hullN.colorSpace = T.NoColorSpace;
    TEX.bell = canvasTex(bellCanvas()); TEX.bell.wrapS = T.RepeatWrapping;
    TEX.concrete = canvasTex(concreteCanvas()); TEX.concrete.anisotropy = 8;
    loadPhotos();
    loadModels();
  }
  // photo textures from js/photos.js (embedded data URLs); the drawn textures above stay as fallbacks
  function loadPhotos() {
    if (typeof PHOTOS === 'undefined') return;
    const L = new T.TextureLoader();
    const photo = (key, srgb = true, repeat = false) => {
      const t = L.load(PHOTOS[key]);
      t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
      t.anisotropy = 8;
      return t;
    };
    TEX.photo = {
      grass: photo('grass', true, true), rock: photo('rock', true, true), sand: photo('sand', true, true), soil: photo('soil', true, true),
      milkyway: photo('milkyway'), earthClouds: photo('earthClouds', false), cloud: photo('cloud'),
    };
    TEX.earth = photo('earth'); TEX.moon = photo('moon');
    if (PHOTOS.mars) { TEX.mars = photo('mars'); TEX.jupiter = photo('jupiter'); TEX.saturn = photo('saturn'); }
    TEX.waterNormal = photo('waterNormal', false, true);
    TEX.clouds = [TEX.photo.cloud];
    TEX.skyCube = new T.CubeTextureLoader().load(['sky_px', 'sky_nx', 'sky_py', 'sky_ny', 'sky_pz', 'sky_nz'].map(k => PHOTOS[k]), () => { TEX.skyCubeReady = true; });
    TEX.skyCube.colorSpace = T.SRGBColorSpace;
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
  // satin rocket paint over the panel texture: welds, rivets and soot come from TEX.hull / TEX.hullN
  const hullCache = new Map();
  function hull(color, rough = 0.48) {
    const key = color + '|' + rough;
    if (!hullCache.has(key)) hullCache.set(key, new T.MeshPhysicalMaterial({ color, map: TEX.hull, normalMap: TEX.hullN, normalScale: new T.Vector2(0.55, 0.55), roughness: rough, metalness: 0.08, clearcoat: 0.4, clearcoatRoughness: 0.28 }));
    return hullCache.get(key);
  }
  // map v along the height so the panel rings stay evenly spaced on any profile
  function lengthUV(geo, y0, y1) {
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setY(i, (p.getY(i) - y0) / (y1 - y0));
    return geo;
  }
  // rocket engine: dome, combustion chamber, throat and a bell nozzle; the exit lies at y = 0, the bell rises along +Y
  let bellMat = null;
  function engineBell(re) {
    if (!bellMat) bellMat = new T.MeshStandardMaterial({ map: TEX.bell, metalness: 0.85, roughness: 0.36, side: T.DoubleSide });
    const lb = re * 1.55, rt = re * 0.34, pts = [];
    for (let i = 0; i <= 12; i++) {             // bell: wide open at the exit, curving in to the throat
      const t = i / 12;
      pts.push([rt + (re - rt) * Math.pow(1 - t, 1.9) * (1 + 0.25 * t), t * lb]);
    }
    pts.push([rt * 1.55, lb * 1.12], [rt * 1.6, lb * 1.32], [rt * 1.2, lb * 1.45], [rt * 0.4, lb * 1.5]);
    const geo = lathe(pts, 28);
    const g = new T.Group();
    g.add(new T.Mesh(geo, bellMat));
    const lip = new T.Mesh(new T.TorusGeometry(re * 1.0, re * 0.035, 6, 28), bellMat);
    lip.rotation.x = Math.PI / 2; g.add(lip);
    // the hot throat glows faintly from inside
    const glow = new T.Mesh(new T.CircleGeometry(rt * 1.05, 16), new T.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0, toneMapped: false }));
    glow.rotation.x = Math.PI / 2; glow.position.y = lb * 0.98; g.add(glow);
    g.userData = { length: lb * 1.5, glow };
    return g;
  }
  // exhaust: three nested additive cones that fade toward the tip, shock diamonds and a glow sprite;
  // built from the nozzle exit along -Y
  let diamondGeo = null;
  function flame(cols, r, len) {
    const g = new T.Group();
    const layers = [[1, 1, cols[2], 0.75], [0.7, 0.72, cols[1], 0.9], [0.4, 0.42, cols[0], 1]];
    for (const [lm, wm, col, op] of layers) {
      const geo = new T.ConeGeometry(r * wm, len * lm, 24, 6, true);
      const pos = geo.attributes.position, rgba = new Float32Array(pos.count * 4), hh = len * lm / 2;
      // clamp: float32 positions can sit a hair above hh, and pow() of a negative number is NaN,
      // which the bloom pass would smear over the whole screen
      for (let i = 0; i < pos.count; i++) { const a = Math.pow(Math.max(0, (hh - pos.getY(i)) / (2 * hh)), 1.4); rgba.set([1, 1, 1, a], i * 4); }
      geo.setAttribute('color', new T.BufferAttribute(rgba, 4));
      const mat = new T.MeshBasicMaterial({ color: col, vertexColors: true, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
      const c = new T.Mesh(geo, mat);
      c.rotation.x = Math.PI; c.position.y = -len * lm / 2;
      mat.userData.op = op;
      g.add(c);
    }
    // Mach diamonds: standing shock knots in a supersonic jet
    if (!diamondGeo) diamondGeo = new T.SphereGeometry(1, 12, 8);
    const dm = new T.MeshBasicMaterial({ color: cols[0], transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
    g.userData.diamonds = dm;
    for (let i = 0; i < 4; i++) {
      const d = new T.Mesh(diamondGeo, dm), s = 1 - i * 0.17;
      d.scale.set(r * 0.36 * s, len * 0.045, r * 0.36 * s); d.position.y = -len * (0.09 + i * 0.12);
      g.add(d);
    }
    const glowS = new T.Sprite(glowMat(cols[1], 0.9));
    glowS.scale.set(r * 6, r * 6, 1); glowS.position.y = -r * 0.5;
    g.add(glowS);
    g.userData.baseLen = len;
    g.userData.mats = g.children.filter(o => o.isMesh && o.geometry.type === 'ConeGeometry').map(o => o.material);
    return g;
  }
  // vertex shader for the glowing shells: rim factor 0 face-on, 1 at the silhouette. Guarded so the pointed
  // tips (zero-length normals) and rounding never produce NaN, which the bloom pass would smear into black blocks.
  const RIM_VS = 'varying vec2 vUv; varying float vRim; void main(){ vUv = uv; vec3 n = normalMatrix * normal; float ln = length(n); n = ln > 1e-6 ? n / ln : vec3(0.0, 0.0, 1.0); vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 v = -mv.xyz; float lv = length(v); v = lv > 1e-6 ? v / lv : vec3(0.0, 0.0, 1.0); vRim = clamp(1.0 - abs(dot(n, v)), 0.0, 1.0); gl_Position = projectionMatrix * mv; }';
  // transonic vapour cone: condensation around the hull when the rocket punches through Mach 1
  // in moist, dense air; open toward the tail, densest just behind its leading edge
  function vaporCone(L, R) {
    const geo = new T.CylinderGeometry(R * 1.15, R * 3.2, L * 0.6, 40, 6, true);
    const mat = new T.ShaderMaterial({
      uniforms: { alpha: { value: 0 }, time: { value: 0 } },
      vertexShader: RIM_VS,
      fragmentShader: [
        'uniform float alpha; uniform float time; varying vec2 vUv; varying float vRim;',
        'void main(){',
        '  float lead = (1.0 - smoothstep(0.86, 1.0, vUv.y)) * smoothstep(0.0, 0.7, vUv.y);',
        '  float streak = 0.7 + 0.3 * sin(vUv.x * 70.0 + sin(vUv.x * 13.0 + time * 3.0) * 2.0) * sin(vUv.y * 21.0 - time * 5.0);',
        '  float a = alpha * lead * streak * (0.6 + 0.4 * vRim);',
        '  gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), min(0.92, a * 1.25));',
        '}'].join('\n'),
      transparent: true, depthWrite: false, side: T.DoubleSide,
    });
    const m = new T.Mesh(geo, mat);
    m.position.y = L * 0.02; m.visible = false; m.renderOrder = 2;
    return m;
  }
  // re-entry plasma: a glowing shock layer wrapped round the nose and a long ionised wake behind the tail
  function plasmaShell(L, R) {
    const g = new T.Group();
    const pts = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([R * 3 * Math.sqrt(t) + 0.0001, L / 2 + R * 0.8 - t * L * 0.6]); }
    pts.reverse();
    const shellMat = new T.ShaderMaterial({
      uniforms: { alpha: { value: 0 }, time: { value: 0 } },
      vertexShader: RIM_VS,
      fragmentShader: [
        'uniform float alpha; uniform float time; varying vec2 vUv; varying float vRim;',
        'void main(){',
        '  float front = clamp(vUv.y, 0.0, 1.0);',                                   // 1 at the stagnation point, 0 at the trailing edge
        '  vec3 col = mix(vec3(0.85, 0.18, 0.6), vec3(1.0, 0.42, 0.12), smoothstep(0.15, 0.55, front));',
        '  col = mix(col, vec3(1.0, 0.78, 0.45), smoothstep(0.8, 1.0, front));',
        '  float flick = 0.8 + 0.2 * sin(time * 37.0 + vUv.x * 40.0) * sin(time * 23.0 - vUv.y * 17.0);',
        '  float a = alpha * flick * (0.6 + 1.4 * pow(vRim, 1.5) + 1.0 * smoothstep(0.8, 1.0, front)) * smoothstep(0.0, 0.35, front);',
        '  gl_FragColor = vec4(col * 1.35, a);',
        '}'].join('\n'),
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false,
    });
    g.add(new T.Mesh(lathe(pts, 40), shellMat));
    const wakeMat = new T.ShaderMaterial({
      uniforms: { alpha: { value: 0 }, time: { value: 0 } },
      vertexShader: RIM_VS,
      fragmentShader: [
        'uniform float alpha; uniform float time; varying vec2 vUv; varying float vRim;',
        'void main(){',
        '  float along = clamp(vUv.y, 0.0, 1.0);',                                    // 1 at the tail, 0 far behind
        '  float streak = 0.45 + 0.55 * sin(vUv.x * 60.0 + time * 13.0 + along * 11.0) * sin(vUv.x * 23.0 - time * 7.0);',
        '  vec3 col = mix(vec3(0.6, 0.18, 0.75), vec3(1.0, 0.5, 0.2), pow(along, 2.0));',
        '  float core = 1.0 - 0.75 * vRim;',                          // a glowing gas column is brightest down its middle
        '  gl_FragColor = vec4(col * 1.4, alpha * pow(along, 2.0) * max(streak, 0.2) * core * 0.65);',
        '}'].join('\n'),
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false,
    });
    const wake = new T.Mesh(new T.CylinderGeometry(R * 1.1, R * 2.6, L * 2.6, 32, 1, true), wakeMat);
    wake.position.y = -L / 2 - L * 1.3 + L * 0.1;
    g.add(wake);
    const hot = new T.Sprite(glowMat(0xff6a2a, 0));
    hot.scale.set(R * 16, R * 16, 1); hot.position.y = L / 2 + R * 0.3; g.add(hot);
    g.visible = false;
    g.userData.mats = [shellMat, wakeMat];
    g.userData.hot = hot;
    return g;
  }
  // shared tail of every rocket: shadows, flames, the throttle
  function finishRocket(root, L, R, flames, bells) {
    // glowing parts (flames, halo) are light, not solid: they cast no shadow
    root.traverse(o => { if (o.isMesh) o.castShadow = o.material.blending !== T.AdditiveBlending; });
    const inner = root.children[0];
    const vapor = vaporCone(L, R), plasma = plasmaShell(L, R);
    inner.add(vapor, plasma);
    let flick = 0;
    root.userData = {
      length: L, radius: R, flames,
      // level 0..1.6 (1 = boost, >1 = turbo); vac 0..1: in thin air the under-expanded plume balloons
      // wide and turns translucent, and the shock diamonds of the dense-air jet disappear
      setThrust(level, t, vac = 0) {
        flick = 0.85 + Math.sin(t * 47) * 0.07 + Math.random() * 0.14;
        const wide = 1 + 1.7 * vac, long = 1 + 0.35 * vac;
        flames.forEach(f => {
          const l = level * (f.userData.k || 1);
          f.visible = l > 0.02;
          if (!f.visible) return;
          const w = (0.7 + 0.3 * Math.min(1, l)) * wide;
          f.scale.set(w, Math.max(0.05, l * flick * long), w);
          f.userData.diamonds.opacity = 0.5 * (1 - vac);
          for (const m of f.userData.mats) m.opacity = m.userData.op * (1 - 0.45 * vac);
        });
        for (const b of bells) b.userData.glow.material.opacity = Math.min(1, level) * 0.9;
      },
      setVapor(a, t) {
        vapor.visible = a > 0.01;
        vapor.material.uniforms.alpha.value = a; vapor.material.uniforms.time.value = t;
      },
      setPlasma(a, t) {
        plasma.visible = a > 0.01;
        for (const m of plasma.userData.mats) { m.uniforms.alpha.value = a; m.uniforms.time.value = t; }
        plasma.userData.hot.material.opacity = Math.min(1, a) * (0.75 + 0.25 * Math.sin(t * 31));
      },
    };
    root.userData.setThrust(0, 0);
    return root;
  }
  // engine layouts (x, z as fractions of the hull radius)
  const CLUSTERS = {
    1: [[0, 0]],
    3: [0, 1, 2].map(i => [Math.cos(i * TAU / 3 + Math.PI / 2) * 0.46, Math.sin(i * TAU / 3 + Math.PI / 2) * 0.46]),
    5: [[0, 0], ...[0, 1, 2, 3].map(i => [Math.cos(i * TAU / 4 + Math.PI / 4) * 0.52, Math.sin(i * TAU / 4 + Math.PI / 4) * 0.52])],
  };
  function rocket(look) {
    if (look.model && GLB[look.model]) return modelRocket(look);
    const root = new T.Group();
    const inner = new T.Group();          // built along +Y, turned so the nose points along +X
    inner.rotation.z = -Math.PI / 2;
    root.add(inner);
    const L = 7.2 * look.len, R = 1.05 * look.w;
    const noseLen = look.nose === 'blunt' ? L * 0.17 : look.nose === 'cone' ? L * 0.3 : L * 0.34;
    const y0 = -L / 2, yB = L / 2 - noseLen;
    const bodyMat = hull(look.body), accMat = paint(look.accent, 0.4, 0.2), trimMat = paint(look.trim, 0.3, 0.6);
    const darkMetal = std('#3a3f4a', 0.35, 0.8, { side: T.DoubleSide });
    // body: a slight boat tail at the base, then a straight barrel up to the nose
    const prof = [[R * 0.8, y0], [R * 0.93, y0 + L * 0.02], [R * 0.985, y0 + L * 0.045], [R, y0 + L * 0.07]];
    for (let i = 1; i <= 10; i++) prof.push([R, y0 + L * 0.07 + (yB - y0 - L * 0.07) * i / 10]);
    inner.add(new T.Mesh(lengthUV(lathe(prof, 40), y0, yB), bodyMat));
    // heat shield across the base: the hull is open at the bottom; close it so it is not see-through from below
    const base = new T.Mesh(new T.CircleGeometry(R * 0.81, 32), darkMetal);
    base.rotation.x = Math.PI / 2; base.position.y = y0 + 0.001; inner.add(base);
    inner.add(new T.Mesh(lathe(noseProfile(look.nose, R, yB, noseLen), 40), accMat));
    // stripes
    const ring = (y, h, mat) => { const m = new T.Mesh(new T.CylinderGeometry(R * 1.012, R * 1.012, h, 40, 1, true), mat); m.position.y = y; inner.add(m); };
    if (look.stripes >= 3 && look.body === '#ffcd2e') for (let i = 0; i < 3; i++) ring(y0 + L * (0.18 + i * 0.16), L * 0.07, accMat);
    else if (look.stripes >= 3) for (let i = 0; i < 5; i++) ring(y0 + L * (0.12 + i * 0.11), L * 0.045, accMat);
    else {
      ring(yB - L * 0.05, L * 0.035, accMat);
      if (look.stripes > 1) ring(y0 + L * 0.2, L * 0.035, trimMat);
    }
    if (look.flame === 'water') ring(y0 + L * 0.34, L * 0.2, trimMat);
    // cable raceway along the hull and four RCS thruster pods under the nose
    const detail = std('#c9ccd3', 0.5, 0.45);
    const race = new T.Mesh(new T.BoxGeometry(R * 0.13, (yB - y0) * 0.78, R * 0.09), bodyMat);
    race.position.set(Math.sin(-1.1) * R, y0 + (yB - y0) * 0.5, Math.cos(-1.1) * R); race.rotation.y = -1.1; inner.add(race);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const pod = new T.Mesh(new T.BoxGeometry(R * 0.2, R * 0.26, R * 0.14), detail);
      pod.position.set(Math.sin(a) * R * 1.02, yB - L * 0.025, Math.cos(a) * R * 1.02); pod.rotation.y = a; inner.add(pod);
    }
    // painted name, on the side the chase camera sees
    if (look.label) {
      const col = new T.Color(look.body), lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
      const tex = canvasTex(labelCanvas(look.label, lum > 0.35 ? '#1b1f29' : '#eef1f6'));
      const h = (yB - y0) * 0.5;
      const lab = new T.Mesh(new T.CylinderGeometry(R * 1.004, R * 1.004, h, 12, 1, true, -0.32, 0.64),
        new T.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.25, roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }));
      lab.position.y = y0 + L * 0.1 + h / 2; inner.add(lab);
    }
    // fins
    const nFins = look.fins === 'wing' ? 2 : look.fins === 'grid' ? 4 : look.len < 1 ? 3 : 4;
    const finGeo = new T.ExtrudeGeometry(finShape(look.fins === 'grid' ? 'delta' : look.fins, R, L), { depth: R * 0.09, bevelEnabled: true, bevelThickness: R * 0.025, bevelSize: R * 0.022, bevelSegments: 2 });
    finGeo.translate(0, 0, -R * 0.045);
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
    // engines: one big bell on small rockets, clusters of three or five on the long ones
    const cols = FLAME_COLORS[look.flame] || FLAME_COLORS.warm;
    const flames = [], bells = [];
    const nEng = L >= 9.8 ? 5 : L >= 8.6 ? 3 : 1;
    const re = R * (nEng === 1 ? 0.6 : nEng === 3 ? 0.4 : 0.31);
    const exitY = y0 - re * 1.55 * 0.9;
    for (const [ex, ez] of CLUSTERS[nEng]) {
      const b = engineBell(re); b.position.set(ex * R, exitY, ez * R); inner.add(b); bells.push(b);
      const f = flame(cols, re * (nEng === 1 ? 1.03 : 1.15), L * (nEng === 1 ? 0.75 : 0.6));
      f.position.set(ex * R, exitY, ez * R); inner.add(f); flames.push(f);
    }
    // boosters
    if (look.boosters) {
      for (const s of [-1, 1]) {
        const br = R * 0.48, bl = L * 0.55, bx = s * R * 1.42;
        const b = new T.Mesh(lengthUV(lathe([[br * 0.8, 0], [br, bl * 0.06], [br, bl * 0.8], ...noseProfile('ogive', br, bl * 0.8, bl * 0.2).slice(1)], 28), 0, bl * 0.8), hull(look.trim, 0.42));
        b.position.set(bx, y0 + L * 0.02, 0); inner.add(b);
        const bb = new T.Mesh(new T.CircleGeometry(br * 0.81, 20), darkMetal);
        bb.rotation.x = Math.PI / 2; bb.position.set(bx, y0 + L * 0.02 + 0.001, 0); inner.add(bb);
        const bre = br * 0.62, by = y0 + L * 0.02 - bre * 1.55 * 0.85;
        const bn = engineBell(bre); bn.position.set(bx, by, 0); inner.add(bn); bells.push(bn);
        const strap = new T.Mesh(new T.BoxGeometry(R * 0.9, L * 0.03, br * 0.5), accMat);
        strap.position.set(s * R * 0.95, y0 + L * 0.4, 0); inner.add(strap);
        const f = flame(cols, bre, L * 0.5);
        f.position.set(bx, by, 0); f.userData.k = 0.8; inner.add(f); flames.push(f);
      }
    }
    if (look.flame === 'void') {
      const halo = new T.Mesh(new T.TorusGeometry(R * 1.3, R * 0.05, 8, 40), additive(0xb48cff, 0.8));
      halo.rotation.x = Math.PI / 2; halo.position.y = yB - L * 0.1; inner.add(halo);
    }
    return finishRocket(root, L, R, flames, bells);
  }

  // ---------- NASA 3D models (js/nasa.js, public domain) ----------
  // Each spec gives, in model units: the rocket axis (x, z), the tail and nose heights, the hull radius,
  // the engine exits (x, z relative to the axis), their radius and height.
  const MODEL_SPEC = {
    saturnv: { axis: [-0.015, 0.745], y0: -0.14, y1: 12.85, R: 0.66, er: 0.21, ey: -0.12, engines: [[0, 0], [-0.455, -0.335], [0.335, -0.455], [0.46, 0.335], [-0.33, 0.455]] },
    jupiterc: { axis: [-0.14, 0], y0: 1.36, y1: 18.83, R: 0.75, er: 0.34, ey: 1.6, engines: [[0, 0]] },
    ares1b: { axis: [-0.085, 0], y0: 0.2, y1: 9.86, R: 0.31, er: 0.21, ey: 0.22, engines: [[0, 0]] },
  };
  const GLB = {};
  let glbPending = 0;
  const glbWaiters = [];
  function loadModels() {
    if (typeof NASA_MODELS === 'undefined' || !T.GLTFLoader) return;
    const loader = new T.GLTFLoader();
    if (T.MeshoptDecoder) loader.setMeshoptDecoder(T.MeshoptDecoder);
    const done = () => { if (--glbPending === 0) glbWaiters.splice(0).forEach(f => f()); };
    for (const [name, b64] of Object.entries(NASA_MODELS)) {
      glbPending++;
      try {
        const bin = atob(b64), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        loader.parse(buf.buffer, '', gltf => { GLB[name] = gltf.scene; done(); }, err => { console.warn('model', name, err); done(); });
      } catch (err) { console.warn('model', name, err); done(); }
    }
  }
  // run f once the embedded models are parsed (at once if there are none)
  function onModels(f) { if (glbPending === 0) f(); else glbWaiters.push(f); }
  function modelRocket(look) {
    const spec = MODEL_SPEC[look.model];
    const root = new T.Group();
    const inner = new T.Group();
    inner.rotation.z = -Math.PI / 2;
    root.add(inner);
    const L = 7.2 * look.len, s = L / (spec.y1 - spec.y0);
    // stretch the girth a little so slim real rockets still read at chase-camera distance
    const fat = look.fat || 1;
    const m = GLB[look.model].clone(true);
    m.position.set(-spec.axis[0], -spec.y0, -spec.axis[1]);
    const holder = new T.Group();
    holder.scale.set(s * fat, s, s * fat); holder.position.y = -L / 2;
    holder.add(m); inner.add(holder);
    const cols = FLAME_COLORS[look.flame] || FLAME_COLORS.warm;
    const flames = [];
    const ey = -L / 2 + (spec.ey - spec.y0) * s, er = spec.er * s * fat;
    for (const [ex, ez] of spec.engines) {
      const f = flame(cols, er * 1.1, L * (spec.engines.length > 1 ? 0.62 : 0.75));
      f.position.set(ex * s * fat, ey, ez * s * fat); inner.add(f); flames.push(f);
    }
    return finishRocket(root, L, spec.R * s * fat, flames, []);
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
    // the top face of the slab carries the whole apron texture (joints, stains, scorch round the trench)
    const top = new T.Mesh(new T.BoxGeometry(33.6, 0.1, 25.6), [std('#c3c8d1', 0.9, 0), std('#c3c8d1', 0.9, 0), new T.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.92, metalness: 0 }), std('#c3c8d1', 0.9, 0), std('#c3c8d1', 0.9, 0), std('#c3c8d1', 0.9, 0)]);
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
    // the launch rail (erector): a welded steel truss with clamp arms, rotated by setRail()
    const rail = new T.Group(); rail.position.set(0, PAD_PIVOT, 0); g.add(rail);
    rail.add(truss(17, 1.3, -0.3, -2.6, std('#d9dde4', 0.45, 0.55)));
    const spine = new T.Mesh(new T.BoxGeometry(17, 0.22, 0.5), red); spine.position.set(8.2, 0.72, -2.6); rail.add(spine);
    const clamps = [];
    for (const x of [3, 8, 13]) {
      const hinge = new T.Group(); hinge.position.set(x, 0, -2); rail.add(hinge);
      const arm = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 1.6), white); arm.position.z = 0.8; hinge.add(arm);
      const pad = new T.Mesh(new T.BoxGeometry(0.7, 0.9, 0.25), red); pad.position.z = 1.6; hinge.add(pad);
      clamps.push(hinge);
    }
    const foot = new T.Mesh(new T.CylinderGeometry(1.2, 1.4, 0.6, 16), metal);
    foot.rotation.z = Math.PI / 2; foot.position.set(-0.2, 0, 0); rail.add(foot);
    // service tower with a swing arm and a warning light on top; replaced by NASA's
    // Mobile Launcher umbilical tower once the embedded models are parsed (see below)
    const tower = new T.Group(); tower.position.set(-6, 1.6, -8.5); g.add(tower);
    const tw = new T.Mesh(new T.BoxGeometry(3.2, 26, 3.2), latMat); tw.position.y = 13; tower.add(tw);
    for (let y = 4; y < 26; y += 5.5) { const deck = new T.Mesh(new T.BoxGeometry(3.8, 0.3, 3.8), metal); deck.position.y = y; tower.add(deck); }
    const cap = new T.Mesh(new T.BoxGeometry(3.8, 1.2, 3.8), red); cap.position.y = 26.4; tower.add(cap);
    const lamp = new T.Mesh(new T.SphereGeometry(0.45, 12, 8), lightMat); lamp.position.y = 27.4; g.add(lamp); lamp.position.add(tower.position);
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
    onModels(() => {
      if (!GLB.tower) return;
      // the umbilical tower stands behind the rail; its crew access arm reaches toward the rocket
      const lut = GLB.tower.clone(true), S = 9;
      lut.scale.setScalar(S); lut.rotation.y = Math.PI / 2;
      lut.position.set(0.5, 1.6 - 0.4767 * S, -2);
      lut.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        // the source is painted as bare metal and turns black without a mirror-like sky: make it painted steel
        o.material = o.material.clone(); o.material.metalness = 0.35; o.material.roughness = 0.62; o.material.color.setScalar(1.7);
      });
      g.add(lut);
      tower.visible = false;
      lamp.position.set(0.5 + 0.03 * S, 1.6 + (2.464 - 0.4767) * S + 0.5, -2 - 0.4 * S);
    });
    return g;
  }
  // square steel truss along +X: four chords, diagonal bracing on every face and cross frames
  function truss(len, size, x0, z, mat) {
    const h = size / 2, bay = size * 1.1, n = Math.max(1, Math.round(len / bay)), step = len / n;
    const corners = [[h, h], [h, -h], [-h, -h], [-h, h]];
    const segs = [];
    for (const [y, zz] of corners) segs.push([[x0, y, z + zz], [x0 + len, y, z + zz], 0.11]);
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * step, xb = xa + step;
      for (let c = 0; c < 4; c++) {
        const [ya, za] = corners[c], [yb, zb] = corners[(c + 1) % 4];
        segs.push([[xa, ya, z + za], [xa, yb, z + zb], 0.06]);
        segs.push(i % 2 ? [[xa, ya, z + za], [xb, yb, z + zb], 0.05] : [[xa, yb, z + zb], [xb, ya, z + za], 0.05]);
      }
    }
    for (const [y, zz] of corners.slice(0, 2)) segs.push([[x0 + len, y, z + zz], [x0 + len, -y, z + zz], 0.06]);
    const geo = new T.CylinderGeometry(1, 1, 1, 6, 1);
    const im = new T.InstancedMesh(geo, mat, segs.length), o = new T.Object3D(), a = new T.Vector3(), b = new T.Vector3();
    segs.forEach(([p, q, r], i) => {
      a.fromArray(p); b.fromArray(q); stretchBetween(o, a, b); o.scale.x = o.scale.z = r; o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    });
    im.castShadow = true;
    return im;
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
    // a minted coin: recessed faces inside a raised rim; the faces carry an embossed star (normal map)
    const prof = [[0, 0.075], [0.8, 0.075], [0.835, 0.12], [0.96, 0.13], [1, 0.1], [1, -0.1], [0.96, -0.13], [0.835, -0.12], [0.8, -0.075], [0, -0.075]];
    const coin = new T.LatheGeometry(prof.map(([x, y]) => new T.Vector2(x, y)), 40);
    const pos = coin.attributes.position, uv = coin.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 0.5 + 0.5, pos.getZ(i) * 0.5 + 0.5);
    SHARED.coinGeo = coin.rotateZ(Math.PI / 2);   // axis along x: the face looks at the chase camera
    // polished metal reflects the sky; a faint glow keeps coins readable in shadow and in space
    const metal = (color, glow, rough) => new T.MeshStandardMaterial({ color, metalness: 1, roughness: rough, normalMap: TEX.coinNormal, normalScale: new T.Vector2(1.1, 1.1), emissive: glow, emissiveIntensity: 0.32, envMapIntensity: 1.6 });
    SHARED.coinMats = [metal('#e6a55c', '#8a4c18', 0.3), metal('#e4e9f0', '#6a7690', 0.24), metal('#ffcb3d', '#a86a00', 0.26)];
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
  // the Earth's atmosphere seen from space: a thin bright limb, blue on the day side, orange at the
  // terminator, dark at night. Brightness follows how close the view ray grazes the surface.
  function atmosphereShell(radius) {
    const top = radius * 1.035;
    const mat = new T.ShaderMaterial({
      uniforms: { sunDir: { value: new T.Vector3(0.4, 0.6, -0.7).normalize() }, r0: { value: radius }, r1: { value: top } },
      vertexShader: 'varying vec3 vWorld; varying vec3 vCenter; varying float vScale; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vScale = length(modelMatrix[0].xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: [
        'uniform vec3 sunDir; uniform float r0; uniform float r1; varying vec3 vWorld; varying vec3 vCenter; varying float vScale;',
        'void main(){',
        '  vec3 o = vCenter;',
        '  float sc = vScale;',
        '  float R0 = r0 * sc, R1 = r1 * sc;',
        '  vec3 d = normalize(vWorld - cameraPosition);',
        '  vec3 oc = o - cameraPosition;',
        '  float tc = dot(oc, d);',
        '  vec3 closest = cameraPosition + d * tc;',
        '  float h = (length(closest - o) - R0) / (R1 - R0);',          // 0 grazing the ground, 1 at the top of the air
        '  float glow = exp(-max(h, 0.0) * 3.2) * (1.0 - smoothstep(0.85, 1.0, h));',
        // from inside the air (low orbit) only rays toward the planet cross much of it: looking up stays black
        '  glow *= smoothstep(-0.12, 0.03, dot(d, normalize(oc)));',
        '  vec3 up = closest - o; float lu = length(up);',
        '  float day = lu > 1e-4 * R0 ? dot(up / lu, sunDir) : 1.0;',
        '  vec3 col = mix(vec3(1.0, 0.45, 0.2), vec3(0.32, 0.6, 1.0), smoothstep(-0.05, 0.35, day));',
        '  float lit = smoothstep(-0.35, 0.15, day);',
        '  gl_FragColor = vec4(col * glow * (0.08 + 1.1 * lit), 1.0);',
        '}'].join('\n'),
      side: T.BackSide, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    });
    const m = new T.Mesh(new T.SphereGeometry(top, 64, 32), mat);
    m.userData.atmosphere = true;
    return m;
  }
  function planet(type, radius) {
    const g = new T.Group();
    const mat = new T.MeshStandardMaterial({ map: TEX[type], roughness: 1, metalness: 0 });
    if (type === 'earth' && TEX.photo) {
      mat.onBeforeCompile = sh => {
        sh.uniforms.detail = { value: TEX.photo.rock };
        sh.fragmentShader = 'uniform sampler2D detail;\n' + sh.fragmentShader
          .replace('#include <map_fragment>', [
            '#include <map_fragment>',
            'float land = smoothstep(0.02, 0.14, diffuseColor.r + diffuseColor.g * 0.5 - diffuseColor.b);',
            'float dl = dot(texture2D(detail, vMapUv * vec2(240.0, 120.0)).rgb, vec3(0.45));',
            'diffuseColor.rgb *= mix(1.0, clamp(0.55 + dl * 1.3, 0.6, 1.4), 0.5 * land);'].join('\n'))
          .replace('#include <opaque_fragment>', [
            // seen through the air the ground turns blue, the more so toward the horizon
            'float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);',
            'outgoingLight = mix(outgoingLight, vec3(0.3, 0.5, 0.9) * 0.6, 0.12 + 0.75 * pow(1.0 - ndv, 3.0));',
            '#include <opaque_fragment>'].join('\n'));
      };
    }
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
    if (type === 'earth') g.add(atmosphereShell(radius));
    if (type === 'earth' && TEX.photo) {
      const cl = new T.Mesh(new T.SphereGeometry(radius * 1.012, 48, 32), new T.MeshStandardMaterial({ color: 0xffffff, alphaMap: TEX.photo.earthClouds, transparent: true, depthWrite: false, roughness: 1 }));
      s.add(cl);
    }
    g.userData.sphere = s;
    return g;
  }

  return {
    TEX, buildTextures, std, glowMat, additive, stretchBetween, mulberry, jitter, FLAME_COLORS,
    rocket, launchPad, onModels, treeParts, mountain, hill, shared, gem, fuelCan, boostRing,
    bird, partyBalloons, weatherBalloon, ufo, drone, zeppelin, rock, meteor, satellite, debris, plasma, planet,
  };
})();
