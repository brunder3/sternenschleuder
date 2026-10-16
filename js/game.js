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
    heat: 0,
  };
  const RR = 18;                         // rocket hit radius (u)
  const PAD_Y = World.heightAt(0, 0);
  let pad, rocketMesh = null, rocketMeshId = '';

  // ================= launch site =================
  pad = Models.launchPad();
  pad.position.set(0, PAD_Y, 0);
  scene.add(pad);
  const PIVOT = pad.userData.pivot;      // height of the launch rail's hinge above the pad (three units)
  function setRocketMesh(id) {
    if (rocketMeshId === id && rocketMesh) return;
    if (rocketMesh) { scene.remove(rocketMesh); rocketMesh.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    rocketMesh = Models.rocket((ROCKET_BY_ID[id] || ROCKETS[0]).look);
    rocketMesh.rotation.order = 'ZYX';
    rocketMeshId = id;
    scene.add(rocketMesh);
  }
  // rocket clamped to the launch rail: tail just past the hinge, nose along the launch angle
  function padPose() {
    const a = G.angle, L = rocketMesh ? rocketMesh.userData.length : 7;
    const tx = Math.cos(a) * 0.8, ty = PIVOT + Math.sin(a) * 0.8;
    return { tx, ty, cx: tx + Math.cos(a) * L / 2, cy: PAD_Y + ty + Math.sin(a) * L / 2, a };
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
      else if (G.overlay === 'rebirth') closeRebirth();
      else if (G.overlay === 'pets') closePets();
      else if (G.overlay === 'login') closeLogin();
      else if (G.overlay === 'gifts') closeGifts();
      else if (G.overlay === 'wheel') closeWheel();
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
    G.state = 'menu'; G.rocket = null; G.run = null; G.crashed = false; G.splash = false; G.heat = 0;
    clearObjects(); World.fx.clear(); G.texts.length = 0;
    stats = computeStats(save);
    setRocketMesh(save.rocket);
    rocketMesh.visible = true;
    G.angle = PHYS.LAUNCH_DEFAULT;
    World.resetClouds(0, 40);
    showScreen('menu');
    refreshPetMeshes();
    maybeLoginPopup();
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
    G.rocket = r; G.run = newRun(); G.crashed = false; G.splash = false; G.heat = 0;
    G.state = 'flight'; G.paused = false;
    G.lastZone = 0; G.combo = 0; G.descendT = 0; G.skipShown = false;
    G.tipT = save.stats.flights < 3 ? 5 : 0;
    input.armed = true;                  // keep holding after the launch to fire the boosters
    r.hold = 1.2;                        // the nose keeps the launch angle for a moment
    clearObjects(); G.texts.length = 0;
    G.spawnLast = { x: r.x, y: r.y };
    G.acc = { coin: 0, fuel: 1200, ring: 800, obst: 0, friend: 0, amb: 0 };
    populateInitial();
    Sfx.ignite();
    G.shake = 5 + 6 * p;
    if (perfect) {
      G.run.perfect = true; G.run.coinBonus = 1.1; G.slowmo = 0.45;
      Sfx.perfect();
      const pop = document.createElement('div'); pop.className = 'perfect-pop'; pop.textContent = 'Perfekt!';
      document.body.appendChild(pop); setTimeout(() => pop.remove(), 1200);
    }
    // ignition: exhaust floods the flame trench and billows out over the pad
    for (let i = 0; i < 70; i++) { const side = Math.random() < 0.5 ? -1 : 1; World.fx.norm({ x: 1.5 + rand(-3, 4), y: PAD_Y + 2.2, z: side * rand(0, 3), vx: rand(-6, 10), vy: rand(1, 6), vz: side * rand(6, 20), life: rand(1.6, 3.2), size: rand(3, 6), grow: 2.2, drag: 1.1, c: [0.9, 0.9, 0.92], a: 0.65 }); }
    for (let i = 0; i < 30; i++) World.fx.add({ x: 1.5 + rand(-2, 2), y: PAD_Y + 2, z: rand(-2, 2), vx: rand(-8, 8), vy: rand(0, 6), vz: rand(-10, 10), life: rand(0.3, 0.7), size: rand(1.5, 3), drag: 2, c: [1, 0.85, 0.45], c2: [1, 0.45, 0.15] });
    for (let i = 0; i < 18; i++) World.fx.norm({ x: pose.tx, y: PAD_Y + pose.ty, z: rand(-2, 2), vx: rand(-8, 4), vy: rand(-2, 6), vz: rand(-8, 8), life: rand(0.5, 1.1), size: rand(1.5, 3), grow: 2, drag: 2, c: [0.85, 0.8, 0.7], a: 0.55 });
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
    const vDisp = displaySpeed(sp, Hh);
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
      if (zi > save.life.bestZone) {
        save.life.bestZone = zi;
        if (zi === rebirthZone(save.rebirths)) toast('Rebirth bereit!', '↻', true);
      }
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
    G.heat = reentryHeat(r);
    if (r.fuel <= 0 && r.turboT <= 0 && r.vy < 0) {
      G.descendT += dt;
      // only skip the long fall when nothing can happen any more (no turbo, no bounce left),
      // but let a glowing re-entry through the upper atmosphere play out first
      if (G.descendT > 6 && r.turbo <= 0 && r.bounces <= 0 && Hh > ZH.wolken && G.heat < 0.03) { endFlight('skip'); return; }
    } else G.descendT = 0;
    if (run.time > 600) endFlight('skip');
  }
  // re-entry glow: a rocket falling fast through the upper atmosphere (about 25 to 130 km) heats the air in
  // front of it into glowing plasma. Purely visual; 0..1 from the real altitude and the shown speed.
  function reentryHeat(r) {
    if (r.vy >= 0) return 0;
    const H = Math.max(0, r.y), A = altitudeAt(H);
    const band = smooth(25e3, 45e3, A) * (1 - smooth(95e3, 130e3, A));
    if (band <= 0) return 0;
    return band * smooth(500, 1800, displaySpeed(Math.hypot(r.vx, r.vy), H));
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
    if (run.perfect) s.perfects++;
    s.rocketBest[save.rocket] = Math.max(s.rocketBest[save.rocket] || 0, run.maxA);
    updateDaily(run, total);
    const firstWin = reason === 'win' && !save.won;
    if (reason === 'win') save.won = true;
    const lv = addXp(run);
    checkMissions(false);
    persist();
    showResults({ run, reason, heightBonus, recordBonus, winBonus, collected, total, isRecord, newly: run.done, firstWin, lv });
  }

  // ================= objects =================
  const coinGeo = Models.shared().coinGeo;
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
    oort:    { obst: ['ice', 'comet', 'ice'], every: 560, friend: ['ufo'], fEvery: 5200, amb: ['comet', 'ice'] },
    proxima: { obst: ['plasma', 'asteroid'], every: 540, friend: ['ufo'], fEvery: 4800, amb: ['plasma', 'asteroid'] },
    wega:    { obst: ['plasma', 'comet'], every: 520, friend: ['ufo'], fEvery: 5000, amb: ['comet', 'plasma'] },
    plejaden: { obst: ['plasma', 'ice', 'plasma'], every: 500, friend: ['ufo'], fEvery: 4600, amb: ['ice', 'plasma'] },
    orionnebel: { obst: ['plasma', 'rock', 'plasma'], every: 480, friend: ['ufo'], fEvery: 4400, amb: ['plasma', 'rock'] },
    zentrum: { obst: ['plasma', 'asteroid', 'comet'], every: 460, friend: ['ufo'], fEvery: 4200, amb: ['plasma', 'comet'] },
    andromeda: { obst: ['plasma', 'comet'], every: 440, friend: ['ufo'], fEvery: 4000, amb: ['plasma', 'comet'] },
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
    const fuelEvery = (3400 + sp * 0.9) / (stats.canRate * fuelScarcity(r.y));
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
    r.fuel = Math.min(r.fuelMax, r.fuel + r.fuelMax * 0.06 * fuelScarcity(r.y));
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
      // on the pad the engines idle and vent; while the ignition meter runs they build up
      const charging = st === 'charge';
      rocketMesh.userData.setThrust(charging ? 0.12 + 0.3 * G.meter : 0, G.t);
      pad.userData.setRail(p.a, 0);
      if (Math.random() < (charging ? 0.5 + G.meter : 0.15)) World.fx.norm({ x: 1.5 + rand(-2, 2), y: PAD_Y + 2, z: rand(-2, 2), vx: rand(-1, 3), vy: rand(1, 3) * (charging ? 1 + G.meter : 0.6), vz: rand(-3, 3), life: rand(1, 2), size: rand(1.5, 3), grow: 2, drag: 1, c: [0.95, 0.95, 0.97], a: 0.35 + (charging ? 0.3 * G.meter : 0), fadeIn: true });
      return;
    }
    // the clamp arms swing away after ignition
    pad.userData.setRail(G.angle, Math.min(1, (G.run ? G.run.time : 9) * 2.5));
    const r = G.rocket;
    if (!r) return;
    rocketMesh.visible = !G.crashed;
    rocketMesh.position.set(r.x * S, r.y * S, 0);
    rocketMesh.rotation.z = r.a;
    G.roll += dt * (r.boosting || r.turboT > 0 ? 2.4 : 0.7);
    rocketMesh.rotation.x = st === 'ending' ? rocketMesh.rotation.x : G.roll;
    const level = st === 'flight' ? (r.turboT > 0 ? 1.6 : r.boosting ? 1 : 0) : 0;
    const Hh = Math.max(0, r.y), A = altitudeAt(Hh), rhoR = Math.exp(-A / 7200);
    rocketMesh.userData.setThrust(level, G.t, smooth(12e3, 60e3, A));
    // condensation cloud round the hull while it punches through the sound barrier in dense air
    const mach = st === 'flight' ? displaySpeed(Math.hypot(r.vx, r.vy), Hh) / 343 : 0;
    rocketMesh.userData.setVapor(Math.exp(-Math.pow((mach - 1.0) / 0.1, 2)) * smooth(0.2, 0.6, rhoR) * 0.95, G.t);
    const heat = st === 'flight' ? G.heat : 0;
    rocketMesh.userData.setPlasma(heat, G.t);
    // while it glows the falling rocket swings its nose into the airflow (only the picture, not the physics)
    if (heat > 0) rocketMesh.rotation.z = r.a + angDiff(r.a, Math.atan2(r.vy, r.vx)) * smooth(0.02, 0.3, heat);
    if (heat > 0.05 && dt > 0) {
      // sparks and ablating flecks stream off the glowing nose
      const L = rocketMesh.userData.length, ca = Math.cos(r.a), sa = Math.sin(r.a);
      const nx = r.x * S + ca * L * 0.45, ny = r.y * S + sa * L * 0.45, vx = r.vx * S, vy = r.vy * S;
      for (let i = 0, n = Math.round(heat * 7); i < n; i++) {
        const back = rand(20, 60);
        World.fx.add({ x: nx + rand(-0.5, 0.5), y: ny + rand(-0.5, 0.5), z: rand(-1, 1), vx: vx * 0.7 - ca * back + rand(-4, 4), vy: vy * 0.7 - sa * back + rand(-4, 4), vz: rand(-5, 5), life: rand(0.25, 0.7), size: rand(0.6, 1.6), drag: 2, c: [1, 0.85, 0.55], c2: [1, 0.3, 0.45] });
      }
      if (!reduceMotion) G.shake = Math.max(G.shake, heat * 6);
    }
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
  const cam = { pos: new T.Vector3(-46, 30, 52), look: new T.Vector3(4, 12, 0), fov: 52, pitch: 0.5, blend: 0,
    rel: false, off: new T.Vector3(), loff: new T.Vector3() };
  const _cp = new T.Vector3(), _cl = new T.Vector3(), _rp = new T.Vector3();
  // smooth pseudo-random wobble for shake and rumble (white noise per frame looks like jitter)
  const wob = (t, p) => Math.sin(t * 1.0 + p) * 0.55 + Math.sin(t * 2.31 + p * 1.7) * 0.3 + Math.sin(t * 4.73 + p * 2.9) * 0.15;
  function updateCamera(dt) {
    const st = G.state;
    let fov = 55, rel = false, rate = 3, rumble = 0;
    if (st === 'menu' || st === 'title') {
      const a = G.t * 0.06;
      const portrait = W < H;
      const short = !portrait && H < 520;   // landscape phone: the cards cover the lower half, so aim lower
      _cp.set(-44 + Math.sin(a) * 6, (portrait ? 40 : 24) + PAD_Y, (portrait ? 58 : 44) + Math.cos(a) * 6);
      _cl.set(3, (portrait ? -6 : short ? -4 : 9) + PAD_Y, 0);
      fov = portrait ? 66 : 52;
    } else if (st === 'charge') {
      _cp.set(-17, 7 + PAD_Y, 19);
      _cl.set(6, 8 + PAD_Y, 0);
      fov = W < H ? 72 : 55;
    } else if (G.rocket) {
      // chase camera behind the rocket: looks down at the land in level flight and tilts up on steep climbs,
      // so whatever lies ahead on the flight path stays in view. It rides on a damped offset from the
      // rocket, so it never falls behind a fast rocket but still swings softly when the course changes.
      const r = G.rocket, sp = Math.hypot(r.vx, r.vy) * S, Hh = Math.max(0, r.y);
      const va = sp > 0.5 ? Math.atan2(r.vy, r.vx) : r.a;
      cam.pitch += (clamp(va, -0.6, 1.4) - cam.pitch) * Math.min(1, dt * 2.2);
      let lp = clamp(cam.pitch * 0.78 - 0.3, -0.55, 0.8);
      // near space the view levels out a little so the curved horizon and the glowing air stay in the shot
      lp -= 0.16 * smooth(ZH.strato, ZH.space, Hh) * (1 - smooth(ZH.orbit, ZH.geo, Hh));
      const cdx = Math.cos(lp), cdy = Math.sin(lp);
      const d = 20 + Math.min(40, sp * 0.06), h = 0.12 * d + 2.5;
      _rp.set(r.x * S, r.y * S, 0);
      _cp.set(-cdx * d, -cdy * d + h, d * 0.22);
      _cl.set(cdx * 40, cdy * 40 + h * 0.35, 0);
      fov = (W < H ? 76 : 62) + Math.min(14, sp * 0.028);
      rel = true;
      const run = G.run;
      // after the launch the camera eases from the pad shot into the chase position
      rate = st === 'flight' ? lerp(2.5, 7, smooth(0.1, 2.2, run ? run.time : 9)) : 2.5;
      if (st === 'flight' && G.heat > 0) rumble = G.heat * 0.18;   // the glowing fall shakes the view
      else if (st === 'flight' && (r.boosting || r.turboT > 0)) {
        // engines at full power shake the camera, most in dense air near the ground
        rumble = (r.turboT > 0 ? 0.16 : 0.08) * Math.exp(-altitudeAt(Hh) / 9000);
      }
      if (st === 'ending') { _cp.set(-26, 12, 16); _cl.set(0, 0, 0); rate = 2.5; }
    }
    const k = 1 - Math.exp(-dt * rate);
    if (rel) {
      if (!cam.rel) { cam.off.copy(cam.pos).sub(_rp); cam.loff.copy(cam.look).sub(_rp); }
      cam.off.lerp(_cp, k); cam.loff.lerp(_cl, k);
      cam.pos.copy(_rp).add(cam.off); cam.look.copy(_rp).add(cam.loff);
    } else {
      cam.pos.lerp(_cp, k); cam.look.lerp(_cl, k);
    }
    cam.rel = rel;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    const gy = Math.max(0, World.surfaceAt(cam.pos.x, cam.pos.z)) + 2;
    if (cam.pos.y < gy) cam.pos.y = gy;
    camera.position.copy(cam.pos);
    let sh = 0;
    if (!reduceMotion) {
      sh = G.shake * 0.06 + rumble;
      camera.position.x += wob(G.t * 21, 0.3) * sh;
      camera.position.y += wob(G.t * 19, 2.1) * sh;
      G.shake = Math.max(0, G.shake - dt * 30);
    } else G.shake = 0;
    camera.lookAt(cam.look);
    if (sh > 0) camera.rotateZ(wob(G.t * 13, 4.2) * sh * 0.012);
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
    const vms = displaySpeed(Math.hypot(r.vx, r.vy), Hh);
    const kmh = vms * 3.6;
    const [sv, su] = fmtSpeedParts(vms);
    setText('hSpd', sv); setText('hSpdU', su);
    setText('hMach', altitudeAt(Hh) < 80000 && vms > 170 ? 'Mach ' + deNum(vms / 343, 1) : '');
    // in space the distances grow far faster than any rocket flies: say so
    const lapse = Hh >= ZH.space ? timeLapseAt(Hh) : 1;
    setText('hLapse', lapse >= 10 ? 'Zeitraffer ' + fmtLapse(lapse) : '');
    const needle = clamp(Math.log10(1 + kmh) / 9.05, 0, 1);
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
      case 'rebirths': return save.rebirths;
      case 'indexed': return Object.keys(save.index).length;
      case 'mythics': return PETS.filter(p => p.rarity === 4 && save.index[p.id]).length;
      case 'level': return save.level;
      case 'rocketAlt': return Math.max(s.rocketBest[m.rocket] || 0, run && save.rocket === m.rocket ? run.maxA : 0);
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
        if (G.state !== 'results') toast('Quest erfüllt: ' + m.text, '+' + fmtNum(m.reward), true);
      }
    }
    if (newly.length) { Sfx.mission(); updateBadges(); }
    return newly;
  }
  function claimableCount() {
    ensureDaily();
    const d = save.daily, daily = d.quests.filter(q => !q.claimed && dailyDone(q)).length;
    const bonus = !d.bonusClaimed && d.quests.every(q => q.claimed) ? 1 : 0;
    return MISSIONS.filter(m => !save.claimed[m.id] && missionDone(m, false)).length + daily + bonus;
  }
  // ---------- daily quests ----------
  function ensureDaily() {
    const day = dayKey();
    if (!save.daily || save.daily.day !== day) { save.daily = makeDaily(save, day); persist(); }
  }
  function updateDaily(run, total) {
    ensureDaily();
    let fresh = false;
    for (const q of save.daily.quests) {
      if (q.claimed) continue;
      const was = dailyDone(q);
      if (q.k === 'flights') q.prog++;
      else if (q.k === 'coins') q.prog += total;
      else if (q.k === 'rings') q.prog += run.rings;
      else if (q.k === 'cans') q.prog += run.cans;
      else if (q.k === 'perfects') q.prog += run.perfect ? 1 : 0;
      else if (q.k === 'balloons') q.prog += run.balloons;
      else if (q.k === 'zone') q.prog = Math.max(q.prog, zoneIndexAt(run.maxH));
      if (!was && dailyDone(q)) fresh = true;
    }
    if (fresh) { toast('Tages-Quest erfüllt!', '★', true); Sfx.mission(); }
  }
  function claimDaily(i) {
    ensureDaily();
    const q = save.daily.quests[i];
    if (!q || q.claimed || !dailyDone(q)) return;
    q.claimed = true; save.coins += q.reward; save.stats.earned += q.reward;
    persist(); Sfx.buy(); updateBadges(); updateCoins();
  }
  function claimDailyBonus() {
    const d = save.daily;
    if (!d || d.bonusClaimed || !d.quests.every(q => q.claimed)) return;
    d.bonusClaimed = true; save.coins += d.bonus; save.stats.earned += d.bonus;
    persist(); Sfx.perfect(); updateBadges(); updateCoins();
    toast('Tagesbonus abgeholt!', '+' + fmtNum(d.bonus), true);
  }
  function untilMidnight() {
    const n = new Date(), m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    const min = Math.max(1, Math.round((m - n) / 60000));
    return min >= 60 ? `${Math.floor(min / 60)} Std. ${min % 60} Min.` : `${min} Min.`;
  }
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
      case 'sling': return ['Starttempo', deNum(st.sling * scale * 3.6) + ' km/h'];
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
    { id: 'sling', title: 'Startrampe', sub: 'Startbooster', c1: '#2bb673', c2: '#1b7f55' },
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
  function updateBadges() {
    const n = claimableCount();
    for (const id of ['mBadge', 'mBadge2']) { const b = $(id); b.hidden = n === 0; b.textContent = n; }
    $('rbBadge').hidden = !canRebirth(save);
  }
  function nextGoal() {
    const z = save.bestZone;
    if (z >= ZONES.length - 1) return save.won ? 'Alles entdeckt. Jag deine Rekorde!' : 'Ziel: Andromeda';
    const nz = ZONES[z + 1];
    return 'Nächstes Ziel: ' + nz.name + ' · ' + fmtAlt(nz.A);
  }
  function updateMenu() {
    updateCoins(); updateBadges();
    $('mBest').textContent = save.stats.bestA > 0 ? fmtAlt(save.stats.bestA) : '–';
    $('mGoal').textContent = nextGoal();
    $('btnSound').setAttribute('aria-pressed', save.settings.sound ? 'true' : 'false');
    updateMetaHud();
    $('mMult').hidden = save.rebirths === 0;
    $('mMult').textContent = '×' + deNum(rebirthMult(save.rebirths), 1);
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
  function reasonText(r) { return { land: 'Gelandet', crash: 'Bruchlandung', splash: 'Platsch! Wasserlandung', skip: 'Zurück zur Erde', abort: 'Flug beendet', win: 'Andromeda erreicht!' }[r] || 'Flug beendet'; }
  function bestTip() {
    const nr = ROCKETS.find(R => !save.rockets.includes(R.id));
    if (nr && nr.rb > save.rebirths && canRebirth(save)) return `Die Rakete <b>${nr.name}</b> gibt es erst ab ${nr.rb} Rebirth${nr.rb > 1 ? 's' : ''}. Du bist bereit für den nächsten <b>Rebirth</b>!`;
    if (nr && nr.req <= save.bestZone && nr.rb <= save.rebirths && nr.cost <= save.coins) return `Du kannst dir die Rakete <b>${nr.name}</b> leisten. Schau im Hangar unter Raketen vorbei.`;
    const opts = UPGRADES.filter(u => (save.up[u.id] || 0) < u.max).map(u => ({ u, c: upgradeCost(u, save.up[u.id] || 0) })).filter(x => x.c <= save.coins);
    if (opts.length) {
      const pri = ['engine', 'tank', 'sling', 'aero', 'value'];
      opts.sort((a, b) => (pri.indexOf(a.u.id) + 1 || 9) - (pri.indexOf(b.u.id) + 1 || 9) || a.c - b.c);
      return `Bereit für ein Upgrade: <b>${opts[0].u.name}</b> kostet ${fmtNum(opts[0].c)} Münzen.`;
    }
    const claim = claimableCount();
    if (claim) return `Du hast <b>${claim}</b> erfüllte Quest${claim > 1 ? 's' : ''}. Hol dir die Belohnung unter Quests ab.`;
    if (canRebirth(save)) return `Du kannst einen <b>Rebirth</b> machen: Danach bekommst du für immer ×${deNum(rebirthMult(save.rebirths + 1), 1)} Münzen.`;
    if (nr && nr.rb > save.rebirths) return `Die Rakete <b>${nr.name}</b> gibt es ab ${nr.rb} Rebirth${nr.rb > 1 ? 's' : ''}. Erreiche ${ZONES[rebirthZone(save.rebirths)].name} für den nächsten Rebirth.`;
    if (nr && nr.req > save.bestZone) return `Erreiche <b>${ZONES[nr.req].name}</b>, um die Rakete ${nr.name} freizuschalten.`;
    return pick(['Zünde, wenn der Balken im Feld „Perfekt“ steht: Das gibt mehr Tempo und 10 % mehr Münzen.', 'Boost-Ringe geben Tempo und ein bisschen Treibstoff zurück.', 'Ballons platzen lassen gibt Auftrieb und Münzen.', 'Zünde den Turbo, während du Schub gibst: Er schiebt zusätzlich und kostet keinen Treibstoff.']);
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
        ${run.perfect ? '<div><span>Perfekte Zündung</span><span>+10 %</span></div>' : ''}
        ${d.recordBonus ? `<div><span>Rekordbonus</span><span>${fmtNum(d.recordBonus)}</span></div>` : ''}
        ${d.winBonus ? `<div><span>Andromeda-Prämie</span><span>${fmtNum(d.winBonus)}</span></div>` : ''}
        <div class="total"><span>Gesamt</span><span><i class="coin-ico"></i>${fmtNum(d.total)}</span></div>
      </div>
      <div class="mini">
        <div><b>${fmtSpeed(run.maxV)}</b><span>Spitze</span></div>
        <div><b>${deNum(run.time, 1)} s</b><span>Flugzeit</span></div>
        <div><b>${run.rings}</b><span>Ringe</span></div>
        <div><b>${run.cans}</b><span>Kanister</span></div>
      </div>
      <div class="xp-line"><span class="lvl-pill"><b>${save.level}</b><i><u style="width:${(clamp(save.xp / xpForLevel(save.level), 0, 1) * 100).toFixed(1)}%"></u></i></span><span>+${d.lv.xp} XP${d.lv.ups.length ? ` · <b>Level ${d.lv.ups[d.lv.ups.length - 1].level}!</b> ${d.lv.ups.map(u => u.text).join(', ')}` : ''}</span></div>
      ${d.newly.length ? `<div class="done-list">${shown.map(() => '<div>✓ <span></span></div>').join('')}${more > 0 ? `<div class="muted">und ${more} weitere – Belohnungen unter Quests</div>` : ''}</div>` : ''}
      <div class="tipbox">${bestTip()}</div>
      <div class="row stretch"><button class="btn" id="resHangar">Hangar</button><button class="btn primary" id="resAgain">Weiter</button></div>`;
    sheet.querySelectorAll('.done-list span').forEach((s, i) => { s.textContent = 'Quest erfüllt: ' + shown[i].text; });
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
    m.scale.setScalar((R.look.model ? 12 : 9) / m.userData.length);   // the slim real launchers get a longer frame
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
      $('hgFoot').textContent = 'Neue Raketen schaltest du mit höheren Zonen frei, die stärksten zusätzlich mit Rebirths.';
      const maxT = ROCKETS[ROCKETS.length - 1];
      const bar = (v, m) => `style="--w:${clamp(v / m * 100, 4, 100).toFixed(0)}%"`;
      body.innerHTML = '<div class="grid">' + ROCKETS.map(R => {
        const own = save.rockets.includes(R.id), sel = save.rocket === R.id, unlocked = R.req <= save.bestZone && R.rb <= save.rebirths;
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
        else if (R.rb > save.rebirths) btn = `<button class="btn" disabled>Ab ${R.rb} Rebirth${R.rb > 1 ? 's' : ''}</button>`;
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
        try { c.getContext('2d').drawImage(rocketPreview(R, !save.rockets.includes(R.id) && (R.req > save.bestZone || R.rb > save.rebirths)), 0, 0); } catch (e) { /* preview unavailable */ }
      });
    } else if (hangarTab === 'missions') {
      ensureDaily();
      const d = save.daily;
      $('hgFoot').textContent = `${Object.keys(save.claimed).length} von ${MISSIONS.length} Quests abgeschlossen.`;
      const reward = (v) => `<span class="reward"><i class="coin-ico"></i>${fmtNum(v)}</span>`;
      const daily = d.quests.map((q, i) => {
        const done = dailyDone(q), pct = clamp(q.prog / q.goal, 0, 1) * 100;
        const prog = q.k === 'zone' ? (done ? 'Geschafft' : `Bisher: ${ZONES[q.prog] ? ZONES[q.prog].name : '–'}`) : `${fmtNum(Math.min(q.prog, q.goal))} / ${fmtNum(q.goal)}`;
        const btn = q.claimed ? '<span class="tag-done">Erledigt</span>' : done ? `<button class="btn primary" data-dclaim="${i}">Abholen</button>` : reward(q.reward);
        return `<div class="mission${q.claimed ? ' claimed' : done ? ' claimable' : ''}"><div class="m-text">${dailyText(q)}</div>${btn}<div class="m-prog"><div class="lvl-bar"><i style="width:${pct.toFixed(1)}%"></i></div><span>${prog}</span></div></div>`;
      }).join('');
      const all = d.quests.every(q => q.claimed);
      const chest = `<div class="mission chest${d.bonusClaimed ? ' claimed' : all ? ' claimable' : ''}"><div class="m-text">Tagesbonus: alle drei Quests abholen</div>${d.bonusClaimed ? '<span class="tag-done">Erledigt</span>' : all ? '<button class="btn gold" data-dbonus="1">Bonus holen</button>' : reward(d.bonus)}</div>`;
      const groups = {};
      for (const m of MISSIONS) (groups[m.g] = groups[m.g] || []).push(m);
      body.innerHTML = `<section class="daily-box"><div class="daily-head"><h3>Tages-Quests</h3><span class="timer">Neue Quests in ${untilMidnight()}</span></div><div class="m-list">${daily}${chest}</div></section>` +
        Object.entries(groups).map(([g, list]) => `<div class="m-group">${g}</div><div class="m-list">` + list.map(m => {
        const v = missionValue(m, false), done = v >= m.goal, claimed = !!save.claimed[m.id];
        const logish = m.t === 'alt' || m.t === 'speed' || m.t === 'runCoins' || m.t === 'rocketAlt' || m.t === 'earned';
        const pct = clamp(logish ? Math.log10(1 + v) / Math.log10(1 + m.goal) : v / m.goal, 0, 1) * 100;
        const prog = m.t === 'alt' || m.t === 'rocketAlt' ? `${fmtAlt(Math.min(v, m.goal))} / ${fmtAlt(m.goal)}` : m.t === 'speed' ? `${fmtSpeed(Math.min(v, m.goal))} / ${fmtSpeed(m.goal)}`
          : m.t === 'playTime' ? `${Math.floor(Math.min(v, m.goal) / 60)} / ${m.goal / 60} min` : `${fmtNum(Math.min(v, m.goal))} / ${fmtNum(m.goal)}`;
        const btn = claimed ? '<span class="tag-done">Erledigt</span>' : done ? `<button class="btn primary" data-claim="${m.id}"><i class="coin-ico"></i>${fmtNum(m.reward)}</button>` : reward(m.reward);
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
      if (!R || save.rockets.includes(R.id) || R.cost > save.coins || R.req > save.bestZone || R.rb > save.rebirths) { Sfx.deny(); return; }
      save.coins -= R.cost; save.rockets.push(R.id); save.rocket = R.id;
      persist(); Sfx.buy(); checkMissions(false); renderHangar();
      toast(R.name + ' ist startklar!', '', true);
    } else if (b.dataset.select) {
      save.rocket = b.dataset.select; persist(); Sfx.click(); renderHangar();
    } else if (b.dataset.claim) {
      claimMission(b.dataset.claim); renderHangar();
    } else if (b.dataset.dclaim) {
      claimDaily(+b.dataset.dclaim); renderHangar();
    } else if (b.dataset.dbonus) {
      claimDailyBonus(); renderHangar();
    }
  });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { Sfx.click(); hangarTab = t.dataset.tab; renderHangar(); $('tabBody').scrollTop = 0; }));

  // ---------- rebirth ----------
  const REBIRTH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/><path d="M12 8l1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z" fill="currentColor" stroke-width="1"/></svg>';
  function openRebirth() { $('rebirth').hidden = false; G.overlay = 'rebirth'; renderRebirth(false); }
  function closeRebirth() { $('rebirth').hidden = true; G.overlay = null; if (G.state === 'menu') updateMenu(); }
  function renderRebirth(confirm) {
    const n = save.rebirths, z = rebirthZone(n), ready = canRebirth(save);
    const pct = clamp((save.life.bestZone + 1) / (z + 1), 0, 1) * 100;
    const unlocks = ROCKETS.filter(R => R.rb === n + 1).map(R => R.name);
    const unlockText = unlocks.length ? `Schaltet frei: Rakete${unlocks.length > 1 ? 'n' : ''} <b>${unlocks.join(' und ')}</b>` : '';
    $('rebirthBody').innerHTML = `
      <div class="rb-top"><div class="rb-icon">${REBIRTH_SVG}</div><div><h2>Rebirth</h2><div class="rb-count">${n === 0 ? 'Noch kein Rebirth' : n === 1 ? '1 Rebirth' : n + ' Rebirths'}</div></div></div>
      <div class="rb-mult"><div><span>Münzen jetzt</span><b>×${deNum(rebirthMult(n), 1)}</b></div><div class="rb-arrow">➜</div><div class="next"><span>Nach dem Rebirth</span><b>×${deNum(rebirthMult(n + 1), 1)}</b></div></div>
      <div class="rb-req${ready ? ' ok' : ''}">
        <div>Ziel für diesen Rebirth: <b>${ZONES[z].name}</b> (${fmtAlt(ZONES[z].A)})</div>
        <div class="lvl-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="muted">${ready ? 'Geschafft! Du kannst jetzt neu starten.' : 'Seit dem letzten Rebirth erreicht: ' + ZONES[save.life.bestZone].name}</div>
      </div>
      <div class="rb-lists">
        <div class="lose"><b>Wird zurückgesetzt</b><ul><li>Deine Münzen (${fmtNum(save.coins)})</li><li>Alle Upgrades</li><li>Alle Raketen (zurück zur Funke)</li></ul></div>
        <div class="keep"><b>Bleibt dir</b><ul><li>Rekorde und Logbuch</li><li>Quests und Belohnungen</li><li>Der Münz-Bonus für immer</li></ul></div>
      </div>
      ${unlockText ? `<div class="rb-unlock">${unlockText}</div>` : ''}
      ${confirm ? '<div class="rb-confirm"><b>Wirklich neu starten?</b><div class="row stretch"><button class="btn" id="rbNo">Abbrechen</button><button class="btn gold" id="rbYes">Ja, Rebirth!</button></div></div>'
        : `<button class="btn gold big" id="rbGo" ${ready ? '' : 'disabled'}>${ready ? 'Rebirth' : 'Noch nicht bereit'}</button>`}`;
    if (confirm) { $('rbNo').onclick = () => { Sfx.click(); renderRebirth(false); }; $('rbYes').onclick = doRebirth; }
    else $('rbGo').onclick = () => { Sfx.click(); renderRebirth(true); };
  }
  function doRebirth() {
    if (!applyRebirth(save)) { Sfx.deny(); return; }
    stats = computeStats(save);
    ensureDaily(); checkMissions(false); persist();
    $('rebirth').hidden = true; G.overlay = null;
    toMenu();
    G.flash = 0.7; G.flashRgb = [255, 214, 90];
    Sfx.perfect();
    showBanner('Rebirth ' + save.rebirths, 'Münzen ×' + deNum(rebirthMult(save.rebirths), 1), 'Alles auf Anfang, aber jeder Flug bringt jetzt mehr.');
  }
  $('btnRebirth').onclick = () => { Sfx.init(); Sfx.click(); openRebirth(); };
  $('btnPets').onclick = () => { Sfx.init(); Sfx.click(); openPets(save.pets.length ? petTab : 'eggs'); };
  $('btnPetsX').onclick = () => { Sfx.click(); closePets(); };
  $('btnGifts').onclick = () => { Sfx.init(); Sfx.click(); openGifts(); };
  $('btnGiftsX').onclick = () => { Sfx.click(); closeGifts(); };
  $('btnWheel').onclick = () => { Sfx.init(); Sfx.click(); openWheel(); };
  $('btnWheelX').onclick = () => { Sfx.click(); closeWheel(); };
  $('btnLogin').onclick = () => { Sfx.init(); Sfx.click(); openLogin(); };
  $('btnLoginX').onclick = () => { Sfx.click(); closeLogin(); };
  $('giftBody').addEventListener('click', e => {
    const b = e.target.closest('[data-gift]');
    if (!b) return;
    const i = +b.dataset.gift;
    if (!giftReady(i)) return;
    sess.gifts[i] = 1;
    Sfx.perfect();
    toast('Geschenk: ' + grant(GIFTS[i]), '★', true);
    renderGifts();
  });
  $('btnRebirthX').onclick = () => { Sfx.click(); closeRebirth(); };
  $('btnHangarX').onclick = () => { Sfx.click(); closeHangar(); };

  // ================= companions, rewards, level =================
  // the session counts play time for the gifts; boosts tick down while the game is open
  const sess = { sec: 0, gifts: {}, loginShown: false, saveT: 0, hudT: 0 };
  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m}:${String(s).padStart(2, '0')}`;
  }
  const luckNow = () => boostActive(save, 'luck') ? 2 : 1;
  function rewardLabel(rw) {
    if (rw.kind === 'coins') return `${fmtNum(coinPack(save, rw.k))} Münzen`;
    if (rw.kind === 'boost') return `${rw.min || rw.min2} Min. ${BOOSTS[rw.boost].name}`;
    return rw.luck > 1 ? `Glücks-Ei (${rw.luck}× Glück)` : 'Gratis-Ei';
  }
  // pays out a reward from the calendar, a gift, the wheel, a code or a level; returns what it was
  function grant(rw) {
    let text = rewardLabel(rw);
    if (rw.kind === 'coins') { const c = coinPack(save, rw.k); save.coins += c; save.stats.earned += c; }
    else if (rw.kind === 'boost') { save.boosts[rw.boost] = (save.boosts[rw.boost] || 0) + (rw.min || rw.min2) * 60; }
    else {
      const e = bestEgg(save);
      if (save.pets.length >= PET_MAX) { const c = coinPack(save, 2); save.coins += c; save.stats.earned += c; text = `${fmtNum(c)} Münzen (Begleiter-Platz voll)`; }
      else queueHatch(e, [hatchPet(save, e, rw.luck * luckNow())]);
    }
    stats = computeStats(save);
    persist(); updateCoins(); updateBadges(); updateMetaHud();
    return text;
  }

  // ---------- login calendar ----------
  // the next of seven rewards can be taken once a day; a missed day pauses the calendar, it never resets
  const loginReady = () => save.login.day !== dayKey();
  function openLogin() { $('login').hidden = false; sess.prevOv = G.overlay; G.overlay = 'login'; renderLogin(); }
  function closeLogin() { $('login').hidden = true; G.overlay = sess.prevOv || null; sess.prevOv = null; if (G.state === 'menu') updateMenu(); }
  function renderLogin() {
    const ready = loginReady(), step = save.login.step;
    $('loginBody').innerHTML = `<div class="cal">${LOGIN_REWARDS.map((rw, i) => {
      const cls = i < step ? 'got' : i === step && ready ? 'now' : '';
      return `<div class="cal-day ${cls}${i === 6 ? ' big' : ''}"><span class="cal-n">Tag ${i + 1}</span><span class="cal-ico">${rewardIcon(rw)}</span><span class="cal-t">${rewardLabel(rw)}</span>${i < step ? '<span class="cal-ok">✓</span>' : ''}</div>`;
    }).join('')}</div>
      <p class="muted cal-note">${ready ? 'Deine Belohnung für heute wartet!' : 'Heute schon abgeholt. Morgen gibt es die nächste Belohnung.'} Verpasst du einen Tag, geht es einfach beim nächsten Mal weiter.</p>
      <button class="btn primary big" id="loginGo" ${ready ? '' : 'disabled'}>${ready ? 'Abholen' : 'Morgen wieder'}</button>`;
    $('loginGo').onclick = () => {
      if (!loginReady()) return;
      const rw = LOGIN_REWARDS[save.login.step];
      save.login.day = dayKey(); save.login.step = (save.login.step + 1) % 7;
      Sfx.perfect();
      const t = grant(rw);
      toast('Tagesbelohnung: ' + t, '★', true);
      renderLogin();
    };
  }
  function rewardIcon(rw) {
    if (rw.kind === 'coins') return '<i class="coin-ico big"></i>';
    if (rw.kind === 'boost') return `<i class="boost-ico" style="--bc:${BOOSTS[rw.boost].color}">${rw.boost === 'coins' ? '2×' : '★'}</i>`;
    return `<i class="egg-mini" style="--c:${rw.luck > 1 ? '#ffc928' : '#7bd35a'}"></i>`;
  }

  // ---------- gifts for playing ----------
  function giftReady(i) { return !sess.gifts[i] && sess.sec >= GIFTS[i].min * 60; }
  function openGifts() { $('gifts').hidden = false; G.overlay = 'gifts'; renderGifts(); }
  function closeGifts() { $('gifts').hidden = true; G.overlay = null; if (G.state === 'menu') updateMenu(); }
  function renderGifts() {
    $('giftBody').innerHTML = `<div class="gift-grid">${GIFTS.map((g, i) => {
      const got = sess.gifts[i], ready = giftReady(i);
      const btn = got ? '<span class="tag-done">Geöffnet</span>' : ready ? `<button class="btn primary" data-gift="${i}">Öffnen</button>` : `<span class="gift-t" data-gt="${i}">${fmtClock(g.min * 60 - sess.sec)}</span>`;
      return `<div class="gift ${got ? 'got' : ready ? 'ready' : ''}"><div class="gift-box"></div><div class="gift-r">${rewardLabel(g)}</div>${btn}</div>`;
    }).join('')}</div><p class="muted cal-note">Die Geschenke zählen deine Spielzeit seit dem Öffnen des Spiels.</p>`;
  }

  // ---------- wheel of fortune ----------
  let wheelSpin = 0, wheelBusy = false;
  function openWheel() { $('wheel').hidden = false; G.overlay = 'wheel'; renderWheel(); }
  function closeWheel() { if (wheelBusy) return; $('wheel').hidden = true; G.overlay = null; if (G.state === 'menu') updateMenu(); }
  function renderWheel() {
    const n = WHEEL.length, cols = ['#ff8a2a', '#35b6ff', '#43d15a', '#a463ff', '#ff4f5e', '#ffc928', '#35b6ff', '#ff4fd8'];
    const disc = $('wheelDisc');
    disc.style.background = `conic-gradient(${WHEEL.map((s, i) => `${cols[i]} ${i * 360 / n}deg ${(i + 1) * 360 / n}deg`).join(',')})`;
    disc.innerHTML = WHEEL.map((s, i) => `<span style="transform:rotate(${(i + 0.5) * 360 / n}deg)"><b>${s.label}</b></span>`).join('');
    updateWheelBtn();
  }
  function updateWheelBtn() {
    const free = Date.now() >= save.wheelNext, b = $('wheelGo');
    b.disabled = !free || wheelBusy;
    b.textContent = wheelBusy ? 'Dreht …' : free ? 'Gratis drehen!' : 'Nächster Dreh in ' + fmtClock((save.wheelNext - Date.now()) / 1000);
  }
  $('wheelGo').onclick = () => {
    if (wheelBusy || Date.now() < save.wheelNext) return;
    const i = wheelPick(), n = WHEEL.length;
    wheelBusy = true; save.wheelNext = Date.now() + WHEEL_EVERY; persist();
    // land the middle of segment i under the pointer at the top, after five full turns
    wheelSpin += 360 * 5 + (360 - ((i + 0.5) * 360 / n) - (wheelSpin % 360));
    $('wheelDisc').style.transform = `rotate(${wheelSpin}deg)`;
    $('wheelRes').textContent = '';
    Sfx.click(); updateWheelBtn();
    setTimeout(() => {
      wheelBusy = false;
      const t = grant(WHEEL[i]);
      $('wheelRes').textContent = 'Gewonnen: ' + t;
      Sfx.perfect(); updateWheelBtn();
    }, 4300);
  };

  // ---------- codes ----------
  $('codeGo').onclick = () => {
    const c = $('codeIn').value.trim().toUpperCase().replace(/\s+/g, '');
    const rw = CODES[c];
    if (!rw) { $('codeMsg').textContent = 'Diesen Code gibt es nicht.'; Sfx.deny(); return; }
    if (save.codes[c]) { $('codeMsg').textContent = 'Den Code hast du schon eingelöst.'; Sfx.deny(); return; }
    save.codes[c] = 1;
    const t = grant(rw);
    $('codeMsg').textContent = 'Eingelöst: ' + t; $('codeIn').value = '';
    Sfx.buy();
  };

  // ---------- pilot level ----------
  function addXp(run) {
    const xp = flightXp(run), ups = [];
    save.xp += xp;
    while (save.xp >= xpForLevel(save.level)) {
      save.xp -= xpForLevel(save.level); save.level++;
      // every fifth level a boost, otherwise coins
      const rw = save.level % 5 === 0 ? { kind: 'boost', boost: save.level % 10 === 0 ? 'luck' : 'coins', min: 10 } : { kind: 'coins', k: 1 + save.level / 10 };
      ups.push({ level: save.level, text: grant(rw) });
    }
    return { xp, ups };
  }

  // ---------- boosts and the little HUD bits ----------
  function tickMeta(dt) {
    if (!dt) return;
    sess.sec += dt;
    let ended = false;
    for (const k of Object.keys(BOOSTS)) if (save.boosts[k] > 0) { save.boosts[k] = Math.max(0, save.boosts[k] - dt); if (save.boosts[k] === 0) ended = true; }
    if (ended && G.state !== 'flight') stats = computeStats(save);
    if ((sess.saveT += dt) > 15) { sess.saveT = 0; persist(); }
    if ((sess.hudT += dt) > 0.5) { sess.hudT = 0; updateMetaHud(); }
  }
  function updateMetaHud() {
    const chips = Object.keys(BOOSTS).filter(k => save.boosts[k] > 0).map(k => `<span class="bchip" style="--bc:${BOOSTS[k].color}">${BOOSTS[k].name} <b>${fmtClock(save.boosts[k])}</b></span>`).join('');
    for (const id of ['mBoosts', 'hBoosts']) { const el = $(id); if (el.innerHTML !== chips) el.innerHTML = chips; }
    $('lvlNum').textContent = save.level;
    $('lvlBar').style.width = (clamp(save.xp / xpForLevel(save.level), 0, 1) * 100).toFixed(1) + '%';
    const gi = GIFTS.findIndex((g, i) => !sess.gifts[i]);
    const gReady = GIFTS.some((g, i) => giftReady(i));
    $('giftT').textContent = gReady ? 'Öffnen!' : gi < 0 ? 'Alle' : fmtClock(GIFTS[gi].min * 60 - sess.sec);
    $('giftBadge').hidden = !gReady;
    const free = Date.now() >= save.wheelNext;
    $('wheelT').textContent = free ? 'Gratis!' : fmtClock((save.wheelNext - Date.now()) / 1000);
    $('wheelBadge').hidden = !free;
    $('loginBadge').hidden = !loginReady();
    if (!$('gifts').hidden) document.querySelectorAll('[data-gt]').forEach(el => { const i = +el.dataset.gt; if (giftReady(i)) renderGifts(); else el.textContent = fmtClock(GIFTS[i].min * 60 - sess.sec); });
    if (!$('wheel').hidden && !wheelBusy) updateWheelBtn();
  }
  // the calendar opens by itself once per visit when a reward is waiting
  function maybeLoginPopup() {
    if (sess.loginShown || !loginReady() || G.overlay) return;
    sess.loginShown = true;
    setTimeout(() => { if (G.state === 'menu' && !G.overlay) openLogin(); }, 600);
  }

  // ---------- pets: previews ----------
  const petPrevs = new Map();
  let petR = null;
  function petPreview(id, golden, unknown) {
    const key = id + (golden ? ':g' : '') + (unknown ? ':u' : '');
    if (petPrevs.has(key)) return petPrevs.get(key);
    if (!petR) {
      const r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setSize(200, 200, false); r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping;
      const s = new T.Scene();
      s.add(new T.HemisphereLight(0xffffff, 0x6070a0, 1.9));
      const d = new T.DirectionalLight(0xffffff, 2.2); d.position.set(2, 4, 6); s.add(d);
      const c = new T.PerspectiveCamera(30, 1, 0.1, 100); c.position.set(0, 0.6, 8.4); c.lookAt(0, 0.1, 0);
      petR = { r, s, c };
    }
    const m = Models.pet(PET_BY_ID[id], golden);
    m.rotation.y = -0.35;
    petR.s.add(m); petR.r.render(petR.s, petR.c); petR.s.remove(m);
    m.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    const out = document.createElement('canvas'); out.width = 200; out.height = 200;
    const g = out.getContext('2d');
    if (unknown) g.filter = 'brightness(0) opacity(0.55)';
    g.drawImage(petR.r.domElement, 0, 0);
    petPrevs.set(key, out);
    return out;
  }
  function paintPetCanvases(root) {
    root.querySelectorAll('canvas[data-pet]').forEach(c => {
      try { c.getContext('2d').drawImage(petPreview(c.dataset.pet, c.dataset.gold === '1', c.dataset.unk === '1'), 0, 0, c.width, c.height); } catch (e) { /* preview unavailable */ }
    });
  }

  // ---------- pets: the companion sheet ----------
  let petTab = 'eggs';
  function openPets(tab) { petTab = tab || petTab; $('pets').hidden = false; G.overlay = 'pets'; renderPets(); $('petBody').scrollTop = 0; }
  function closePets() { $('pets').hidden = true; G.overlay = null; stats = computeStats(save); if (G.state === 'menu') updateMenu(); }
  const pctTxt = v => (v * 100 >= 10 ? Math.round(v * 100) : deNum(v * 100, 1)) + ' %';
  function petLine(p, golden) { return `+${pctTxt(petBonusValue(p, golden))} ${PET_TYPES[p.type]}`; }
  function renderPets() {
    document.querySelectorAll('.ptab').forEach(t => t.setAttribute('aria-selected', t.dataset.ptab === petTab ? 'true' : 'false'));
    $('ptCoins').textContent = fmtNum(save.coins);
    const body = $('petBody'), luck = luckNow();
    if (petTab === 'eggs') {
      const tot = PET_RARITIES.reduce((a, r, i) => a + r.w * (i > 0 ? luck : 1), 0);
      $('petFoot').textContent = `${save.pets.length} / ${PET_MAX} Begleiter${luck > 1 ? ' · 2× Glück aktiv!' : ''}`;
      body.innerHTML = '<div class="egg-grid">' + EGGS.map(e => {
        const open = eggUnlocked(save, e), full = save.pets.length >= PET_MAX;
        const odds = e.pets.map(p => {
          const w = PET_RARITIES[p.rarity].w * (p.rarity > 0 ? luck : 1), known = save.index[p.id];
          return `<div class="odd" style="--rc:${PET_RARITIES[p.rarity].color}"><canvas width="60" height="60" data-pet="${p.id}" data-unk="${known ? 0 : 1}"></canvas><span>${known ? p.name : '???'}</span><b>${deNum(w / tot * 100, w / tot < 0.01 ? 1 : 0)} %</b></div>`;
        }).join('');
        const btn = (k) => `<button class="btn${save.coins >= e.cost * k ? ' primary' : ''}" data-hatch="${e.id}" data-k="${k}" ${open && !full && save.coins >= e.cost * k && save.pets.length + k <= PET_MAX ? '' : 'disabled'}>${k > 1 ? k + '× ' : ''}<i class="coin-ico"></i>${fmtNum(e.cost * k)}</button>`;
        return `<div class="egg-card${open ? '' : ' locked'}"><div class="egg-head"><div class="egg-shape" style="--c:${e.color}"></div><div><div class="up-name">${e.name}</div><div class="up-lvl">${open ? (eggCompleted(save, e) ? 'Sammlung komplett: +5 % Münzen' : `${e.pets.filter(p => save.index[p.id]).length} / 5 entdeckt`) : 'Erreiche ' + ZONES[e.zone].name}</div></div></div>
          <div class="odds">${odds}</div>${open ? `<div class="row stretch">${btn(1)}${btn(3)}</div>` : `<button class="btn" disabled>Erreiche ${ZONES[e.zone].name}</button>`}</div>`;
      }).join('') + '</div>';
    } else if (petTab === 'inv') {
      const slots = petSlots(save), eq = new Set(save.equipped);
      const rank = it => (eq.has(it.uid) ? 1e6 : 0) + petPower(PET_BY_ID[it.id], it.golden);
      const list = save.pets.slice().sort((a, b) => rank(b) - rank(a));
      const fusable = [...new Set(save.pets.map(it => it.id))].filter(id => canFuse(save, id));
      const b = petBonus(save);
      $('petFoot').textContent = `${save.pets.length} / ${PET_MAX} Begleiter · Plätze steigen mit Rebirths`;
      body.innerHTML = `<div class="pet-bar"><div class="pet-sum"><b>Ausgerüstet ${save.equipped.length} / ${slots}</b><span>Münzen +${pctTxt(b.coins)} · Schub +${pctTxt(b.thrust)} · Tank +${pctTxt(b.fuel)} · Magnet +${pctTxt(b.magnet)}</span></div>
        <div class="row"><button class="btn gold" id="petBest" ${save.pets.length ? '' : 'disabled'}>Beste ausrüsten</button><button class="btn purple" id="petFuse" ${fusable.length ? '' : 'disabled'}>Gold-Fusion${fusable.length ? ' (' + fusable.length + ')' : ''}</button><button class="btn" id="petClean" ${save.pets.some(it => !eq.has(it.uid) && PET_BY_ID[it.id].rarity === 0 && !it.golden) ? '' : 'disabled'}>Gewöhnliche abgeben</button></div></div>
        ${list.length ? '<div class="pet-grid">' + list.map(it => {
          const p = PET_BY_ID[it.id], on = eq.has(it.uid), R = PET_RARITIES[p.rarity];
          return `<div class="pet-card${on ? ' eq' : ''}${it.golden ? ' golden' : ''}" style="--rc:${R.color}"><canvas width="120" height="120" data-pet="${p.id}" data-gold="${it.golden ? 1 : 0}"></canvas>
            <div class="pet-name">${it.golden ? '★ ' : ''}${p.name}</div><div class="pet-rar">${it.golden ? 'Golden · ' : ''}${R.name}</div><div class="pet-bon">${petLine(p, it.golden)}</div>
            <div class="pet-act"><button class="btn${on ? '' : ' primary'}" data-eq="${it.uid}" ${on || save.equipped.length < slots ? '' : 'disabled'}>${on ? 'Ablegen' : 'Ausrüsten'}</button><button class="btn del" data-del="${it.uid}" aria-label="Abgeben" ${on ? 'disabled' : ''}>✕</button></div></div>`;
        }).join('') + '</div>' : '<p class="muted">Noch keine Begleiter. Öffne im Tab „Eier“ dein erstes Ei!</p>'}`;
      $('petBest').onclick = () => { equipBest(save); persist(); Sfx.click(); renderPets(); refreshPetMeshes(); };
      $('petFuse').onclick = () => {
        let n = 0;
        for (const id of fusable) while (canFuse(save, id)) { fusePets(save, id); n++; save.stats.fused++; }
        persist(); Sfx.perfect(); checkMissions(false); renderPets(); refreshPetMeshes();
        toast(n + ' goldene' + (n > 1 ? '' : 'r') + ' Begleiter fusioniert!', '★', true);
      };
      $('petClean').onclick = () => {
        const before = save.pets.length;
        save.pets = save.pets.filter(it => eq.has(it.uid) || it.golden || PET_BY_ID[it.id].rarity > 0);
        persist(); Sfx.click(); renderPets();
        toast((before - save.pets.length) + ' gewöhnliche Begleiter abgegeben', '');
      };
    } else {
      const found = Object.keys(save.index).length;
      $('petFoot').textContent = `${found} / ${PETS.length} entdeckt · jede komplette Ei-Sammlung: +5 % Münzen für immer`;
      body.innerHTML = EGGS.map(e => `<div class="idx-row${eggCompleted(save, e) ? ' done' : ''}"><div class="idx-head"><div class="egg-shape small" style="--c:${e.color}"></div><b>${e.name}</b><span>${eggCompleted(save, e) ? '+5 % Münzen' : e.pets.filter(p => save.index[p.id]).length + ' / 5'}</span></div>
        <div class="idx-pets">${e.pets.map(p => `<div class="idx-pet" style="--rc:${PET_RARITIES[p.rarity].color}"><canvas width="90" height="90" data-pet="${p.id}" data-unk="${save.index[p.id] ? 0 : 1}"></canvas><span>${save.index[p.id] ? p.name : '???'}</span></div>`).join('')}</div></div>`).join('');
    }
    paintPetCanvases(body);
  }
  $('petBody').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.hatch) {
      const egg = EGG_BY_ID[b.dataset.hatch], k = +b.dataset.k;
      if (!eggUnlocked(save, egg) || save.coins < egg.cost * k || save.pets.length + k > PET_MAX) { Sfx.deny(); return; }
      save.coins -= egg.cost * k;
      const items = [];
      for (let i = 0; i < k; i++) items.push(hatchPet(save, egg, luckNow()));
      persist(); checkMissions(false);
      queueHatch(egg, items);
      renderPets();
    } else if (b.dataset.eq) {
      const uid = +b.dataset.eq;
      if (save.equipped.includes(uid)) save.equipped = save.equipped.filter(u => u !== uid);
      else if (save.equipped.length < petSlots(save)) save.equipped.push(uid);
      persist(); Sfx.click(); renderPets(); refreshPetMeshes();
    } else if (b.dataset.del) {
      const uid = +b.dataset.del;
      save.pets = save.pets.filter(it => it.uid !== uid);
      persist(); Sfx.click(); renderPets();
    }
  });
  document.querySelectorAll('.ptab').forEach(t => t.addEventListener('click', () => { Sfx.click(); petTab = t.dataset.ptab; renderPets(); $('petBody').scrollTop = 0; }));

  // ---------- hatching ----------
  const hatchQ = [];
  function queueHatch(egg, items) { hatchQ.push({ egg, items }); if ($('hatch').hidden) nextHatch(); }
  function nextHatch() {
    const h = hatchQ.shift();
    if (!h) { $('hatch').hidden = true; G.overlay = sess.hatchPrev || null; sess.hatchPrev = null; if (!$('pets').hidden) renderPets(); return; }
    if ($('hatch').hidden) { sess.hatchPrev = G.overlay; $('hatch').hidden = false; G.overlay = 'hatch'; }
    const stage = $('hatchStage');
    stage.innerHTML = h.items.map(it => {
      const p = PET_BY_ID[it.id], R = PET_RARITIES[p.rarity];
      return `<div class="hatch-slot" style="--c:${h.egg.color};--rc:${R.color}"><div class="hatch-egg"></div><div class="hatch-pet"><div class="hatch-burst"></div><canvas width="200" height="200" data-pet="${p.id}"></canvas><div class="pet-name">${p.name}</div><div class="hatch-rar">${R.name}</div><div class="pet-bon">${petLine(p, false)}</div></div></div>`;
    }).join('');
    paintPetCanvases(stage);
    $('hatchOk').hidden = true;
    Sfx.click();
    setTimeout(() => {
      stage.querySelectorAll('.hatch-slot').forEach(s => s.classList.add('open'));
      const top = Math.max(...h.items.map(it => PET_BY_ID[it.id].rarity));
      if (top >= 3) { Sfx.perfect(); G.flash = 0.5; G.flashRgb = [255, 214, 90]; } else Sfx.buy();
      $('hatchOk').hidden = false; $('hatchOk').focus({ preventScroll: true });
    }, 1300);
  }
  $('hatchOk').onclick = () => { Sfx.click(); nextHatch(); };

  // ---------- pets around the rocket ----------
  let petMeshes = [], petKey = '';
  function refreshPetMeshes() {
    const key = save.equipped.join(',') + '|' + save.pets.filter(it => save.equipped.includes(it.uid)).map(it => it.id + it.golden).join(',');
    if (key === petKey) return;
    petKey = key;
    for (const m of petMeshes) { scene.remove(m); m.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    petMeshes = save.equipped.map(uid => save.pets.find(it => it.uid === uid)).filter(Boolean).map(it => {
      const m = Models.pet(PET_BY_ID[it.id], it.golden);
      scene.add(m);
      return m;
    });
  }
  const _pv = new T.Vector3();
  function updatePets(dt) {
    refreshPetMeshes();
    if (!petMeshes.length || !rocketMesh) return;
    const n = petMeshes.length, onPad = G.state === 'menu' || G.state === 'charge' || G.state === 'title';
    const R = rocketMesh.userData.radius || 1, L = rocketMesh.userData.length || 7;
    const a = rocketMesh.rotation.z, ca = Math.cos(a), sa = Math.sin(a);
    petMeshes.forEach((m, i) => {
      m.visible = rocketMesh.visible || onPad;
      const ph = G.t * 1.1 + i * TAU / n;
      if (onPad) {
        // they hover in a row on the camera side of the pad
        m.scale.setScalar(1.9);
        _pv.set(-15 + i * 4.2, PAD_Y + 17 + (i % 2) * 2.2 + Math.sin(G.t * 2 + i) * 0.5, 10);
      } else {
        // in flight they circle the rocket a little behind its middle
        m.scale.setScalar(Math.max(0.9, R * 0.95));
        const rad = R * 2.4 + 2.4;
        const rp = rocketMesh.position, back = L * 0.15, c = Math.cos(ph) * rad;
        _pv.set(rp.x - ca * back - sa * c, rp.y - sa * back + ca * c, rp.z + Math.sin(ph) * rad);
      }
      m.position.lerp(_pv, onPad ? 1 - Math.exp(-dt * 6) : 1);
      m.lookAt(camera.position);
      m.userData.update(G.t);
    });
  }

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
  // graphics quality, in the help sheet. High: bloom, anti-aliasing and sharper shadows; low: faster on phones
  function updateGfx() {
    $('btnGfxHigh').setAttribute('aria-pressed', World.lowPower ? 'false' : 'true');
    $('btnGfxLow').setAttribute('aria-pressed', World.lowPower ? 'true' : 'false');
  }
  $('btnGfxHigh').onclick = () => { Sfx.click(); World.setQuality(true); updateGfx(); };
  $('btnGfxLow').onclick = () => { Sfx.click(); World.setQuality(false); updateGfx(); };
  $('btnHelp').onclick = () => { updateGfx(); $('help').hidden = false; G.overlay = 'help'; };
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
        Sfx.thrust(r.turboT > 0 ? 1.3 : r.boosting ? 1 : Math.min(0.7, G.heat * 0.7), airDensity(Math.max(0, r.y)) < 0.05);
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
    updatePets(dt);
    tickMeta(active ? dt : 0);
    updateCamera(dt);
    pad.userData.lamp.emissiveIntensity = Math.sin(G.t * 4) > 0.2 ? 2.4 : 0.2;
    if (pad.userData.sock) pad.userData.sock.rotation.y = Math.sin(G.t * 1.7) * 0.25;
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
    // the NASA models parse in the background: rebuild the rocket and the hangar pictures once they are in
    Models.onModels(() => {
      previews.clear();
      if ((ROCKET_BY_ID[save.rocket] || ROCKETS[0]).look.model) { rocketMeshId = ''; setRocketMesh(save.rocket); }
      if (!$('hangar').hidden) renderHangar();
    });
    G.state = 'title';
    showScreen('title');
    if (save.stats.flights > 0) $('btnPlay').textContent = 'Weiterspielen';
    requestAnimationFrame(t => { lastNow = t; requestAnimationFrame(frame); });
    window.__sternenschleuder = { G, cam, get save() { return save; }, set save(v) { save = normalizeSave(v); stats = computeStats(save); setRocketMesh(save.rocket); if (G.state === 'menu') updateMenu(); }, toMenu, enterCharge, launch };
  }
  if (window.claude?.hot?.ready) window.claude.hot.ready(boot); else boot(window.claude?.hot?.data ?? {});
})();
