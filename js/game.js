/* Sternenschleuder game: state machine, input, flight, spawning, camera, HUD and menus.
   Physics runs in units u (see core.js); three.js positions are u * World.S.
   The rocket flies in the plane z = 0: forward is +x, up is +y. */
(() => {
  'use strict';
  const T = THREE;
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const FONT_DISPLAY = "'Bungee', 'Arial Black', Impact, sans-serif";
  const FINE_POINTER = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);

  // ================= boot checks =================
  const glCanvas = $('gl'), fxCanvas = $('fx'), fctx = fxCanvas.getContext('2d');
  try { World.init(glCanvas); } catch (e) { $('nogl').hidden = false; console.error(e); return; }
  const S = World.S, scene = World.scene, camera = World.camera;
  let W = 800, H = 600, DPR = 1;

  // ================= save =================
  const SAVE_KEY = 'sternenschleuder-v1';
  let save = defaultSave();
  let stats = computeStats(save);
  function loadSave(hot) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { raw = null; }
    return normalizeSave(raw || (hot && hot.save) || null);
  }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ } }

  // ================= state =================
  const G = {
    state: 'title', t: 0, paused: false, overlay: null,
    rocket: null, run: null,
    angle: PHYS.LAUNCH_DEFAULT, meter: 0, meterDir: 1,
    objs: [], texts: [], shake: 0, flash: 0, flashRgb: [255, 255, 255],
    spawnLast: { x: 0, y: 0 }, acc: {}, endTimer: 0, endReason: '', combo: 0, comboT: 0,
    lastZone: 0, descendT: 0, skipShown: false, hudCache: {}, tipT: 0, slowmo: 0, roll: 0, crashed: false, splash: false,
  };
  const RR = 18;                         // rocket hit radius (u)
  const CATAPULT_Y = World.heightAt(0, 0);
  const ANCHOR = 15;                     // band height above the platform (three units)
  let catapult, rocketMesh = null, rocketMeshId = '';

  // ================= launch site =================
  catapult = Models.catapult();
  catapult.position.set(0, CATAPULT_Y, 0);
  scene.add(catapult);
  function setRocketMesh(id) {
    if (rocketMeshId === id && rocketMesh) return;
    if (rocketMesh) { scene.remove(rocketMesh); rocketMesh.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    rocketMesh = Models.rocket((ROCKET_BY_ID[id] || ROCKETS[0]).look);
    rocketMesh.rotation.order = 'ZYX';
    rocketMeshId = id;
    scene.add(rocketMesh);
  }
  // rocket resting on the band: tail at the pouch, pulled back along the aim
  function padPose() {
    const pull = G.state === 'charge' ? 1.5 + 6.5 * G.meter : 1.5;
    const a = G.angle, L = rocketMesh ? rocketMesh.userData.length : 7;
    const tx = -Math.cos(a) * pull, ty = ANCHOR - Math.sin(a) * pull;
    return { tx, ty, cx: tx + Math.cos(a) * L / 2, cy: CATAPULT_Y + ty + Math.sin(a) * L / 2, a };
  }

  // ================= input =================
  const input = { down: false, id: null, keys: new Set(), armed: true, steerBtn: 0, dragY: null, dragSteer: 0, boostBtn: false };
  const keyDown = (...k) => k.some(x => input.keys.has(x));
  glCanvas.addEventListener('pointerdown', e => {
    Sfx.init();
    if (input.down) return;
    input.down = true; input.id = e.pointerId; input.dragY = e.clientY; input.dragSteer = 0;
    try { glCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (G.state === 'flight') input.armed = true;   // a fresh press after the launch fires the boosters
    primaryPress();
    e.preventDefault();
  });
  glCanvas.addEventListener('pointermove', e => {
    if (!input.down || e.pointerId !== input.id || G.state !== 'flight') return;
    const dy = input.dragY - e.clientY;
    input.dragSteer = Math.abs(dy) < 14 ? 0 : clamp(dy / 70, -1, 1);
  });
  function pointerEnd(e) {
    if (e.pointerId !== input.id) return;
    input.down = false; input.id = null; input.dragSteer = 0; input.armed = true;
  }
  glCanvas.addEventListener('pointerup', pointerEnd);
  glCanvas.addEventListener('pointercancel', pointerEnd);
  glCanvas.addEventListener('contextmenu', e => e.preventDefault());
  glCanvas.addEventListener('wheel', e => { if (G.state === 'charge') { G.angle = clamp(G.angle - Math.sign(e.deltaY) * 0.05, PHYS.LAUNCH_MIN, PHYS.LAUNCH_MAX); } }, { passive: true });
  // a button the player reached with Tab keeps Space and Enter for itself (outside of flights)
  function keyboardFocusedButton() {
    const ae = document.activeElement;
    if (!ae || ae.tagName !== 'BUTTON' || G.state === 'flight') return false;
    try { return ae.matches(':focus-visible'); } catch (err) { return false; }
  }
  window.addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const btnFocus = keyboardFocusedButton();
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) && !G.overlay && G.state !== 'title' && !(btnFocus && k === ' ')) e.preventDefault();
    Sfx.init();
    // auto-repeat of a held boost key must not click a button that just got focus (results, pause)
    if (e.repeat) { if (k === ' ' || k === 'Enter') e.preventDefault(); input.keys.add(k); return; }
    input.keys.add(k);
    if (k === 'p' || k === 'Escape') {
      if (G.state === 'flight') togglePause();
      else if (G.overlay === 'hangar') closeHangar();
      else if (G.overlay === 'help') closeHelp();
      else if (G.state === 'charge') toMenu();
      return;
    }
    if (G.overlay) return;
    if (k === ' ' || k === 'Enter') {
      if (btnFocus) return;
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
      if (G.state === 'flight') input.armed = true;
      primaryPress();
    }
    if (G.state === 'flight' && (k === 'Shift' || k === 'e')) fireTurbo();
    if (G.state === 'menu' && k === 'h') openHangar('upgrades');
  });
  window.addEventListener('keyup', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    input.keys.delete(k);
    if (k === ' ' || k === 'Enter') input.armed = true;
  });
  window.addEventListener('blur', () => { input.keys.clear(); input.down = false; input.boostBtn = false; input.steerBtn = 0; if (G.state === 'flight' && !G.paused) togglePause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'flight' && !G.paused) togglePause(); });
  // on-screen steering and boost
  document.querySelectorAll('[data-steer]').forEach(b => {
    const dir = +b.dataset.steer;
    const on = e => { e.preventDefault(); Sfx.init(); input.steerBtn = dir; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
    const off = () => { if (input.steerBtn === dir) input.steerBtn = 0; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  });
  const boostBtn = $('btnBoost');
  boostBtn.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.init(); input.boostBtn = true; input.armed = true; try { boostBtn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
  const boostOff = () => { input.boostBtn = false; };
  boostBtn.addEventListener('pointerup', boostOff); boostBtn.addEventListener('pointercancel', boostOff); boostBtn.addEventListener('lostpointercapture', boostOff);
  $('btnTurbo').addEventListener('pointerdown', e => { e.preventDefault(); Sfx.init(); fireTurbo(); });
  $('btnTurbo').addEventListener('click', e => { if (e.detail === 0) fireTurbo(); });

  function primaryPress() {
    if (G.overlay) return;
    if (G.state === 'title') return startFromTitle();
    if (G.state === 'menu') return enterCharge();
    if (G.state === 'charge') return launch();
  }
  function steerInput() {
    let s = input.steerBtn || input.dragSteer;
    if (keyDown('w', 'ArrowUp')) s += 1;
    if (keyDown('s', 'ArrowDown')) s -= 1;
    return clamp(s, -1, 1);
  }
  function boostHeld() {
    return input.boostBtn || (input.armed && (input.down || keyDown(' ', 'Enter')));
  }

  // ================= screens =================
  function showScreen(name) {
    $('menu').hidden = name !== 'menu';
    $('charge').hidden = name !== 'charge';
    $('hud').hidden = name !== 'flight';
    $('title').hidden = name !== 'title';
    G.hudCache = {};
    if (name === 'menu') updateMenu();
    if (name === 'flight') $('flightTip').hidden = !(G.tipT > 0);
    if (name === 'flight' && !FINE_POINTER) $('flightTip').innerHTML = 'Halten für Schub<small>Boost-Knopf oder Bildschirm halten · Pfeile oder Ziehen lenkt</small>';
  }
  function startFromTitle() { Sfx.init(); Sfx.click(); toMenu(); }
  function toMenu() {
    G.state = 'menu'; G.rocket = null; G.run = null; G.crashed = false; G.splash = false;
    clearObjects(); World.fx.clear(); G.texts.length = 0;
    stats = computeStats(save);
    setRocketMesh(save.rocket);
    rocketMesh.visible = true;
    G.angle = PHYS.LAUNCH_DEFAULT;
    World.resetClouds(0, 40);
    showScreen('menu');
  }
  function enterCharge() {
    Sfx.click();
    G.state = 'charge'; G.meter = 0; G.meterDir = 1;
    showScreen('charge');
    $('cCoins').textContent = fmtNum(save.coins);
    $('perfectZone').style.width = ((1 - PHYS.PERFECT) * 100).toFixed(1) + '%';
  }

  // ================= launch & flight =================
  function newRun() {
    return { coins: 0, coinCount: 0, gems: 0, rings: 0, cans: 0, balloons: 0, hits: 0, shieldHits: 0, turbos: 0, fuelUsed: 0,
      maxH: 0, maxA: 0, maxV: 0, time: 0, bounces: 0, machDone: false, done: [], perfect: false, coinBonus: 1 };
  }
  function launch() {
    stats = computeStats(save);
    const p = G.meter, perfect = p >= PHYS.PERFECT;
    const pose = padPose();
    const r = { x: 0, y: pose.cy / S, vx: 0, vy: 0, a: G.angle, fuel: stats.fuel, fuelMax: stats.fuel, turboT: 0, boosting: false,
      turbo: stats.turbo, armor: stats.armor, bounces: stats.bounce, spin: 0, invuln: 0, px: 0, py: pose.cy / S };
    r.x = pose.cx / S; r.px = r.x;
    const v = launchSpeed(stats, p);
    r.vx = Math.cos(G.angle) * v; r.vy = Math.sin(G.angle) * v;
    G.rocket = r; G.run = newRun(); G.crashed = false; G.splash = false;
    G.state = 'flight'; G.paused = false;
    G.lastZone = 0; G.combo = 0; G.descendT = 0; G.skipShown = false;
    G.tipT = save.stats.flights < 3 ? 5 : 0;
    input.armed = true;                  // keep holding after the launch to fire the boosters
    r.hold = 1.2;                        // the nose keeps the launch angle for a moment
    clearObjects(); G.texts.length = 0;
    G.spawnLast = { x: r.x, y: r.y };
    G.acc = { coin: 0, fuel: 1200, ring: 800, obst: 0, friend: 0, amb: 0 };
    populateInitial();
    Sfx.catapult();
    G.shake = 5 + 6 * p;
    if (perfect) {
      G.run.perfect = true; G.run.coinBonus = 1.1; G.slowmo = 0.45;
      Sfx.perfect();
      const pop = document.createElement('div'); pop.className = 'perfect-pop'; pop.textContent = 'Perfekt!';
      document.body.appendChild(pop); setTimeout(() => pop.remove(), 1200);
    }
    for (let i = 0; i < 18; i++) World.fx.norm({ x: pose.tx, y: CATAPULT_Y + pose.ty, z: rand(-2, 2), vx: rand(-8, 4), vy: rand(-2, 6), vz: rand(-8, 8), life: rand(0.5, 1.1), size: rand(1.5, 3), grow: 2, drag: 2, c: [0.85, 0.8, 0.7], a: 0.55 });
    showScreen('flight');
  }
  function fireTurbo() {
    const r = G.rocket;
    if (!r || G.state !== 'flight' || G.paused || r.turbo <= 0 || r.turboT > 0) return;
    r.turbo--; r.turboT = PHYS.TURBO_TIME; G.run.turbos++;
    const sp = Math.hypot(r.vx, r.vy);
    r.vx += Math.cos(r.a) * (120 + sp * 0.12); r.vy += Math.sin(r.a) * (120 + sp * 0.12);
    G.flash = 0.35; G.flashRgb = [255, 170, 80]; G.shake = Math.max(G.shake, 7);
    Sfx.turbo();
    shockRing(r.x, r.y, 0xffc070);
  }
  function groundU(xu) { return Math.max(0, World.surfaceAt(xu * S, 0)) / S; }
  function updateFlight(dt) {
    const r = G.rocket, run = G.run;
    const inp = { boost: boostHeld(), turn: steerInput(), target: null };
    if (r.spin) { r.a += r.spin * dt; r.spin *= Math.pow(0.03, dt); if (Math.abs(r.spin) < 0.08) r.spin = 0; }
    r.px = r.x; r.py = r.y;
    const f0 = r.fuel;
    stepRocket(r, stats, inp, dt);
    run.fuelUsed += f0 - r.fuel;
    run.time += dt;
    r.invuln = Math.max(0, r.invuln - dt);
    if (inp.boost && r.fuel > 0) G.tipT = Math.min(G.tipT, 0.5);
    const sp = Math.hypot(r.vx, r.vy);
    const Hh = Math.max(0, r.y);
    const A = altitudeAt(Hh);
    const vDisp = sp * speedScaleAt(Hh);
    if (Hh > run.maxH) { run.maxH = Hh; run.maxA = A; }
    if (vDisp > run.maxV) run.maxV = vDisp;
    if (!run.machDone && vDisp >= 343 && A < 60000 && airDensity(Hh) > 0.02) {
      run.machDone = true;
      shockRing(r.x, r.y, 0xffffff, 2.2);
      G.shake = Math.max(G.shake, 9); Sfx.boom();
      toast('Schallmauer durchbrochen!', 'Mach 1');
    }
    const zi = zoneIndexAt(Hh);
    if (zi > G.lastZone) {
      G.lastZone = zi;
      if (zi > save.bestZone) { save.bestZone = zi; showBanner('Neue Zone entdeckt', ZONES[zi].name, ZONES[zi].desc); Sfx.zone(); }
      else if (zi >= 2) showBanner(fmtAlt(ZONES[zi].A), ZONES[zi].name, '');
    }
    if (Hh >= GOAL_H) { endFlight('win'); return; }
    // ground and water
    const gu = groundU(r.x);
    if (r.y <= gu) {
      const water = World.surfaceAt(r.x * S, 0) < 0;
      if (!water && r.bounces > 0 && -r.vy > 150) {
        r.y = gu; r.vy = -r.vy * 0.62; r.vx *= 0.88; r.bounces--; run.bounces++;
        Sfx.bounce(); G.shake = Math.max(G.shake, 6);
        puff(r.x, gu, 16, [0.75, 0.66, 0.5]);
        addText(r.x, r.y + 60, 'Abgeprallt!', '#9ff3ff');
      } else { r.y = gu; endFlight(water ? 'splash' : sp > 700 || -r.vy > 450 ? 'crash' : 'land'); return; }
    }
    collide(r, dt);
    if (r.fuel <= 0 && r.turboT <= 0 && r.vy < 0) {
      G.descendT += dt;
      // only skip the long fall when nothing can happen any more (no turbo, no bounce left)
      if (G.descendT > 6 && r.turbo <= 0 && r.bounces <= 0 && Hh > ZH.wolken) { endFlight('skip'); return; }
    } else G.descendT = 0;
    if (run.time > 600) endFlight('skip');
  }
  function endFlight(reason) {
    if (G.state !== 'flight') return;
    const r = G.rocket;
    G.state = 'ending'; G.endReason = reason;
    G.endTimer = reason === 'skip' || reason === 'abort' ? 0.35 : reason === 'win' ? 2.2 : 1.6;
    Sfx.thrust(0, false);
    $('btnSkip').hidden = true;
    const x = r.x * S, y = r.y * S;
    if (reason === 'crash') {
      G.crashed = true; G.shake = 16; G.flash = 0.5; G.flashRgb = [255, 170, 80];
      Sfx.crash();
      for (let i = 0; i < 70; i++) World.fx.add({ x, y: y + 1, z: rand(-1, 1), vx: rand(-14, 14), vy: rand(2, 22), vz: rand(-14, 14), life: rand(0.5, 1.3), size: rand(2, 5), grav: 9, drag: 1.5, c: [1, 0.86, 0.45], c2: [1, 0.42, 0.12] });
      for (let i = 0; i < 40; i++) World.fx.norm({ x, y: y + 1, z: rand(-2, 2), vx: rand(-6, 6), vy: rand(2, 9), vz: rand(-6, 6), life: rand(1.5, 3), size: rand(4, 8), grow: 2.5, drag: 1.2, c: [0.35, 0.33, 0.33], a: 0.7 });
    } else if (reason === 'splash') {
      G.crashed = true; G.splash = true; G.shake = 8; Sfx.land();
      for (let i = 0; i < 60; i++) World.fx.norm({ x, y: 0.3, z: rand(-1, 1), vx: rand(-7, 7), vy: rand(6, 20), vz: rand(-7, 7), life: rand(0.8, 1.5), size: rand(1, 2.5), grav: 22, drag: 0.5, c: [0.85, 0.95, 1], a: 0.85 });
    } else if (reason === 'land') {
      Sfx.land(); G.shake = 6;
      r.vx = 0; r.vy = 0; r.a = 0.05;
      puff(r.x, r.y, 24, [0.72, 0.64, 0.48]);
    } else if (reason === 'win') {
      Sfx.win(); G.flash = 0.8; G.flashRgb = [220, 190, 255];
      for (let i = 0; i < 80; i++) World.fx.add({ x, y, z: rand(-1, 1), vx: rand(-30, 30), vy: rand(-30, 30), vz: rand(-30, 30), life: rand(0.6, 1.4), size: rand(1.5, 3.5), drag: 1, c: pick([[1, 0.86, 0.47], [0.75, 0.6, 1], [0.47, 0.9, 1]]) });
    }
  }
  function finishRun() {
    const run = G.run, reason = G.endReason, s = save.stats;
    const heightBonus = Math.round(coinValueAt(run.maxH) * HEIGHT_BONUS * stats.coinMult * run.coinBonus);
    const isRecord = run.maxH > s.bestH + 1;
    const recordBonus = isRecord && s.flights > 0 ? Math.round(heightBonus * 0.5) : 0;
    const winBonus = reason === 'win' ? Math.round(coinValueAt(GOAL_H) * 400 * stats.coinMult) : 0;
    const collected = run.coins;   // the perfect-launch bonus is already applied at each pickup
    const total = collected + heightBonus + recordBonus + winBonus;
    save.coins += total;
    s.flights++; s.earned += total; s.coinsPicked += run.coinCount; s.gems += run.gems; s.rings += run.rings; s.cans += run.cans;
    s.balloons += run.balloons; s.shieldHits += run.shieldHits; s.turbos += run.turbos; s.hits += run.hits;
    s.bestH = Math.max(s.bestH, run.maxH); s.bestA = Math.max(s.bestA, run.maxA); s.bestV = Math.max(s.bestV, run.maxV);
    s.bestRunCoins = Math.max(s.bestRunCoins, run.coins); s.bestRunRings = Math.max(s.bestRunRings, run.rings);
    s.bestRunBounces = Math.max(s.bestRunBounces, run.bounces);
    if (run.fuelUsed < 0.001 && run.turbos === 0) s.bestNoBoost = Math.max(s.bestNoBoost, run.maxA);
    const firstWin = reason === 'win' && !save.won;
    if (reason === 'win') save.won = true;
    checkMissions(false);
    persist();
    showResults({ run, reason, heightBonus, recordBonus, winBonus, collected, total, isRecord, newly: run.done, firstWin });
  }

  // ================= objects =================
  const coinGeo = new T.CylinderGeometry(1, 1, 0.24, 28).rotateZ(Math.PI / 2);
  Models.shared();
  class InstPool {
    constructor(geo, mat, max) {
      this.max = max; this.items = [];
      this.mesh = new T.InstancedMesh(geo, mat, max);
      this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true;
      scene.add(this.mesh);
    }
    add(o) { if (this.items.length >= this.max) return false; o.slot = this.items.length; this.items.push(o); return true; }
    remove(o) { const last = this.items.pop(); if (last !== o) { this.items[o.slot] = last; last.slot = o.slot; } }
    clear() { this.items.length = 0; this.mesh.count = 0; }
    sync(t) {
      const m = _m4, q = _q, p = _p, s = _s;
      for (let i = 0; i < this.items.length; i++) {
        const o = this.items[i];
        _e.set(0, t * 2.6 + o.ph, 0); q.setFromEuler(_e);
        p.set(o.x * S, o.y * S, o.z); s.setScalar(o.r * S);
        m.compose(p, q, s); this.mesh.setMatrixAt(i, m);
      }
      this.mesh.count = this.items.length;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  const _m4 = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _e = new T.Euler(), _v = new T.Vector3();
  const coinPools = Models.shared().coinMats.map(mat => new InstPool(coinGeo, mat, 360));
  const PROTO = {};
  function proto(key) {
    if (PROTO[key]) return PROTO[key];
    const make = {
      gem: () => Models.gem(), fuel: () => Models.fuelCan(false), cell: () => Models.fuelCan(true), ring: () => Models.boostRing(),
      bird: () => Models.bird(), party: () => Models.partyBalloons(), weather: () => Models.weatherBalloon(), ufo: () => Models.ufo(),
      drone: () => Models.drone(), zeppelin: () => Models.zeppelin(), ice: () => Models.rock('ice', 3), rock: () => Models.rock('rock', 4),
      asteroid: () => Models.rock('asteroid', 6), meteor: () => Models.meteor(false), comet: () => Models.meteor(true),
      satellite: () => Models.satellite(false), bigsat: () => Models.satellite(true), debris: () => Models.debris(), plasma: () => Models.plasma(),
    }[key];
    return (PROTO[key] = make());
  }
  function parts(mesh) {
    const p = { wings: [], rotors: [], lights: [] };
    mesh.traverse(o => {
      if (o.name === 'wing') p.wings.push(o);
      else if (o.name === 'rotor') p.rotors.push(o);
      else if (o.name === 'light') p.lights.push(o);
      else if (o.name) p[o.name] = o;
    });
    return p;
  }
  function addObj(o) {
    if (G.objs.length > 260) return null;
    o.ph = o.ph == null ? Math.random() * 6 : o.ph;
    if (o.k === 'coin') { if (!coinPools[o.tier].add(o)) return null; }
    else {
      const key = o.k === 'gem' ? 'gem' : o.k === 'fuel' ? (o.space ? 'cell' : 'fuel') : o.k === 'ring' ? 'ring' : o.type;
      o.mesh = proto(key).clone();
      o.parts = parts(o.mesh);
      // the chevrons of a ring fade on their own, so each ring needs its own material
      if (o.parts.chev) { o.parts.chev.material = o.parts.chev.material.clone(); o.ownMat = o.parts.chev.material; }
      o.mesh.scale.setScalar(o.scale || 1);
      o.mesh.position.set(o.x * S, o.y * S, o.z || 0);
      scene.add(o.mesh);
    }
    G.objs.push(o);
    return o;
  }
  function removeObj(o) {
    if (o.k === 'coin') coinPools[o.tier].remove(o);
    else if (o.mesh) scene.remove(o.mesh);
    if (o.ownMat) o.ownMat.dispose();
  }
  function clearObjects() {
    for (const o of G.objs) { if (o.mesh) scene.remove(o.mesh); if (o.ownMat) o.ownMat.dispose(); }
    G.objs.length = 0;
    coinPools.forEach(p => p.clear());
  }

  // ================= spawning =================
  const ZONE_SPAWN = {
    wiese:   { obst: ['bird'], every: 2600, friend: ['party'], fEvery: 3000, amb: ['bird', 'party'] },
    voegel:  { obst: ['flock', 'bird'], every: 1300, friend: ['party'], fEvery: 2400, amb: ['bird', 'flock', 'party'] },
    wolken:  { obst: ['flock', 'drone'], every: 1300, friend: ['party'], fEvery: 2100, amb: ['flock', 'party', 'drone'] },
    jet:     { obst: ['drone', 'zeppelin', 'drone'], every: 1200, friend: ['party'], fEvery: 2400, amb: ['zeppelin', 'drone'] },
    strato:  { obst: ['ice', 'zeppelin'], every: 1200, friend: ['weather'], fEvery: 2000, amb: ['weather', 'zeppelin'] },
    meso:    { obst: ['meteor', 'ice', 'meteor'], every: 1050, friend: ['weather'], fEvery: 2600, amb: ['meteor', 'weather'] },
    space:   { obst: ['satellite', 'debris'], every: 1000, friend: [], fEvery: 0, amb: ['satellite', 'debris'] },
    orbit:   { obst: ['satellite', 'debris', 'debris'], every: 900, friend: [], fEvery: 0, amb: ['satellite', 'bigsat'] },
    geo:     { obst: ['bigsat', 'satellite', 'debris'], every: 950, friend: [], fEvery: 0, amb: ['bigsat', 'satellite'] },
    moon:    { obst: ['asteroid', 'debris'], every: 850, friend: ['ufo'], fEvery: 5000, amb: ['asteroid', 'ufo'] },
    mars:    { obst: ['asteroid', 'asteroid', 'debris'], every: 800, friend: ['ufo'], fEvery: 4200, amb: ['asteroid'] },
    belt:    { obst: ['asteroid', 'asteroid', 'rock'], every: 520, friend: ['ufo'], fEvery: 5200, amb: ['asteroid', 'rock', 'asteroid'] },
    jupiter: { obst: ['comet', 'asteroid'], every: 720, friend: ['ufo'], fEvery: 4600, amb: ['comet', 'asteroid'] },
    saturn:  { obst: ['ice', 'ice', 'comet'], every: 650, friend: ['ufo'], fEvery: 5000, amb: ['ice', 'comet'] },
    edge:    { obst: ['plasma'], every: 600, friend: [], fEvery: 0, amb: ['plasma'] },
  };
  const OBST_R = { bird: 16, drone: 24, zeppelin: 60, ice: 22, meteor: 24, satellite: 34, bigsat: 44, debris: 15, asteroid: 30, rock: 16, comet: 26, plasma: 24 };
  const OBST_SCALE = { bird: 1, drone: 1, zeppelin: 1, ice: 2.2, meteor: 2.3, satellite: 1, bigsat: 1.1, debris: 1, asteroid: 3, rock: 1.6, comet: 2.4, plasma: 1.2 };
  const FRIEND_R = { party: 28, weather: 34, ufo: 40 };
  function speedScale(sp) { return clamp(Math.sqrt(sp / 650), 1, 3.4); }
  function aheadPoint(r, dir, sp, extra) {
    const ahead = Math.max(350, 250 + sp * 1.1) + rand(0, 300) + (extra || 0);
    const side = rand(-1, 1) * (180 + sp * 0.25);
    let x = r.x + dir.x * ahead - dir.y * side, y = r.y + dir.y * ahead + dir.x * side;
    if (x < r.x + 200) x = r.x + 200 + rand(0, 200);
    return { x, y };
  }
  function rollTier() {
    const q = Math.random(), L = stats.luck;
    if (q < 0.035 + 0.012 * L) return 2;
    if (q < 0.24 + 0.02 * L) return 1;
    return 0;
  }
  function spawnCoins(p, k) {
    if (p.y < groundU(p.x) + 40) return;
    const sp = 34 * k, tier = rollTier(), pts = [], pat = Math.random(), ang = rand(-0.9, 1.2);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    if (pat < 0.3) { const n = 5 + ((Math.random() * 4) | 0); for (let i = 0; i < n; i++) pts.push([ux * sp * (i - n / 2), uy * sp * (i - n / 2)]); }
    else if (pat < 0.5) { const n = 7, R = sp * 3; for (let i = 0; i < n; i++) { const a = ang + (i / (n - 1) - 0.5) * 2.2; pts.push([Math.cos(a) * R, Math.sin(a) * R - R]); } }
    else if (pat < 0.66) { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (Math.abs(i) + Math.abs(j) < 2 || Math.random() < 0.6) pts.push([i * sp, j * sp]); }
    else if (pat < 0.82) { const n = 9; for (let i = 0; i < n; i++) { const o = Math.sin(i * 0.9) * sp; pts.push([ux * sp * (i - n / 2) - uy * o, uy * sp * (i - n / 2) + ux * o]); } }
    else if (pat < 0.93) { const n = 8, R = sp * 2.3; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push([Math.cos(a) * R, Math.sin(a) * R]); } }
    else { addObj({ k: 'coin', tier: 2, x: p.x, y: p.y, z: 0, r: 15 * k }); return; }
    const rr = (tier === 2 ? 15 : tier === 1 ? 13.5 : 12) * k;
    for (const [dx, dy] of pts) addObj({ k: 'coin', tier, x: p.x + dx, y: p.y + dy, z: 0, r: rr });
    if (Math.random() < 0.02 + 0.009 * stats.luck) addObj({ k: 'gem', x: p.x, y: p.y, z: 0, r: 16 * k, scale: k });
  }
  function spawnObstacle(p, zid, k) {
    const zs = ZONE_SPAWN[zid];
    if (!zs || p.y < groundU(p.x) + 120) return;
    const type = pick(zs.obst);
    const dirX = Math.random() < 0.6 ? -1 : 1;
    if (type === 'flock') {
      const n = 3 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) addObj({ k: 'obs', type: 'bird', x: p.x - dirX * i * 28 * k, y: p.y + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 20 * k, z: rand(-1, 1), r: OBST_R.bird * k, scale: k, vx: dirX * 140, vy: 0, dir: dirX });
      return;
    }
    const o = { k: 'obs', type, x: p.x, y: p.y, z: rand(-1.5, 1.5), r: OBST_R[type] * k, scale: k * (OBST_SCALE[type] || 1), vx: 0, vy: 0, dir: dirX, vr: rand(-1, 1) };
    if (type === 'bird') o.vx = dirX * 130;
    if (type === 'drone') o.vx = dirX * 70;
    if (type === 'zeppelin') o.vx = dirX * 40;
    if (type === 'meteor' || type === 'comet') { const a = rand(-2.6, -1.2); o.vx = Math.cos(a) * 420; o.vy = Math.sin(a) * 420; }
    if (type === 'asteroid' || type === 'rock' || type === 'ice') { o.vx = rand(-60, 60); o.vy = rand(-60, 60); o.vr = rand(-1.4, 1.4); }
    addObj(o);
  }
  function spawnFriend(p, zid, k) {
    const zs = ZONE_SPAWN[zid];
    if (!zs || !zs.friend.length || p.y < groundU(p.x) + 150) return;
    const type = pick(zs.friend);
    addObj({ k: 'friend', type, x: p.x, y: p.y, z: 0, r: FRIEND_R[type] * k, scale: k * (type === 'ufo' ? 1.3 : 1.4), vx: 0, vy: type === 'ufo' ? 0 : 20 });
  }
  function spawnAmbient(r, zid, k) {
    const zs = ZONE_SPAWN[zid];
    if (!zs) return;
    const type = pick(zs.amb);
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = r.x + 1800 + Math.random() * 2600 + Math.hypot(r.vx, r.vy) * 1.5, y = r.y + rand(-300, 900);
    if (y < groundU(x) + 100) return;
    const z = side * rand(30, 160);
    if (type === 'flock') {
      for (let i = 0; i < 5; i++) addObj({ k: 'amb', type: 'bird', x: x - i * 30, y: y + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 22, z: z + i * 3, r: 0, scale: k * 1.2, vx: -side * 60, vy: 0, dir: -1 });
      return;
    }
    addObj({ k: 'amb', type, x, y, z, r: 0, scale: k * (OBST_SCALE[type] || 1) * 1.5, vx: type === 'bird' ? -80 : rand(-30, 30), vy: type === 'party' || type === 'weather' ? 15 : rand(-20, 20), dir: -1, vr: rand(-0.6, 0.6) });
  }
  function spawnRing(p, dir, k) { if (p.y < groundU(p.x) + 160) return; addObj({ k: 'ring', x: p.x, y: p.y, z: 0, r: 46 * k, scale: k, a: Math.atan2(dir.y, dir.x) + rand(-0.35, 0.35), used: false, t: 0 }); }
  function spawnFuel(p, k) { if (p.y < groundU(p.x) + 80) return; addObj({ k: 'fuel', x: p.x, y: p.y, z: 0, r: 22 * k, scale: k, space: p.y > ZH.space * 0.9 }); }
  // the path the rocket takes from its current state, with or without boosting and without steering
  function simulateArc(r0, boost, secs) {
    const r = { ...r0 }, pts = [], dt = 1 / 30;
    for (let t = 0; t < secs; t += dt) {
      stepRocket(r, stats, { boost, turn: 0, target: null }, dt);
      pts.push({ x: r.x, y: r.y, vx: r.vx, vy: r.vy });
      if (r.y < groundU(r.x)) break;
    }
    return pts;
  }
  function alongPath(path, start, every, fn) {
    let d = 0, next = start;
    for (let i = 1; i < path.length; i++) {
      d += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (d >= next) { next += every * rand(0.8, 1.2); fn(path[i]); }
    }
  }
  function populateInitial() {
    const r = G.rocket;
    // first coins sit on the arcs the rocket can actually reach: a pure throw and a full burn
    const coast = simulateArc(r, false, 9), burn = simulateArc(r, true, 9);
    alongPath(coast, 350, 420, p => spawnCoins({ x: p.x + rand(-40, 40), y: p.y + rand(-40, 40) }, 1));
    if (r.fuel > 0) alongPath(burn, 700, 650, p => spawnCoins({ x: p.x + rand(-60, 60), y: p.y + rand(-60, 60) }, 1));
    const apex = coast.reduce((a, p) => (p.y > a.y ? p : a), coast[0] || r);
    spawnFuel({ x: apex.x + rand(-40, 80), y: apex.y + rand(20, 80) }, 1);
    const mid = burn[Math.floor(burn.length * 0.45)] || apex, sp = Math.max(1, Math.hypot(mid.vx || 1, mid.vy || 0));
    spawnRing({ x: mid.x, y: mid.y }, { x: (mid.vx || 1) / sp, y: (mid.vy || 0) / sp }, 1);
    for (let i = 0; i < 4; i++) spawnAmbient({ x: r.x - 1500 + i * 600, y: r.y, vx: 0, vy: 0 }, ZONES[0].id, 1);
  }
  function spawnTick() {
    const r = G.rocket;
    const d = Math.hypot(r.x - G.spawnLast.x, r.y - G.spawnLast.y);
    if (d < 4) return;
    G.spawnLast.x = r.x; G.spawnLast.y = r.y;
    const sp = Math.max(1, Math.hypot(r.vx, r.vy)), dir = { x: r.vx / sp, y: r.vy / sp };
    const k = speedScale(sp);
    const zid = ZONES[zoneIndexAt(Math.max(0, r.y))].id, zs = ZONE_SPAWN[zid];
    const A = G.acc;
    A.coin += d; A.fuel += d; A.ring += d; A.obst += d; A.friend += d; A.amb += d;
    let guard = 0;
    const coinEvery = 230 + sp * 0.13;
    while (A.coin > coinEvery && guard++ < 6) { A.coin -= coinEvery * rand(0.6, 1.4); spawnCoins(aheadPoint(r, dir, sp), k); }
    const fuelEvery = (3400 + sp * 0.9) / stats.canRate;
    if (A.fuel > fuelEvery) { A.fuel -= fuelEvery * rand(0.7, 1.3); spawnFuel(aheadPoint(r, dir, sp), k); }
    const ringEvery = 2200 + sp * 0.7;
    if (A.ring > ringEvery) { A.ring -= ringEvery * rand(0.7, 1.3); spawnRing(aheadPoint(r, dir, sp), dir, k); }
    if (zs) {
      const oe = zs.every * 1.5 + sp * 0.35;
      if (A.obst > oe) { A.obst -= oe * rand(0.6, 1.4); spawnObstacle(aheadPoint(r, dir, sp), zid, k); }
      if (zs.fEvery) { const fe = zs.fEvery * 1.5 + sp * 0.5; if (A.friend > fe) { A.friend -= fe * rand(0.7, 1.3); spawnFriend(aheadPoint(r, dir, sp), zid, k); } }
      const ae = 1300 + sp * 0.6;
      if (A.amb > ae) { A.amb -= ae * rand(0.6, 1.4); spawnAmbient(r, zid, k); }
    }
  }

  // ================= collisions =================
  function segDist2(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    const t = l2 > 0 ? clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1) : 0;
    const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
    return dx * dx + dy * dy;
  }
  function collide(r, dt) {
    const Hh = Math.max(0, r.y);
    const magR = stats.magnet * speedScale(Math.hypot(r.vx, r.vy));
    for (const o of G.objs) {
      if (o.dead || o.k === 'amb') continue;
      if ((o.k === 'coin' || o.k === 'gem') && magR > 0) {
        const dx = r.x - o.x, dy = r.y - o.y;
        if (o.mag || dx * dx + dy * dy < (magR + o.r + RR) ** 2) {
          o.mag = true;
          const f = Math.min(1, dt * 14);
          o.x += (r.x - r.px) + dx * f; o.y += (r.y - r.py) + dy * f;
        }
      }
      const d2 = segDist2(o.x, o.y, r.px, r.py, r.x, r.y);
      if (o.k === 'ring') { if (!o.used && d2 < o.r * o.r * 0.9) hitRing(r, o); continue; }
      const rr = o.r + RR;
      if (d2 > rr * rr) continue;
      if (o.k === 'coin' || o.k === 'gem') pickCoin(o, Hh);
      else if (o.k === 'fuel') pickFuel(r, o);
      else if (o.k === 'friend') hitFriend(r, o);
      else if (o.k === 'obs') hitObstacle(r, o);
    }
  }
  function sparks(o, n, c, speed) {
    const x = o.x * S, y = o.y * S, z = o.z || 0;
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, b = Math.random() * TAU, s = rand(0.3, 1) * speed; World.fx.add({ x, y, z, vx: Math.cos(a) * Math.cos(b) * s, vy: Math.sin(b) * s, vz: Math.sin(a) * Math.cos(b) * s, life: rand(0.35, 0.8), size: rand(0.6, 1.6), drag: 2, c }); }
  }
  function puff(xu, yu, n, c) {
    for (let i = 0; i < n; i++) World.fx.norm({ x: xu * S, y: yu * S + 0.5, z: rand(-2, 2), vx: rand(-9, 9), vy: rand(1, 8), vz: rand(-9, 9), life: rand(0.6, 1.3), size: rand(2, 4), grow: 2, drag: 2, c, a: 0.6 });
  }
  function shockRing(xu, yu, color, scale) {
    const m = new T.Mesh(new T.TorusGeometry(1, 0.08, 6, 48), Models.additive(color, 0.9));
    m.position.set(xu * S, yu * S, 0); m.rotation.y = Math.PI / 2;
    scene.add(m);
    G.texts.push({ ring: m, life: 0.6, max: 0.6, scale: scale || 1.4 });
  }
  function pickCoin(o, Hh) {
    o.dead = true;
    const base = o.k === 'gem' ? 100 : [1, 5, 20][o.tier];
    const val = Math.max(1, Math.round(base * coinValueAt(Hh) * stats.coinMult * G.run.coinBonus));
    G.run.coins += val;
    if (o.k === 'coin') G.run.coinCount++;
    if (o.k === 'gem') { G.run.gems++; Sfx.gem(); sparks(o, 16, [0.95, 0.6, 1], 22); addText(o.x, o.y, '+' + fmtNum(val), '#f3c9ff', true); }
    else {
      G.combo = G.comboT > 0 ? G.combo + 1 : 0; G.comboT = 0.45;
      Sfx.coin(G.combo);
      sparks(o, o.tier === 2 ? 10 : 5, o.tier === 1 ? [0.85, 0.92, 1] : [1, 0.84, 0.35], 14);
      if (o.tier === 2 || val >= 1000) addText(o.x, o.y, '+' + fmtNum(val), '#ffe28a', o.tier === 2);
    }
  }
  function pickFuel(r, o) {
    o.dead = true;
    r.fuel = Math.min(r.fuelMax, r.fuel + r.fuelMax * stats.canAmt);
    G.run.cans++; G.descendT = 0;
    Sfx.fuel(); sparks(o, 14, [0.35, 0.9, 1], 18);
    addText(o.x, o.y, '+Treibstoff', '#9ff3ff');
  }
  function hitRing(r, o) {
    o.used = true; o.t = 0;
    const sp = Math.max(1, Math.hypot(r.vx, r.vy)), add = sp * 0.16 + 260;
    r.vx += r.vx / sp * add; r.vy += r.vy / sp * add;
    r.fuel = Math.min(r.fuelMax, r.fuel + r.fuelMax * 0.06);
    G.run.rings++;
    G.flash = 0.25; G.flashRgb = [90, 230, 255];
    Sfx.ring(); addText(o.x, o.y, 'Boost!', '#9ff3ff', true);
  }
  function hitFriend(r, o) {
    o.dead = true;
    const sp = Math.hypot(r.vx, r.vy), Hh = Math.max(0, r.y);
    if (o.type === 'ufo') {
      r.vy += Math.max(700, sp * 0.4);
      const val = Math.round(60 * coinValueAt(Hh) * stats.coinMult * G.run.coinBonus);
      G.run.coins += val;
      addText(o.x, o.y, 'Traktorstrahl! +' + fmtNum(val), '#a8ffcf', true);
      Sfx.gem(); sparks(o, 24, [0.55, 1, 0.75], 26);
      G.flash = 0.3; G.flashRgb = [140, 255, 190];
      return;
    }
    r.vy += Math.max(o.type === 'weather' ? 380 : 260, sp * (o.type === 'weather' ? 0.26 : 0.2));
    const val = Math.round((o.type === 'weather' ? 12 : 6) * coinValueAt(Hh) * stats.coinMult * G.run.coinBonus);
    G.run.coins += val; G.run.balloons++;
    Sfx.pop(); addText(o.x, o.y, 'Plopp! +' + fmtNum(val), '#ffd1e8');
    for (const c of (o.type === 'weather' ? [[1, 1, 1]] : [[1, 0.35, 0.43], [1, 0.82, 0.3], [0.35, 0.66, 1]])) sparks(o, 8, c, 18);
  }
  function hitObstacle(r, o) {
    if (r.invuln > 0) return;
    o.dead = true;
    sparks(o, 14, [0.8, 0.8, 0.85], 20);
    if (r.armor > 0) {
      r.armor--; G.run.shieldHits++; r.invuln = 0.35;
      Sfx.shield(); G.flash = 0.3; G.flashRgb = [120, 230, 255];
      shockRing(r.x, r.y, 0x78e6ff);
      addText(r.x, r.y, 'Abgewehrt!', '#9ff3ff');
      return;
    }
    G.run.hits++; r.invuln = 0.6;
    r.vx *= 0.55; r.vy *= r.vy > 0 ? 0.5 : 0.8;
    r.spin = (Math.random() < 0.5 ? -1 : 1) * rand(3, 5);
    G.shake = Math.max(G.shake, 12); G.flash = 0.25; G.flashRgb = [255, 90, 90];
    Sfx.hit(); addText(r.x, r.y, 'Rumms!', '#ff9aa4', true);
  }

  // ================= per-frame object & effects update =================
  function updateObjects(dt) {
    const t = G.t, camX = camera.position.x, r = G.rocket;
    const sp = r ? Math.max(1, Math.hypot(r.vx, r.vy)) : 1, ux = r ? r.vx / sp : 1, uy = r ? r.vy / sp : 0;
    for (const o of G.objs) {
      if (o.vx) o.x += o.vx * dt;
      if (o.vy) o.y += o.vy * dt;
      if (o.dead) continue;
      if (o.k === 'ring' && o.used) { o.t += dt; if (o.t > 0.6) o.dead = true; }
      if (o.x * S < camX - 80 || Math.abs(o.y * S - camera.position.y) > 1800) o.dead = true;
      else if (r && (o.x - r.x) * ux + (o.y - r.y) * uy < -2500) o.dead = true;
      const m = o.mesh;
      if (!m) continue;
      m.position.set(o.x * S, o.y * S, o.z || 0);
      const P = o.parts;
      switch (o.k === 'ring' ? 'ring' : o.k === 'gem' ? 'gem' : o.k === 'fuel' ? 'fuel' : o.type) {
        case 'ring': {
          m.rotation.z = o.a;
          const u = o.used ? o.t / 0.6 : 0;
          m.scale.setScalar(o.scale * (1 + u * 1.2));
          if (P.chev) P.chev.material.opacity = o.used ? Math.max(0, 0.8 - u) : 0.55 + 0.3 * Math.sin(t * 8);
          break;
        }
        case 'gem': if (P.spin) P.spin.rotation.y = t * 2 + o.ph; break;
        case 'fuel': m.rotation.y = Math.sin(t * 2 + o.ph) * 0.6; m.position.y += Math.sin(t * 3 + o.ph) * 0.3; break;
        case 'bird': m.rotation.y = o.vx >= 0 ? 0 : Math.PI; for (const w of P.wings) w.rotation.x = Math.sin(t * 14 + o.ph) * 0.7 * (w === P.wings[0] ? 1 : -1); break;
        case 'drone': for (const rr of P.rotors) rr.rotation.y += dt * 40; m.rotation.z = Math.sin(t * 2 + o.ph) * 0.1; if (P.led) P.led.visible = Math.sin(t * 8) > 0; break;
        case 'zeppelin': m.rotation.y = o.vx >= 0 ? 0 : Math.PI; break;
        case 'meteor': case 'comet': m.rotation.z = Math.atan2(o.vy, o.vx); if (P.spin) P.spin.rotation.x += dt * 2; break;
        case 'ufo': m.position.y += Math.sin(t * 2 + o.ph) * 0.4; m.rotation.y += dt; P.lights.forEach((l, i) => { l.visible = ((t * 6 + i) | 0) % 3 === 0; }); break;
        case 'party': case 'weather': m.rotation.y = Math.sin(t + o.ph) * 0.3; break;
        default: if (o.vr) { m.rotation.x += o.vr * dt; m.rotation.y += o.vr * 0.7 * dt; }
      }
    }
    for (let i = G.objs.length - 1; i >= 0; i--) {
      const o = G.objs[i];
      if (o.dead) { removeObj(o); G.objs[i] = G.objs[G.objs.length - 1]; G.objs.pop(); }
    }
    coinPools.forEach(p => p.sync(t));
    // shock rings and floating texts
    for (let i = G.texts.length - 1; i >= 0; i--) {
      const x = G.texts[i];
      x.life -= dt;
      if (x.ring) {
        const k = 1 - x.life / x.max;
        x.ring.scale.setScalar(2 + k * 18 * x.scale);
        x.ring.material.opacity = Math.max(0, 0.9 * (1 - k));
        if (x.life <= 0) { scene.remove(x.ring); x.ring.geometry.dispose(); x.ring.material.dispose(); }
      } else x.dy += 60 * dt;
      if (x.life <= 0) G.texts.splice(i, 1);
    }
  }
  function addText(xu, yu, text, col, big) { if (G.texts.length < 40) G.texts.push({ x: xu, y: yu, text, col, big: !!big, life: 1.1, max: 1.1, dy: 0 }); }
  // the particle shader writes colours as they are, so take the sRGB bytes without linearising them
  const hexRgb = h => ({ r: ((h >> 16) & 255) / 255, g: ((h >> 8) & 255) / 255, b: (h & 255) / 255 });
  let exhaustCache = { id: '', c1: null, c2: null };
  function exhaustColors() {
    if (exhaustCache.id !== save.rocket) {
      const cols = Models.FLAME_COLORS[(ROCKET_BY_ID[save.rocket] || ROCKETS[0]).look.flame] || Models.FLAME_COLORS.warm;
      exhaustCache = { id: save.rocket, c1: hexRgb(cols[1]), c2: hexRgb(cols[2]) };
    }
    return exhaustCache;
  }
  function updateRocketVisual(dt) {
    if (!rocketMesh) return;
    const st = G.state;
    if (st === 'menu' || st === 'charge' || st === 'title') {
      const p = padPose();
      rocketMesh.visible = true;
      rocketMesh.position.set(p.cx, p.cy, 0);
      rocketMesh.rotation.z = p.a; rocketMesh.rotation.x = 0;
      rocketMesh.userData.setThrust(0, G.t);
      catapult.userData.setPouch(p.tx, p.ty, p.a);
      return;
    }
    // band snaps back after the launch
    const wob = Math.max(0, 1 - (G.run ? G.run.time : 9) * 1.4);
    catapult.userData.setPouch(Math.sin(G.t * 38) * 1.2 * wob, ANCHOR + 0.5, 0);
    const r = G.rocket;
    if (!r) return;
    rocketMesh.visible = !G.crashed;
    rocketMesh.position.set(r.x * S, r.y * S, 0);
    rocketMesh.rotation.z = r.a;
    G.roll += dt * (r.boosting || r.turboT > 0 ? 2.4 : 0.7);
    rocketMesh.rotation.x = st === 'ending' ? rocketMesh.rotation.x : G.roll;
    const level = st === 'flight' ? (r.turboT > 0 ? 1.6 : r.boosting ? 1 : 0) : 0;
    rocketMesh.userData.setThrust(level, G.t);
    if (st !== 'flight' || !level) return;
    // exhaust particles
    const L = rocketMesh.userData.length;
    const ca = Math.cos(r.a), sa = Math.sin(r.a);
    const nx = r.x * S - ca * L * 0.6, ny = r.y * S - sa * L * 0.6;
    const vx = r.vx * S, vy = r.vy * S, rho = airDensity(Math.max(0, r.y));
    const { c1, c2 } = exhaustColors();
    const n = level > 1 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const f = Math.random(), back = rand(18, 30);
      World.fx.add({ x: nx - vx * dt * f, y: ny - vy * dt * f, z: rand(-0.3, 0.3), vx: vx * 0.55 - ca * back + rand(-2, 2), vy: vy * 0.55 - sa * back + rand(-2, 2), vz: rand(-2, 2), life: rand(0.15, 0.3), size: rand(1.4, 2.4) * (level > 1 ? 1.3 : 1), drag: 3, c: [c1.r, c1.g, c1.b], c2: [c2.r, c2.g, c2.b] });
    }
    if (rho > 0.06 && Math.random() < 0.7) World.fx.norm({ x: nx, y: ny, z: rand(-0.4, 0.4), vx: vx * 0.08 - ca * 4, vy: vy * 0.08 - sa * 4, vz: rand(-0.8, 0.8), life: rand(1.4, 2.4), size: rand(1.6, 2.6), grow: 3, drag: 1, c: [0.93, 0.94, 0.97], a: 0.42 * Math.min(1, rho * 3), fadeIn: true });
    else if (rho <= 0.06 && Math.random() < 0.6) World.fx.add({ x: nx, y: ny, z: 0, vx: vx * 0.25, vy: vy * 0.25, vz: 0, life: rand(0.5, 0.9), size: rand(0.6, 1.1), drag: 1, c: [c1.r * 0.6, c1.g * 0.8, c1.b], a: 0.7 });
  }

  // ================= camera =================
  const cam = { pos: new T.Vector3(-46, 30, 52), look: new T.Vector3(4, 12, 0), fov: 52, pitch: 0.5, blend: 0 };
  const _cp = new T.Vector3(), _cl = new T.Vector3();
  function updateCamera(dt) {
    const st = G.state;
    let fov = 55;
    if (st === 'menu' || st === 'title') {
      const a = G.t * 0.06;
      const portrait = W < H;
      const short = !portrait && H < 520;   // landscape phone: the cards cover the lower half, so aim lower
      _cp.set(-44 + Math.sin(a) * 6, (portrait ? 40 : 24) + CATAPULT_Y, (portrait ? 58 : 44) + Math.cos(a) * 6);
      _cl.set(3, (portrait ? -6 : short ? -4 : 10) + CATAPULT_Y, 0);
      fov = portrait ? 66 : 52;
    } else if (st === 'charge') {
      _cp.set(-30, 6 + CATAPULT_Y, 20);
      _cl.set(6, 13 + CATAPULT_Y, 0);
      fov = W < H ? 72 : 55;
    } else if (G.rocket) {
      // chase camera behind the rocket: looks down at the land in level flight and tilts up on steep climbs,
      // so whatever lies ahead on the flight path stays in view
      const r = G.rocket, sp = Math.hypot(r.vx, r.vy) * S;
      const va = sp > 0.5 ? Math.atan2(r.vy, r.vx) : r.a;
      cam.pitch += (clamp(va, -0.6, 1.4) - cam.pitch) * Math.min(1, dt * 2.2);
      const lp = clamp(cam.pitch * 0.78 - 0.3, -0.55, 0.8);
      const cdx = Math.cos(lp), cdy = Math.sin(lp);
      const d = 20 + Math.min(40, sp * 0.06), h = 0.12 * d + 2.5;
      const rx = r.x * S, ry = r.y * S;
      _cp.set(rx - cdx * d, ry - cdy * d + h, d * 0.22);
      _cl.set(rx + cdx * 40, ry + cdy * 40 + h * 0.35, 0);
      fov = (W < H ? 76 : 62) + Math.min(14, sp * 0.028);
      if (st === 'ending') { _cp.set(rx - 26, ry + 12, 16); _cl.set(rx, ry, 0); }
    }
    // smooth only the transitions; in flight the camera rides with the rocket
    const k = st === 'flight' ? 1 - Math.exp(-dt * (G.run && G.run.time < 0.8 ? 4 : 14)) : 1 - Math.exp(-dt * 3);
    cam.pos.lerp(_cp, k); cam.look.lerp(_cl, k);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    const gy = Math.max(0, World.surfaceAt(cam.pos.x, cam.pos.z)) + 2;
    if (cam.pos.y < gy) cam.pos.y = gy;
    camera.position.copy(cam.pos);
    if (G.shake > 0 && !reduceMotion) {
      camera.position.x += (Math.random() * 2 - 1) * G.shake * 0.06;
      camera.position.y += (Math.random() * 2 - 1) * G.shake * 0.06;
      G.shake = Math.max(0, G.shake - dt * 30);
    } else G.shake = 0;
    camera.lookAt(cam.look);
    if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }

  // ================= HUD =================
  function setText(id, v) { if (G.hudCache[id] !== v) { G.hudCache[id] = v; $(id).textContent = v; } }
  function updateHUD() {
    const r = G.rocket, run = G.run;
    if (!r) return;
    const Hh = Math.max(0, r.y), zi = zoneIndexAt(Hh);
    const [av, au] = fmtAltParts(altitudeAt(Hh));
    setText('hAlt', av); setText('hAltU', au);
    setText('hZone', ZONES[zi].name);
    const next = ZONES[Math.min(zi + 1, ZONES.length - 1)];
    const p = zi >= ZONES.length - 1 ? 1 : clamp((Hh - ZONES[zi].H) / (next.H - ZONES[zi].H), 0, 1);
    setText('pFrom', ZONES[zi].name); setText('pTo', zi >= ZONES.length - 1 ? 'Ziel' : next.name);
    setText('pPct', deNum(p * 100, 1) + ' %');
    const pw = (p * 100).toFixed(1);
    if (G.hudCache.pw !== pw) { G.hudCache.pw = pw; $('pFill').style.width = `calc(${pw}% - 4px)`; $('pMark').style.left = pw + '%'; }
    const vms = Math.hypot(r.vx, r.vy) * speedScaleAt(Hh);
    const kmh = vms * 3.6;
    if (vms < 2800) { setText('hSpd', deNum(kmh)); setText('hSpdU', 'km/h'); }
    else { setText('hSpd', deNum(vms / 1000, vms < 100000 ? 1 : 0)); setText('hSpdU', 'km/s'); }
    setText('hMach', altitudeAt(Hh) < 80000 && vms > 170 ? 'Mach ' + deNum(vms / 343, 1) : '');
    const needle = clamp(Math.log10(1 + kmh) / 6.1, 0, 1);
    const ang = (-135 + 270 * needle).toFixed(1);
    if (G.hudCache.ang !== ang) { G.hudCache.ang = ang; $('gNeedle').setAttribute('transform', `rotate(${ang} 75 75)`); }
    setText('hCoins', fmtNum(run.coins));
    const f = r.fuel / r.fuelMax, fh = (f * 100).toFixed(1) + '%';
    if (G.hudCache.fh !== fh) { G.hudCache.fh = fh; $('hFuel').style.height = fh; }
    const low = f < 0.2;
    if (G.hudCache.low !== low) { G.hudCache.low = low; boostBtn.classList.toggle('low', low); }
    const on = r.boosting || r.turboT > 0;
    if (G.hudCache.on !== on) { G.hudCache.on = on; boostBtn.classList.toggle('on', on); }
    setText('hTurbo', String(r.turbo));
    const tOn = r.turbo > 0 && r.turboT <= 0;
    if (G.hudCache.tOn !== tOn) { G.hudCache.tOn = tOn; $('btnTurbo').disabled = !tOn; }
    const tHide = stats.turbo <= 0;
    if (G.hudCache.tHide !== tHide) { G.hudCache.tHide = tHide; $('btnTurbo').hidden = tHide; }
    if (G.hudCache.armor !== r.armor) { G.hudCache.armor = r.armor; $('hArmor').innerHTML = '<i class="pip"></i>'.repeat(Math.max(0, r.armor)); }
    const showSkip = G.state === 'flight' && r.fuel <= 0 && r.turboT <= 0 && r.turbo <= 0 && r.vy < 0 && Hh > 600;
    if (showSkip !== G.skipShown) { G.skipShown = showSkip; $('btnSkip').hidden = !showSkip; }
    if (G.tipT <= 0 && !$('flightTip').hidden) $('flightTip').hidden = true;
  }
  function updateCharge(dt) {
    G.meter += G.meterDir * dt * PHYS.METER_SPEED * 2;
    if (G.meter >= 1) { G.meter = 1; G.meterDir = -1; }
    if (G.meter <= 0) { G.meter = 0; G.meterDir = 1; }
    const s = steerInput();
    if (s) G.angle = clamp(G.angle + s * 0.9 * dt, PHYS.LAUNCH_MIN, PHYS.LAUNCH_MAX);
    $('needle').style.left = (G.meter * 100).toFixed(2) + '%';
    setText('angleHint', 'Winkel ' + Math.round(G.angle * 180 / Math.PI) + '°' + (FINE_POINTER ? ' · W/S ändert ihn' : ''));
  }

  // ================= 2D overlay: texts, speed lines, flash =================
  const _proj = new T.Vector3();
  function drawFx() {
    fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fctx.clearRect(0, 0, W, H);
    const r = G.rocket;
    if (r && G.state === 'flight' && !reduceMotion) {
      const sp = Math.hypot(r.vx, r.vy) * S;
      const a = clamp((sp - 70) / 160, 0, 0.4);
      if (a > 0.02) {
        fctx.strokeStyle = `rgba(255,255,255,${a})`; fctx.lineWidth = 1.5; fctx.beginPath();
        for (let i = 0; i < 28; i++) {
          const ang = Math.random() * TAU, rr = Math.max(W, H) * (0.35 + Math.random() * 0.4);
          const x = W / 2 + Math.cos(ang) * rr, y = H * 0.45 + Math.sin(ang) * rr, l = 50 + Math.random() * 110;
          fctx.moveTo(x, y); fctx.lineTo(x - Math.cos(ang) * l, y - Math.sin(ang) * l);
        }
        fctx.stroke();
      }
    }
    fctx.textAlign = 'center'; fctx.textBaseline = 'middle';
    for (const t of G.texts) {
      if (t.ring) continue;
      _proj.set(t.x * S, t.y * S, 0).project(camera);
      if (_proj.z > 1) continue;
      const X = (_proj.x * 0.5 + 0.5) * W, Y = (-_proj.y * 0.5 + 0.5) * H - t.dy;
      const k = t.life / t.max;
      fctx.font = `${t.big ? 24 : 17}px ${FONT_DISPLAY}`;
      fctx.globalAlpha = Math.min(1, k * 2);
      fctx.fillStyle = 'rgba(10,14,40,.6)'; fctx.fillText(t.text, X + 1.5, Y + 2);
      fctx.fillStyle = t.col; fctx.fillText(t.text, X, Y);
    }
    fctx.globalAlpha = 1;
    if (G.flash > 0) { fctx.fillStyle = `rgba(${G.flashRgb.join(',')},${Math.min(0.5, G.flash)})`; fctx.fillRect(0, 0, W, H); }
    const vg = fctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.max(W, H) * 0.85);
    vg.addColorStop(0, 'rgba(0,0,20,0)'); vg.addColorStop(1, 'rgba(0,0,20,.28)');
    fctx.fillStyle = vg; fctx.fillRect(0, 0, W, H);
  }

  // ================= missions =================
  function maxedCount() { return UPGRADES.filter(u => (save.up[u.id] || 0) >= u.max).length; }
  function missionValue(m, live) {
    const s = save.stats, run = live ? G.run : null;
    switch (m.t) {
      case 'alt': return Math.max(s.bestA, run ? run.maxA : 0);
      case 'speed': return Math.max(s.bestV, run ? run.maxV : 0);
      case 'runCoins': return Math.max(s.bestRunCoins, run ? run.coins : 0);
      case 'runRings': return Math.max(s.bestRunRings, run ? run.rings : 0);
      case 'runBounces': return Math.max(s.bestRunBounces, run ? run.bounces : 0);
      case 'noBoost': return s.bestNoBoost;
      case 'rockets': return save.rockets.length;
      case 'maxed': return maxedCount();
      default: return (s[m.t] || 0) + (run && run[m.t] ? run[m.t] : 0);
    }
  }
  function missionDone(m, live) { return missionValue(m, live) >= m.goal; }
  function checkMissions(live) {
    const newly = [];
    for (const m of MISSIONS) {
      if (save.seen[m.id] || save.claimed[m.id]) continue;
      if (missionDone(m, live)) {
        save.seen[m.id] = 1; newly.push(m);
        if (G.run) G.run.done.push(m);
        if (G.state !== 'results') toast('Mission erfüllt: ' + m.text, '+' + fmtNum(m.reward), true);
      }
    }
    if (newly.length) { Sfx.mission(); updateBadges(); }
    return newly;
  }
  function claimableCount() { return MISSIONS.filter(m => !save.claimed[m.id] && missionDone(m, false)).length; }
  function claimMission(id) {
    const m = MISSIONS.find(x => x.id === id);
    if (!m || save.claimed[id] || !missionDone(m, false)) return;
    save.claimed[id] = 1; save.seen[id] = 1;
    save.coins += m.reward; save.stats.earned += m.reward;
    persist(); Sfx.buy(); updateBadges(); updateCoins();
  }

  // ================= menus =================
  const ICONS = {
    sling: '<path d="M6 3v6a6 6 0 0 0 12 0V3"/><path d="M12 15v6"/><path d="M6 6l6 4 6-4"/>',
    engine: '<path d="M12 2c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 2 1.3 3 2.5 3.5C11 8 11 5 12 2z"/>',
    tank: '<rect x="7" y="4" width="10" height="17" rx="3"/><path d="M10 2h4M7 10h10"/>',
    aero: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    value: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    eff: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9 14h6"/>',
    magnet: '<path d="M5 3v9a7 7 0 0 0 14 0V3"/><path d="M9 3v9a3 3 0 0 0 6 0V3"/><path d="M5 7h4M15 7h4"/>',
    steer: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 14v7M10 12H3M14 12h7"/>',
    wings: '<path d="M2 13c4-1 7-1.5 10-1.5S18 12 22 13"/><path d="M12 6v12"/><path d="M9 18h6"/>',
    fuelfind: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>',
    luck: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
    armor: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    turbo: '<path d="M6 13l6-6 6 6"/><path d="M6 19l6-6 6 6"/>',
    bounce: '<path d="M5 21h14"/><path d="M8 18l8-2-8-2 8-2-8-2 8-2"/><path d="M5 3h14"/>',
  };
  const svgIcon = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] || ''}</svg>`;
  function upgradeStat(id, st) {
    const scale = ZONES[1].A / ZONES[1].H;
    switch (id) {
      case 'sling': return ['Abschuss', deNum(st.sling * scale * 3.6) + ' km/h'];
      case 'engine': return ['Schub', deNum(st.thrust / PHYS.G0, 2) + ' g'];
      case 'tank': return ['Brenndauer', deNum(st.fuel / st.burn, 1) + ' s'];
      case 'aero': return ['Luftwiderstand', deNum(st.drag / PHYS.DRAG * 100) + ' %'];
      case 'value': return ['Münzwert', '×' + deNum(st.coinMult, 2)];
      case 'eff': return ['Verbrauch', deNum(st.burn * 100) + ' %'];
      case 'magnet': return ['Fangradius', st.magnet ? deNum(st.magnet / 10, 1) + ' m' : 'aus'];
      case 'steer': return ['Lenkung', deNum(st.handling * 180 / Math.PI) + ' °/s'];
      case 'wings': return ['Auftrieb', st.lift ? deNum(st.lift * 100) + ' %' : 'keiner'];
      case 'fuelfind': return ['Kanister', '×' + deNum(st.canRate, 2) + ' · je ' + deNum(st.canAmt * 100) + ' %'];
      case 'luck': return ['Gold / Edelstein', deNum((0.035 + 0.012 * st.luck) * 100, 1) + ' / ' + deNum((0.02 + 0.009 * st.luck) * 100, 1) + ' %'];
      case 'armor': return ['Schildladungen', String(st.armor)];
      case 'turbo': return ['Turbos pro Flug', String(st.turbo)];
      case 'bounce': return ['Abpraller', String(st.bounce)];
    }
    return ['', ''];
  }
  const QUICK = [
    { id: 'sling', title: 'Katapult', sub: 'Abschusskraft', c1: '#2bb673', c2: '#1b7f55' },
    { id: 'tank', title: 'Tank', sub: 'Brenndauer', c1: '#4f7dff', c2: '#2c4fc4' },
    { id: 'engine', title: 'Booster', sub: 'Schub', c1: '#ff8a3d', c2: '#d4501c' },
    { id: 'value', title: 'Einkommen', sub: 'Münzwert', c1: '#e4b520', c2: '#b07d0a' },
  ];
  function buyUpgrade(id) {
    const u = UPG[id], L = save.up[id] || 0;
    if (!u || L >= u.max) return false;
    const c = upgradeCost(u, L);
    if (c > save.coins) { Sfx.deny(); return false; }
    save.coins -= c; save.up[id] = L + 1;
    stats = computeStats(save);
    persist(); Sfx.buy(); checkMissions(false);
    return true;
  }
  function updateCoins() { const c = fmtNum(save.coins); $('mCoins').textContent = c; $('hgCoins').textContent = c; $('cCoins').textContent = c; }
  function updateBadges() { const n = claimableCount(); for (const id of ['mBadge', 'mBadge2']) { const b = $(id); b.hidden = n === 0; b.textContent = n; } }
  function nextGoal() {
    const z = save.bestZone;
    if (z >= ZONES.length - 1) return save.won ? 'Alles entdeckt. Jag deine Rekorde!' : 'Ziel: Heliopause';
    const nz = ZONES[z + 1];
    return 'Nächstes Ziel: ' + nz.name + ' · ' + fmtAlt(nz.A);
  }
  function updateMenu() {
    updateCoins(); updateBadges();
    $('mBest').textContent = save.stats.bestA > 0 ? fmtAlt(save.stats.bestA) : '–';
    $('mGoal').textContent = nextGoal();
    $('btnSound').setAttribute('aria-pressed', save.settings.sound ? 'true' : 'false');
    const st = computeStats(save);
    $('qcards').innerHTML = QUICK.map(q => {
      const u = UPG[q.id], L = save.up[q.id] || 0, maxed = L >= u.max, cost = maxed ? 0 : upgradeCost(u, L);
      const [, now] = upgradeStat(q.id, st);
      const nxt = maxed ? '' : upgradeStat(q.id, computeStats({ ...save, up: { ...save.up, [q.id]: L + 1 } }))[1];
      return `<div class="qcard" style="--c1:${q.c1};--c2:${q.c2}">
        <header><b>${q.title}</b><span>${q.sub}</span></header>
        <div class="qbody">
          <div class="qlvl"><span>Stufe ${L} / ${u.max}</span><span class="qico">${svgIcon(q.id)}</span></div>
          <div class="lvl-bar"><i style="width:${(L / u.max * 100).toFixed(1)}%"></i></div>
          <div class="qstat">${maxed ? `<b>${now}</b>` : `${now} → <b>${nxt}</b>`}</div>
        </div>
        ${maxed ? '<button class="btn" disabled>Max</button>' : `<button class="btn${cost <= save.coins ? ' primary' : ''}" data-qbuy="${q.id}" ${cost <= save.coins ? '' : 'disabled'}><i class="coin-ico"></i>${fmtNum(cost)}</button>`}
      </div>`;
    }).join('');
  }
  $('qcards').addEventListener('click', e => {
    const b = e.target.closest('[data-qbuy]');
    if (!b || b.disabled) return;
    if (buyUpgrade(b.dataset.qbuy)) updateMenu();
  });

  // ---------- results ----------
  function reasonText(r) { return { land: 'Gelandet', crash: 'Bruchlandung', splash: 'Platsch! Wasserlandung', skip: 'Zurück zur Erde', abort: 'Flug beendet', win: 'Heliopause erreicht!' }[r] || 'Flug beendet'; }
  function bestTip() {
    const nr = ROCKETS.find(R => !save.rockets.includes(R.id));
    if (nr && nr.req <= save.bestZone && nr.cost <= save.coins) return `Du kannst dir die Rakete <b>${nr.name}</b> leisten. Schau im Hangar unter Raketen vorbei.`;
    const opts = UPGRADES.filter(u => (save.up[u.id] || 0) < u.max).map(u => ({ u, c: upgradeCost(u, save.up[u.id] || 0) })).filter(x => x.c <= save.coins);
    if (opts.length) {
      const pri = ['engine', 'tank', 'sling', 'aero', 'value'];
      opts.sort((a, b) => (pri.indexOf(a.u.id) + 1 || 9) - (pri.indexOf(b.u.id) + 1 || 9) || a.c - b.c);
      return `Bereit für ein Upgrade: <b>${opts[0].u.name}</b> kostet ${fmtNum(opts[0].c)} Münzen.`;
    }
    const claim = claimableCount();
    if (claim) return `Du hast <b>${claim}</b> erfüllte Mission${claim > 1 ? 'en' : ''}. Hol dir die Belohnung im Hangar ab.`;
    if (nr && nr.req > save.bestZone) return `Erreiche <b>${ZONES[nr.req].name}</b>, um die Rakete ${nr.name} freizuschalten.`;
    return pick(['Triff beim Abschuss das Feld „Perfekt“: Das gibt mehr Tempo und 10 % mehr Münzen.', 'Boost-Ringe geben Tempo und ein bisschen Treibstoff zurück.', 'Ballons platzen lassen gibt Auftrieb und Münzen.', 'Zünde den Turbo, während du Schub gibst: Er schiebt zusätzlich und kostet keinen Treibstoff.']);
  }
  function showResults(d) {
    const { run, reason } = d;
    const [av, au] = fmtAltParts(run.maxA);
    const zi = zoneIndexAt(run.maxH);
    const shown = d.newly.slice(0, 4), more = d.newly.length - shown.length;
    const sheet = $('resultsSheet');
    sheet.innerHTML = `
      <div style="display:grid;gap:4px">
        <div class="eyebrow">${reasonText(reason)}</div>
        <div class="res-alt">${av}<small>${au}</small></div>
        <div class="muted">Maximale Höhe · ${ZONES[zi].name}</div>
        ${d.isRecord ? '<div class="stamp">Neuer Rekord!</div>' : ''}
      </div>
      <div class="ledger">
        <div><span>Gesammelt (${fmtNum(run.coinCount)} Münzen${run.gems ? ', ' + run.gems + ' Edelst.' : ''})</span><span>${fmtNum(d.collected)}</span></div>
        <div><span>Höhenbonus</span><span>${fmtNum(d.heightBonus)}</span></div>
        ${run.perfect ? '<div><span>Perfekter Abschuss</span><span>+10 %</span></div>' : ''}
        ${d.recordBonus ? `<div><span>Rekordbonus</span><span>${fmtNum(d.recordBonus)}</span></div>` : ''}
        ${d.winBonus ? `<div><span>Heliopause-Prämie</span><span>${fmtNum(d.winBonus)}</span></div>` : ''}
        <div class="total"><span>Gesamt</span><span><i class="coin-ico"></i>${fmtNum(d.total)}</span></div>
      </div>
      <div class="mini">
        <div><b>${fmtSpeed(run.maxV)}</b><span>Spitze</span></div>
        <div><b>${deNum(run.time, 1)} s</b><span>Flugzeit</span></div>
        <div><b>${run.rings}</b><span>Ringe</span></div>
        <div><b>${run.cans}</b><span>Kanister</span></div>
      </div>
      ${d.newly.length ? `<div class="done-list">${shown.map(() => '<div>✓ <span></span></div>').join('')}${more > 0 ? `<div class="muted">und ${more} weitere – Belohnungen im Hangar unter Missionen</div>` : ''}</div>` : ''}
      <div class="tipbox">${bestTip()}</div>
      <div class="row stretch"><button class="btn" id="resHangar">Hangar</button><button class="btn primary" id="resAgain">Weiter</button></div>`;
    sheet.querySelectorAll('.done-list span').forEach((s, i) => { s.textContent = 'Mission erfüllt: ' + shown[i].text; });
    $('results').hidden = false; G.overlay = 'results';
    $('resAgain').onclick = () => { Sfx.click(); closeResults(); if (d.firstWin) showVictory(); };
    $('resHangar').onclick = () => { Sfx.click(); closeResults(); openHangar('upgrades'); if (d.firstWin) showVictory(); };
    setTimeout(() => { const b = $('resAgain'); if (b) b.focus({ preventScroll: true }); }, 50);
    showScreen('none');
  }
  function closeResults() { $('results').hidden = true; G.overlay = null; toMenu(); }
  function showVictory() {
    const s = save.stats;
    $('victoryStats').innerHTML = `<div><b>${s.flights}</b><span>Flüge</span></div><div><b>${fmtNum(s.earned)}</b><span>Münzen verdient</span></div><div><b>${Math.round(s.playTime / 60)} min</b><span>Spielzeit</span></div>`;
    $('victory').hidden = false; G.overlay = 'victory';
  }
  $('btnVictory').onclick = () => { $('victory').hidden = true; G.overlay = !$('hangar').hidden ? 'hangar' : null; };

  // ---------- hangar ----------
  let hangarTab = 'upgrades';
  function openHangar(tab) {
    hangarTab = tab || hangarTab;
    $('hangar').hidden = false; G.overlay = 'hangar';
    renderHangar();
    $('tabBody').scrollTop = 0;
    setTimeout(() => { const t = document.querySelector(`.tab[data-tab="${hangarTab}"]`); if (t) t.focus({ preventScroll: true }); }, 30);
  }
  function closeHangar() {
    $('hangar').hidden = true; G.overlay = null;
    stats = computeStats(save);
    setRocketMesh(save.rocket);
    if (G.state === 'menu') updateMenu();
  }
  const previews = new Map();
  let prev = null;
  function rocketPreview(R, locked) {
    const key = R.id + (locked ? ':l' : '');
    if (previews.has(key)) return previews.get(key);
    if (!prev) {
      const r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setSize(460, 220, false); r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping;
      const s = new T.Scene();
      s.add(new T.HemisphereLight(0xdfeaff, 0x34406a, 1.6));
      const d = new T.DirectionalLight(0xffffff, 2.2); d.position.set(3, 5, 6); s.add(d);
      const c = new T.PerspectiveCamera(28, 460 / 220, 0.1, 100);
      c.position.set(-1.5, 2.2, 22); c.lookAt(0, 0, 0);
      prev = { r, s, c };
    }
    const m = Models.rocket(R.look);
    m.rotation.order = 'ZYX'; m.rotation.z = 0.32; m.rotation.x = -0.5;
    m.scale.setScalar(9 / m.userData.length);
    m.userData.setThrust(locked ? 0 : 0.55, 1.3);
    prev.s.add(m);
    prev.r.render(prev.s, prev.c);
    prev.s.remove(m);
    m.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    const out = document.createElement('canvas'); out.width = 460; out.height = 220;
    const g = out.getContext('2d');
    if (locked) g.filter = 'brightness(0.18) saturate(0)';
    g.drawImage(prev.r.domElement, 0, 0);
    previews.set(key, out);
    return out;
  }
  function renderHangar() {
    updateCoins(); updateBadges();
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === hangarTab ? 'true' : 'false'));
    const body = $('tabBody'), st = computeStats(save);
    if (hangarTab === 'upgrades') {
      $('hgFoot').textContent = 'Jede Stufe wirkt sofort beim nächsten Flug.';
      body.innerHTML = '<div class="grid">' + UPGRADES.map(u => {
        const L = save.up[u.id] || 0, maxed = L >= u.max, cost = maxed ? 0 : upgradeCost(u, L);
        const [label, now] = upgradeStat(u.id, st);
        const nxt = maxed ? '' : upgradeStat(u.id, computeStats({ ...save, up: { ...save.up, [u.id]: L + 1 } }))[1];
        return `<div class="card${maxed ? ' maxed' : ''}">
          <div class="up-head"><span class="up-ico">${svgIcon(u.id)}</span><div><div class="up-name">${u.name}</div><div class="up-lvl">Stufe ${L} / ${u.max}</div></div></div>
          <div class="lvl-bar"><i style="width:${(L / u.max * 100).toFixed(1)}%"></i></div>
          <div class="up-desc">${u.desc}</div>
          <div class="up-stat"><span class="muted">${label}</span>${maxed ? `<b>${now}</b>` : `<span>${now}</span><span class="muted">→</span><b>${nxt}</b>`}</div>
          ${maxed ? '<button class="btn" disabled>Höchststufe</button>' : `<button class="btn${cost <= save.coins ? ' primary' : ''}" data-buy="${u.id}" ${cost <= save.coins ? '' : 'disabled'}><i class="coin-ico"></i>${fmtNum(cost)}</button>`}
        </div>`;
      }).join('') + '</div>';
    } else if (hangarTab === 'rockets') {
      $('hgFoot').textContent = 'Neue Raketen schaltest du frei, indem du höhere Zonen erreichst.';
      const maxT = ROCKETS[ROCKETS.length - 1];
      const bar = (v, m) => `style="--w:${clamp(v / m * 100, 4, 100).toFixed(0)}%"`;
      body.innerHTML = '<div class="grid">' + ROCKETS.map(R => {
        const own = save.rockets.includes(R.id), sel = save.rocket === R.id, unlocked = R.req <= save.bestZone;
        const perks = [];
        if (R.armor) perks.push(`+${R.armor} Schild`);
        if (R.turbo) perks.push(`+${R.turbo} Turbo`);
        if (R.magnet > 1) perks.push('Magnetfeld');
        if (R.lift > 1) perks.push('Gleitflügel');
        if (R.coin > 1) perks.push(`Münzen ×${deNum(R.coin, 2)}`);
        if (R.can > 1) perks.push(`Kanister ×${deNum(R.can, 1)}`);
        let btn;
        if (sel) btn = '<button class="btn" disabled>Ausgewählt</button>';
        else if (own) btn = `<button class="btn" data-select="${R.id}">Auswählen</button>`;
        else if (!unlocked) btn = `<button class="btn" disabled>Erreiche ${ZONES[R.req].name}</button>`;
        else btn = `<button class="btn${R.cost <= save.coins ? ' primary' : ''}" data-rocket="${R.id}" ${R.cost <= save.coins ? '' : 'disabled'}><i class="coin-ico"></i>${fmtNum(R.cost)}</button>`;
        return `<div class="card${sel ? ' sel' : ''}${!own && !unlocked ? ' locked' : ''}">
          <canvas class="rk-canvas" data-rk="${R.id}" width="460" height="220"></canvas>
          <div class="up-head" style="justify-content:space-between"><div class="up-name">${R.name}</div>${own ? '<span class="up-lvl">Im Hangar</span>' : ''}</div>
          <div class="up-desc">${R.blurb}</div>
          <div class="bars"><div>Schub<i ${bar(R.thrust, maxT.thrust)}></i></div><div>Tank<i ${bar(R.fuel, maxT.fuel)}></i></div><div>Aero<i ${bar(1 / R.drag, 1 / maxT.drag)}></i></div><div>Lenkung<i ${bar(R.handling, maxT.handling)}></i></div></div>
          ${perks.length ? `<div class="perks">${perks.map(p => `<span class="perk">${p}</span>`).join('')}</div>` : ''}
          ${btn}
        </div>`;
      }).join('') + '</div>';
      body.querySelectorAll('canvas[data-rk]').forEach(c => {
        const R = ROCKET_BY_ID[c.dataset.rk];
        try { c.getContext('2d').drawImage(rocketPreview(R, !save.rockets.includes(R.id) && R.req > save.bestZone), 0, 0); } catch (e) { /* preview unavailable */ }
      });
    } else if (hangarTab === 'missions') {
      $('hgFoot').textContent = `${Object.keys(save.claimed).length} von ${MISSIONS.length} Missionen abgeschlossen.`;
      const groups = {};
      for (const m of MISSIONS) (groups[m.g] = groups[m.g] || []).push(m);
      body.innerHTML = Object.entries(groups).map(([g, list]) => `<div class="m-group">${g}</div><div class="m-list">` + list.map(m => {
        const v = missionValue(m, false), done = v >= m.goal, claimed = !!save.claimed[m.id];
        const pct = clamp(m.t === 'alt' || m.t === 'speed' || m.t === 'runCoins' ? Math.log10(1 + v) / Math.log10(1 + m.goal) : v / m.goal, 0, 1) * 100;
        const prog = m.t === 'alt' ? `${fmtAlt(Math.min(v, m.goal))} / ${fmtAlt(m.goal)}` : m.t === 'speed' ? `${fmtSpeed(Math.min(v, m.goal))} / ${fmtSpeed(m.goal)}` : `${fmtNum(Math.min(v, m.goal))} / ${fmtNum(m.goal)}`;
        const btn = claimed ? '<span class="up-lvl">Erledigt</span>' : done ? `<button class="btn primary" data-claim="${m.id}"><i class="coin-ico"></i>${fmtNum(m.reward)}</button>` : `<span class="up-lvl" style="display:inline-flex;gap:6px;align-items:center"><i class="coin-ico" style="width:14px;height:14px"></i>${fmtNum(m.reward)}</span>`;
        return `<div class="mission${claimed ? ' claimed' : done ? ' claimable' : ''}"><div class="m-text">${m.text}</div>${btn}<div class="m-prog"><div class="lvl-bar"><i style="width:${pct.toFixed(1)}%"></i></div><span>${prog}</span></div></div>`;
      }).join('') + '</div>').join('');
    } else {
      $('hgFoot').textContent = 'Dein Spielstand wird automatisch in diesem Browser gespeichert.';
      const s = save.stats, tile = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
      body.innerHTML = `<div class="stats">
        ${tile(fmtAlt(s.bestA), 'Rekordhöhe')}${tile(fmtSpeed(s.bestV), 'Höchstgeschwindigkeit')}${tile(fmtNum(s.flights), 'Flüge')}
        ${tile(fmtNum(s.earned), 'Münzen verdient')}${tile(fmtNum(s.bestRunCoins), 'Beste Flugbeute')}${tile(fmtNum(s.gems), 'Edelsteine')}
        ${tile(fmtNum(s.rings), 'Boost-Ringe')}${tile(fmtNum(s.cans), 'Kanister')}${tile(fmtNum(s.balloons), 'Ballons')}
        ${tile(fmtNum(s.shieldHits), 'Schildtreffer')}${tile(fmtNum(s.turbos), 'Turbozündungen')}${tile(Math.round(s.playTime / 60) + ' min', 'Spielzeit')}
        </div>
        <div class="m-group" style="margin-top:18px">Zonen</div>
        <div class="zones">${ZONES.map((z, i) => `<div class="${i <= save.bestZone ? '' : 'no'}"><span>${i <= save.bestZone ? z.name : '???'}</span><span>${i <= save.bestZone + 1 ? fmtAlt(z.A) : ''}</span></div>`).join('')}</div>
        <div id="resetBox" style="margin-top:18px"><button class="btn" id="btnReset">Spielstand zurücksetzen</button></div>`;
      $('btnReset').onclick = () => {
        $('resetBox').innerHTML = `<div class="confirm danger"><b>Wirklich alles löschen?</b><span class="muted">Münzen, Upgrades, Raketen und Rekorde gehen verloren.</span><div class="row"><button class="btn" id="rsNo">Abbrechen</button><button class="btn" id="rsYes" style="border-color:var(--bad);color:#ffd0d5">Ja, zurücksetzen</button></div></div>`;
        $('rsNo').onclick = () => renderHangar();
        $('rsYes').onclick = () => { save = defaultSave(); persist(); stats = computeStats(save); Sfx.setOn(save.settings.sound); Sfx.click(); renderHangar(); };
      };
    }
  }
  $('tabBody').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.buy) {
      if (buyUpgrade(b.dataset.buy)) { renderHangar(); const nb = document.querySelector(`[data-buy="${b.dataset.buy}"]`); if (nb && !nb.disabled) nb.focus({ preventScroll: true }); }
    } else if (b.dataset.rocket) {
      const R = ROCKET_BY_ID[b.dataset.rocket];
      if (!R || save.rockets.includes(R.id) || R.cost > save.coins || R.req > save.bestZone) { Sfx.deny(); return; }
      save.coins -= R.cost; save.rockets.push(R.id); save.rocket = R.id;
      persist(); Sfx.buy(); checkMissions(false); renderHangar();
      toast(R.name + ' ist startklar!', '', true);
    } else if (b.dataset.select) {
      save.rocket = b.dataset.select; persist(); Sfx.click(); renderHangar();
    } else if (b.dataset.claim) {
      claimMission(b.dataset.claim); renderHangar();
    }
  });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { Sfx.click(); hangarTab = t.dataset.tab; renderHangar(); $('tabBody').scrollTop = 0; }));

  // ---------- toasts & banners ----------
  let bannerTimer = 0;
  function showBanner(small, big, desc) {
    const b = $('banner');
    $('bSmall').textContent = small; $('bBig').textContent = big; $('bDesc').textContent = desc || '';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), 3300);
  }
  function toast(text, right, gold) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (gold ? ' gold' : '');
    const span = document.createElement('span'); span.style.flex = '1'; span.textContent = text; el.appendChild(span);
    if (right) { const i = document.createElement('i'); i.className = 't-ico'; i.textContent = right; el.appendChild(i); }
    box.appendChild(el);
    while (box.children.length > (G.state === 'flight' ? 2 : 3)) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, 3200);
  }

  // ---------- buttons ----------
  $('btnPlay').onclick = () => startFromTitle();
  $('btnFly').onclick = () => { Sfx.init(); enterCharge(); };
  $('btnLaunch').addEventListener('pointerdown', e => { e.preventDefault(); Sfx.init(); if (G.state === 'charge' && !G.overlay) launch(); });
  $('btnLaunch').addEventListener('click', e => { if (e.detail === 0 && G.state === 'charge') { Sfx.init(); launch(); } });
  $('btnBack').onclick = () => { Sfx.click(); toMenu(); };
  $('btnHangar').onclick = () => { Sfx.init(); Sfx.click(); openHangar('upgrades'); };
  $('btnMissions').onclick = () => { Sfx.init(); Sfx.click(); openHangar('missions'); };
  $('btnToPad').onclick = () => { Sfx.click(); closeHangar(); };
  $('btnSound').onclick = () => { Sfx.init(); save.settings.sound = !save.settings.sound; Sfx.setOn(save.settings.sound); persist(); updateMenu(); Sfx.click(); };
  $('btnHelp').onclick = () => { $('help').hidden = false; G.overlay = 'help'; };
  function closeHelp() { $('help').hidden = true; G.overlay = null; }
  $('btnHelpClose').onclick = closeHelp;
  $('btnPause').onclick = () => togglePause();
  $('btnResume').onclick = () => togglePause();
  $('btnAbort').onclick = () => { $('pause').hidden = true; G.paused = false; G.overlay = null; endFlight('abort'); };
  $('btnSkip').onclick = () => { if (!G.paused) endFlight('skip'); };
  function togglePause() {
    if (G.state !== 'flight') return;
    G.paused = !G.paused;
    $('pause').hidden = !G.paused;
    G.overlay = G.paused ? 'pause' : null;
    if (G.paused) { Sfx.thrust(0, false); input.down = false; input.boostBtn = false; setTimeout(() => $('btnResume').focus({ preventScroll: true }), 20); }
  }

  // ================= main loop =================
  let lastNow = performance.now(), acc = 0, missionT = 0;
  function frame(now) {
    let dt = (now - lastNow) / 1000; lastNow = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    const active = !G.paused;
    if (active) G.t += dt;
    let sdt = dt;
    if (G.slowmo > 0 && active) { G.slowmo -= dt; sdt = dt * 0.45; }
    if (G.state === 'charge' && active) updateCharge(dt);
    if (G.state === 'flight' && active) {
      acc += sdt;
      const step = 1 / 120;
      let n = 0;
      while (acc >= step && n < 24 && G.state === 'flight') { updateFlight(step); acc -= step; n++; }
      if (G.state === 'flight') {
        spawnTick();
        const r = G.rocket;
        Sfx.thrust(r.turboT > 0 ? 1.3 : r.boosting ? 1 : 0, airDensity(Math.max(0, r.y)) < 0.05);
        updateHUD();
        G.comboT -= dt;
        if (G.tipT > 0) G.tipT -= dt;
        missionT -= dt;
        if (missionT <= 0) { missionT = 0.5; checkMissions(true); }
        save.stats.playTime += dt;
      }
    } else acc = 0;
    if (G.state === 'ending' && active) {
      G.endTimer -= dt;
      const r = G.rocket;
      if (r && !G.crashed && G.endReason !== 'land') { r.x += r.vx * dt * 0.5; r.y += r.vy * dt * 0.5; }
      if (G.state === 'ending') updateHUD();
      if (G.endTimer <= 0) { G.state = 'results'; finishRun(); }
    }
    if (active) {
      G.flash = Math.max(0, G.flash - dt * 1.6);
      updateObjects(dt);
    }
    updateRocketVisual(active ? sdt : 0);
    updateCamera(dt);
    catapult.userData.lamp.emissiveIntensity = Math.sin(G.t * 4) > 0.2 ? 2.4 : 0.2;
    if (catapult.userData.sock) catapult.userData.sock.rotation.y = Math.sin(G.t * 1.7) * 0.25;
    World.update(active ? dt : 0, G.t, Math.max(0, camera.position.y / S));
    World.render();
    drawFx();
    requestAnimationFrame(frame);
  }

  // ================= boot =================
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, window.innerWidth); H = Math.max(320, window.innerHeight);
    World.resize(W, H);
    fxCanvas.width = Math.round(W * DPR); fxCanvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);
  function boot(data) {
    save = loadSave(data || {});
    stats = computeStats(save);
    Sfx.setOn(save.settings.sound);
    try { window.claude?.hot?.snapshot?.(() => ({ save })); } catch (e) { /* not in a viewer */ }
    resize();
    setRocketMesh(save.rocket);
    G.state = 'title';
    showScreen('title');
    if (save.stats.flights > 0) $('btnPlay').textContent = 'Weiterspielen';
    requestAnimationFrame(t => { lastNow = t; requestAnimationFrame(frame); });
    window.__sternenschleuder = { G, cam, get save() { return save; }, set save(v) { save = normalizeSave(v); stats = computeStats(save); setRocketMesh(save.rocket); if (G.state === 'menu') updateMenu(); }, toMenu, enterCharge, launch };
  }
  if (window.claude?.hot?.ready) window.claude.hot.ready(boot); else boot(window.claude?.hot?.data ?? {});
})();
