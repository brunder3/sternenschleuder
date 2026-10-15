
'use strict';
/* Sternenschleuder core: data, formulas and flight physics.
   No DOM or WebGL access here, so the balance can be simulated headless (see README). */

// Altitude zones. H = physical game height (world units), A = displayed altitude in metres.
const ZONES = [
  { id:'wiese',   name:'Startwiese',         H:0,     A:0,        val:1,     desc:'Hier fängt alles an.' },
  { id:'voegel',  name:'Vogelzug',           H:800,   A:80,       val:2,     desc:'Zugvögel kreuzen die Flugbahn.' },
  { id:'wolken',  name:'Wolkenmeer',         H:1100,  A:500,      val:4,     desc:'Ab hier wird alles weiß.' },
  { id:'jet',     name:'Jetstream',          H:1500,  A:3000,     val:9,     desc:'Kräftiger Höhenwind schiebt dich nach rechts.' },
  { id:'strato',  name:'Stratosphäre',       H:2050,  A:12000,    val:11,    desc:'Über dem Wetter beginnt die Ozonschicht.' },
  { id:'meso',    name:'Mesosphäre',         H:2800,  A:50000,    val:14,    desc:'Hier verglühen die Sternschnuppen.' },
  { id:'space',   name:'Weltraum',           H:3850,  A:100000,   val:17,    desc:'Kármán-Linie überquert: 100 km über dem Meer.' },
  { id:'orbit',   name:'Erdumlaufbahn',      H:5300, A:400000,   val:30,   desc:'Auf dieser Höhe kreist die Raumstation.' },
  { id:'geo',     name:'Geostationäre Bahn', H:7250, A:35786000, val:35,   desc:'Satelliten scheinen hier stillzustehen.' },
  { id:'moon',    name:'Mond',               H:9950, A:3.844e8,  val:55,   desc:'384.400 km: Grüße an den Erdtrabanten.' },
  { id:'mars',    name:'Mars',               H:13600, A:7.8e10,   val:70,  desc:'Der rote Planet zieht vorbei.' },
  { id:'belt',    name:'Asteroidengürtel',   H:18650, A:3.2e11,   val:85,  desc:'Felsbrocken, so weit das Auge reicht.' },
  { id:'jupiter', name:'Jupiter',            H:25550, A:6.3e11,   val:110,  desc:'Sein roter Fleck ist ein uralter Sturm.' },
  { id:'saturn',  name:'Saturn',             H:34950, A:1.28e12,  val:190, desc:'Ringe aus Eis und Gestein.' },
  { id:'edge',    name:'Heliopause',         H:47900, A:1.8e13,   val:260, desc:'Hier endet der Sonnenwind. Dahinter: die Sterne.' },
];
const ZH = Object.fromEntries(ZONES.map(z => [z.id, z.H]));
// height a fraction f of the way from zone id to the next zone (f may be negative)
function zoneFrac(id, f) {
  const i = ZONES.findIndex(z => z.id === id);
  const a = ZONES[i].H, b = i < ZONES.length - 1 ? ZONES[i + 1].H : a * 1.25;
  return a + (b - a) * (f || 0);
}
const GOAL_H = ZH.edge;
const SPACE_H = ZH.space;
const HEIGHT_BONUS = 14;

const PHYS = {
  G0: 520,          // gravity at the ground (u/s²)
  GH: 30000,        // gravity falls off as 1/(1+H/GH)
  RHO_H: 1000,      // scale height of the atmosphere
  DRAG: 0.0015,     // quadratic drag coefficient (sets the rocket's top speed)
  SPACE_K: 1,       // drag multiplier in vacuum (gameplay: speeds stay readable)
  LIFT_K: 0.0006,   // wing lift factor
  TURBO_MULT: 2.3,  // thrust while boosting with the turbo lit
  TURBO_TIME: 1.4,
  // the rocket always flies forward: its nose stays between these pitch angles (radians)
  PITCH_MIN: -1.15,
  PITCH_MAX: 1.4,
  // catapult: aim range on the pad and the power meter
  LAUNCH_MIN: 0.35,
  LAUNCH_MAX: 1.22,
  LAUNCH_DEFAULT: 0.8,
  METER_SPEED: 1.35,   // full sweeps of the power meter per second
  PERFECT: 0.92,       // meter value from which a launch counts as perfect
  PERFECT_BONUS: 1.15,
  MIN_VX: 40,          // u/s the rocket always moves ahead
};

// launch speed in u/s for a meter value p in [0, 1]
function launchSpeed(st, p) {
  const perfect = p >= PHYS.PERFECT;
  return st.sling * (0.35 + 0.65 * p) * (perfect ? PHYS.PERFECT_BONUS : 1);
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function zoneIndexAt(H) {
  let i = 0;
  for (let k = 0; k < ZONES.length; k++) if (H >= ZONES[k].H) i = k;
  return i;
}
function logInterp(H, key) {
  const i = zoneIndexAt(H);
  if (i >= ZONES.length - 1) {
    const a = ZONES[ZONES.length - 2], b = ZONES[ZONES.length - 1];
    return b[key] * Math.pow(b[key] / a[key], (H - b.H) / (b.H - a.H));
  }
  const a = ZONES[i], b = ZONES[i + 1];
  return a[key] * Math.pow(b[key] / a[key], (H - a.H) / (b.H - a.H));
}
function altitudeAt(H) {
  if (H <= 0) return 0;
  if (H < ZONES[1].H) return H * ZONES[1].A / ZONES[1].H;
  return logInterp(H, 'A');
}
// metres per second per world unit of speed at height H (display only): 216 km/h at launch, ~300 km/s at the Heliopause
function speedScaleAt(H) { return 0.1 * Math.pow(1 + Math.max(0, H) / 800, 1.6); }
function coinValueAt(H) {
  H = Math.max(0, H);
  return logInterp(H, 'val');
}
function gravity(H) { return PHYS.G0 / (1 + Math.max(0, H) / PHYS.GH); }
function airDensity(H) { return Math.exp(-Math.max(0, H) / PHYS.RHO_H); }
// sky colours (zenith, middle, horizon) by height
const SKY_STOPS = [
  { H: 0,                     c: ['#3f9cf2', '#7cc2fb', '#d6f0ff'] },
  { H: ZH.wolken,             c: ['#3590ec', '#70b8f6', '#c8e8ff'] },
  { H: ZH.jet,                c: ['#2a6fd6', '#5aa2ee', '#a8d6fb'] },
  { H: ZH.strato,             c: ['#1a46a6', '#3a76cf', '#86b8ee'] },
  { H: ZH.meso,               c: ['#0e2266', '#28458f', '#6476bd'] },
  { H: zoneFrac('meso', 0.6), c: ['#070f3a', '#16205a', '#3c3a80'] },
  { H: ZH.space,              c: ['#03061a', '#0a0f30', '#1a1a4c'] },
  { H: ZH.moon,               c: ['#04040f', '#0b0b1e', '#17142e'] },
  { H: ZH.mars,               c: ['#100508', '#1e0b13', '#311422'] },
  { H: ZH.belt,               c: ['#07060a', '#110e16', '#1e1824'] },
  { H: ZH.jupiter,            c: ['#0d0905', '#1b130b', '#2c1d10'] },
  { H: ZH.saturn,             c: ['#0a0907', '#17150d', '#272113'] },
  { H: ZH.edge,               c: ['#070214', '#160b34', '#2c104e'] },
];
// chance that a cloud sits at height h (u)
function cloudDensity(h) {
  if (h < ZH.voegel * 0.35) return 0;
  return 0.18 * smooth(ZH.voegel * 0.35, ZH.voegel, h) * (1 - smooth(zoneFrac('wolken', 0.5), ZH.jet, h))
    + 0.5 * smooth(zoneFrac('voegel', 0.6), zoneFrac('wolken', 0.4), h) * (1 - smooth(zoneFrac('jet', 0.5), ZH.strato, h))
    + 0.12 * smooth(ZH.strato, zoneFrac('strato', 0.4), h) * (1 - smooth(zoneFrac('strato', 0.8), ZH.meso, h));
}
function windAt(H) { return 110 * smooth(zoneFrac('jet', -0.05), zoneFrac('jet', 0.25), H) * (1 - smooth(zoneFrac('jet', 0.8), ZH.strato, H)); }

// ---------- upgrades ----------
// cost(L) = base * e^(k * L/max): every upgrade ends at the same multiple of its first price
const UPGRADES = [
  { id:'sling', name:'Gummiband', max:20, base:24, k:20, desc:'Dickeres Gummi für einen kräftigeren Abschuss.' },
  { id:'engine', name:'Triebwerk', max:30, base:40, k:20, desc:'Mehr Schub, solange du Gas gibst.' },
  { id:'tank', name:'Tank', max:30, base:36, k:20, desc:'Größerer Tank, längere Brenndauer.' },
  { id:'aero', name:'Aerodynamik', max:20, base:120, k:20, desc:'Glattere Hülle, weniger Luftwiderstand.' },
  { id:'value', name:'Münzpräger', max:25, base:105, k:20, desc:'Jede Münze ist mehr wert.' },
  { id:'eff', name:'Einspritzung', max:15, base:330, k:20, desc:'Weniger Verbrauch bei gleichem Schub.' },
  { id:'magnet', name:'Münzmagnet', max:15, base:210, k:20, desc:'Zieht Münzen aus der Umgebung an.' },
  { id:'steer', name:'Steuerdüsen', max:10, base:90, k:20, desc:'Engere Kurven, präziseres Lenken.' },
  { id:'wings', name:'Gleitflügel', max:12, base:270, k:20, desc:'Auftrieb in der Luft für lange Gleitflüge.' },
  { id:'fuelfind', name:'Kanister-Radar', max:12, base:420, k:20, desc:'Mehr und vollere Treibstoffkanister am Himmel.' },
  { id:'luck', name:'Glückspilz', max:12, base:600, k:20, desc:'Mehr Gold, mehr Edelsteine.' },
  { id:'armor', name:'Schutzschild', max:6, base:300, k:9.1, desc:'Wehrt je Ladung einen Zusammenstoß ab.' },
  { id:'turbo', name:'Nachbrenner', max:5, base:600, k:9.3, desc:'Turbo-Zündungen pro Flug. Schiebt zusätzlich zum Booster und kostet keinen Treibstoff.' },
  { id:'bounce', name:'Sprungfedern', max:4, base:200, k:10.4, desc:'Prallt bei der Landung wieder ab und fliegt weiter.' },
];
const UPG = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

function niceRound(n) {
  if (n < 100) return Math.round(n);
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}
function upgradeCost(u, level) { return niceRound(u.base * Math.exp(u.k * level / u.max)); }

// ---------- rockets ----------
const ROCKETS = [
  { id:'funke', name:'Funke', cost:0, req:0, blurb:'Ein Silvesterkracher mit großen Träumen.',
    thrust:1, fuel:1, drag:1, handling:1, lift:1, magnet:1, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#f3ede0', accent:'#e2402f', trim:'#f6c445', nose:'cone', fins:'delta', len:.92, w:.85, boosters:0, stripes:3, windows:0, flame:'warm' } },
  { id:'sprudel', name:'Sprudel', cost:310, req:0, blurb:'Eine Limoflasche unter Druck. Mehr Tank, mehr Spaß.',
    thrust:1.08, fuel:1.2, drag:0.98, handling:1, lift:1, magnet:1, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#86dcc6', accent:'#e84a5f', trim:'#ffd166', nose:'blunt', fins:'round', len:.95, w:.95, boosters:0, stripes:1, windows:0, flame:'water' } },
  { id:'spatz', name:'Spatz', cost:1200, req:2, blurb:'Leicht, flink und erstaunlich ausdauernd.',
    thrust:1.16, fuel:1.4, drag:0.96, handling:1.15, lift:1.2, magnet:1, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#ffffff', accent:'#3b7ddd', trim:'#ffd54a', nose:'ogive', fins:'swept', len:1, w:.9, boosters:0, stripes:2, windows:1, flame:'warm' } },
  { id:'hummel', name:'Hummel', cost:2400, req:3, blurb:'Kurz, dick, unverwüstlich. Bringt eine Schildladung mit.',
    thrust:1.24, fuel:1.6, drag:0.94, handling:1, lift:1, magnet:1, coin:1, armor:1, turbo:0, can:1,
    look:{ body:'#ffcd2e', accent:'#1f1f26', trim:'#fff3c2', nose:'blunt', fins:'round', len:.92, w:1.18, boosters:0, stripes:3, windows:1, flame:'warm' } },
  { id:'komet', name:'Komet', cost:5300, req:4, blurb:'Ein eingebauter Münzmagnet zieht Beute an.',
    thrust:1.33, fuel:1.8, drag:0.92, handling:1.1, lift:1, magnet:1.45, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#2b3a67', accent:'#5ee7ff', trim:'#c4f5ff', nose:'ogive', fins:'swept', len:1.05, w:.92, boosters:0, stripes:1, windows:1, flame:'blue' } },
  { id:'falke', name:'Falke', cost:9400, req:5, blurb:'Lange Flügel, scharfe Kurven, elegante Gleitflüge.',
    thrust:1.42, fuel:2.0, drag:0.89, handling:1.45, lift:1.9, magnet:1, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#e9edf3', accent:'#ff6b2c', trim:'#2a2f3a', nose:'ogive', fins:'wing', len:1.15, w:.9, boosters:0, stripes:1, windows:2, flame:'warm' } },
  { id:'polaris', name:'Polaris', cost:17000, req:6, blurb:'Gitterflossen und ein Schild. Gebaut fürs All.',
    thrust:1.52, fuel:2.2, drag:0.86, handling:1.2, lift:1, magnet:1.1, coin:1.1, armor:1, turbo:0, can:1,
    look:{ body:'#f4f6fb', accent:'#14203d', trim:'#d9b25a', nose:'cone', fins:'grid', len:1.25, w:.95, boosters:0, stripes:2, windows:1, flame:'warm' } },
  { id:'titan', name:'Titan', cost:30000, req:7, blurb:'Zwei Booster und doppelte Panzerung.',
    thrust:1.62, fuel:2.4, drag:0.84, handling:1.1, lift:1, magnet:1.1, coin:1.1, armor:2, turbo:0, can:1,
    look:{ body:'#cfd5df', accent:'#c0392b', trim:'#6b7480', nose:'ogive', fins:'delta', len:1.3, w:1.05, boosters:2, stripes:2, windows:0, flame:'warm' } },
  { id:'orion', name:'Orion', cost:62000, req:8, blurb:'Goldener Nachbrenner mit einer Extra-Turbozündung.',
    thrust:1.72, fuel:2.6, drag:0.82, handling:1.25, lift:1, magnet:1.15, coin:1.15, armor:1, turbo:1, can:1.2,
    look:{ body:'#1c1f2b', accent:'#ffb23e', trim:'#ffe1a6', nose:'cone', fins:'swept', len:1.22, w:.95, boosters:0, stripes:2, windows:2, flame:'gold' } },
  { id:'nebula', name:'Nebula', cost:120000, req:9, blurb:'Holt doppelt so viel aus jedem Treibstoffkanister.',
    thrust:1.82, fuel:2.8, drag:0.8, handling:1.3, lift:1, magnet:1.2, coin:1.2, armor:1, turbo:1, can:2,
    look:{ body:'#3a1d5c', accent:'#ff5fd2', trim:'#9ef2ff', nose:'ogive', fins:'swept', len:1.25, w:1, boosters:2, stripes:1, windows:1, flame:'violet' } },
  { id:'quasar', name:'Quasar', cost:310000, req:10, blurb:'Zwei Turbozündungen und ein Magnetfeld wie ein Pulsar.',
    thrust:1.92, fuel:3.0, drag:0.78, handling:1.35, lift:1, magnet:1.4, coin:1.3, armor:2, turbo:2, can:1.5,
    look:{ body:'#0e2a35', accent:'#36ffc8', trim:'#e9fffa', nose:'ogive', fins:'grid', len:1.32, w:1, boosters:0, stripes:2, windows:1, flame:'green' } },
  { id:'singularitaet', name:'Singularität', cost:760000, req:12, blurb:'Das Ende der Raketenwissenschaft. Alles, nur mehr.',
    thrust:2.05, fuel:3.25, drag:0.75, handling:1.5, lift:1.5, magnet:1.6, coin:1.6, armor:3, turbo:2, can:2,
    look:{ body:'#0b0b14', accent:'#ffffff', trim:'#b48cff', nose:'ogive', fins:'wing', len:1.42, w:1.02, boosters:2, stripes:1, windows:1, flame:'void' } },
];
const ROCKET_BY_ID = Object.fromEntries(ROCKETS.map(r => [r.id, r]));

// ---------- missions ----------
const MISSIONS = [
  { id:'a30',   g:'Höhe', t:'alt', goal:30,       reward:110,    text:'Erster Hüpfer: 30 m Höhe' },
  { id:'a100',  g:'Höhe', t:'alt', goal:100,      reward:120,    text:'Über die Baumwipfel: 100 m' },
  { id:'a368',  g:'Höhe', t:'alt', goal:368,      reward:120,   text:'Höher als der Berliner Fernsehturm: 368 m' },
  { id:'a1k',   g:'Höhe', t:'alt', goal:1000,     reward:230,   text:'Ab in die Wolken: 1 km' },
  { id:'a8849', g:'Höhe', t:'alt', goal:8849,     reward:450,  text:'Höher als der Mount Everest: 8.849 m' },
  { id:'a25k',  g:'Höhe', t:'alt', goal:25000,    reward:1000,  text:'Mitten durch die Ozonschicht: 25 km' },
  { id:'a100k', g:'Höhe', t:'alt', goal:100000,   reward:1800, text:'Die Kármán-Linie: 100 km' },
  { id:'a400k', g:'Höhe', t:'alt', goal:400000,   reward:3200, text:'Auf Höhe der Raumstation: 400 km' },
  { id:'ageo',  g:'Höhe', t:'alt', goal:35786000, reward:5600,   text:'Geostationäre Bahn: 35.786 km' },
  { id:'amoon', g:'Höhe', t:'alt', goal:3.844e8,  reward:12000,   text:'Bis zum Mond: 384.400 km' },
  { id:'amars', g:'Höhe', t:'alt', goal:7.8e10,   reward:22000, text:'Zum Mars: 78 Mio. km' },
  { id:'abelt', g:'Höhe', t:'alt', goal:3.2e11,   reward:58000,   text:'Durch den Asteroidengürtel' },
  { id:'ajup',  g:'Höhe', t:'alt', goal:6.3e11,   reward:80000,   text:'Vorbei am Jupiter: 630 Mio. km' },
  { id:'asat',  g:'Höhe', t:'alt', goal:1.28e12,  reward:140000,   text:'Vorbei am Saturn: 1,28 Mrd. km' },
  { id:'aedge', g:'Höhe', t:'alt', goal:1.8e13,   reward:360000,   text:'Die Heliopause durchbrechen' },
  { id:'mach1', g:'Tempo', t:'speed', goal:343,    reward:450,   text:'Schallmauer durchbrechen: Mach 1' },
  { id:'mach5', g:'Tempo', t:'speed', goal:1715,   reward:3200,  text:'Hyperschall: Mach 5' },
  { id:'v79',   g:'Tempo', t:'speed', goal:7900,   reward:22000, text:'Erste kosmische Geschwindigkeit: 7,9 km/s' },
  { id:'v112',  g:'Tempo', t:'speed', goal:11200,  reward:22000, text:'Fluchtgeschwindigkeit: 11,2 km/s' },
  { id:'v192',  g:'Tempo', t:'speed', goal:192000, reward:360000,   text:'Schneller als die Parker-Sonde: 192 km/s' },
  { id:'c100',  g:'Beute', t:'runCoins', goal:100,   reward:450, text:'100 Münzen in einem Flug' },
  { id:'c1k',   g:'Beute', t:'runCoins', goal:1000,  reward:3200, text:'1.000 Münzen in einem Flug' },
  { id:'c5k',   g:'Beute', t:'runCoins', goal:5000,  reward:5600, text:'5.000 Münzen in einem Flug' },
  { id:'c25k',  g:'Beute', t:'runCoins', goal:25000, reward:58000, text:'25.000 Münzen in einem Flug' },
  { id:'c100k', g:'Beute', t:'runCoins', goal:1e5,   reward:140000, text:'100.000 Münzen in einem Flug' },
  { id:'c500k', g:'Beute', t:'runCoins', goal:5e5,   reward:710000, text:'500.000 Münzen in einem Flug' },
  { id:'c2m',   g:'Beute', t:'runCoins', goal:2e6,   reward:1.5e6, text:'2 Mio. Münzen in einem Flug' },
  { id:'gem10', g:'Beute', t:'gems', goal:10,  reward:1800,  text:'10 Edelsteine finden' },
  { id:'gem100',g:'Beute', t:'gems', goal:100, reward:140000,   text:'100 Edelsteine finden' },
  { id:'cans5', g:'Sammeln', t:'cans', goal:5,    reward:120,   text:'5 Treibstoffkanister einsammeln' },
  { id:'cans60',g:'Sammeln', t:'cans', goal:60,   reward:5600, text:'60 Treibstoffkanister einsammeln' },
  { id:'ring10',g:'Sammeln', t:'rings', goal:10,  reward:230,   text:'Durch 10 Boost-Ringe fliegen' },
  { id:'ring150',g:'Sammeln',t:'rings', goal:150, reward:58000,   text:'Durch 150 Boost-Ringe fliegen' },
  { id:'rrun5', g:'Sammeln', t:'runRings', goal:5, reward:1800, text:'5 Boost-Ringe in einem Flug' },
  { id:'bal10', g:'Sammeln', t:'balloons', goal:10, reward:230, text:'10 Ballons platzen lassen' },
  { id:'bal80', g:'Sammeln', t:'balloons', goal:80, reward:12000, text:'80 Ballons platzen lassen' },
  { id:'f10',   g:'Pilot', t:'flights', goal:10,  reward:230,   text:'10 Flüge absolvieren' },
  { id:'f60',   g:'Pilot', t:'flights', goal:60,  reward:5600,  text:'60 Flüge absolvieren' },
  { id:'f200',  g:'Pilot', t:'flights', goal:200, reward:80000,   text:'200 Flüge absolvieren' },
  { id:'nob60', g:'Pilot', t:'noBoost', goal:60,  reward:120,   text:'Nur mit der Schleuder: 60 m ohne Schub' },
  { id:'nob500',g:'Pilot', t:'noBoost', goal:500, reward:20000, text:'Schleuder-Profi: 500 m ohne Schub' },
  { id:'sh10',  g:'Pilot', t:'shieldHits', goal:10, reward:25000, text:'Dein Schild wehrt 10 Treffer ab' },
  { id:'tur25', g:'Pilot', t:'turbos', goal:25, reward:22000, text:'25-mal den Turbo zünden' },
  { id:'bnc3',  g:'Pilot', t:'runBounces', goal:3, reward:60000, text:'3-mal in einem Flug abprallen' },
  { id:'rk2',   g:'Sammlung', t:'rockets', goal:2,  reward:120,   text:'Eine zweite Rakete kaufen' },
  { id:'rk6',   g:'Sammlung', t:'rockets', goal:6,  reward:5600, text:'Sechs Raketen besitzen' },
  { id:'rk12',  g:'Sammlung', t:'rockets', goal:12, reward:500000,  text:'Alle zwölf Raketen besitzen' },
  { id:'max1',  g:'Sammlung', t:'maxed', goal:1, reward:5600, text:'Ein Upgrade auf Höchststufe' },
  { id:'max7',  g:'Sammlung', t:'maxed', goal:7, reward:400000,   text:'Sieben Upgrades auf Höchststufe' },
];

// ---------- save ----------
function defaultSave() {
  return {
    v: 1, coins: 0, up: {}, rockets: ['funke'], rocket: 'funke', claimed: {}, seen: {}, bestZone: 0, won: false,
    settings: { sound: true },
    stats: { flights:0, bestH:0, bestA:0, bestV:0, bestRunCoins:0, bestRunRings:0, bestNoBoost:0, bestRunBounces:0,
             earned:0, coinsPicked:0, gems:0, rings:0, cans:0, balloons:0, shieldHits:0, turbos:0, hits:0, playTime:0 },
  };
}
function normalizeSave(s) {
  const d = defaultSave();
  if (!s || typeof s !== 'object') return d;
  const out = Object.assign(d, s);
  out.stats = Object.assign(defaultSave().stats, s.stats || {});
  out.settings = Object.assign(defaultSave().settings, s.settings || {});
  out.up = Object.assign({}, s.up || {});
  for (const k of Object.keys(out.up)) if (!UPG[k]) delete out.up[k]; else out.up[k] = clamp(out.up[k] | 0, 0, UPG[k].max);
  out.rockets = Array.isArray(s.rockets) ? s.rockets.filter(id => ROCKET_BY_ID[id]) : [];
  if (!out.rockets.includes('funke')) out.rockets.unshift('funke');
  if (!out.rockets.includes(out.rocket)) out.rocket = 'funke';
  out.claimed = Object.assign({}, s.claimed || {});
  out.seen = Object.assign({}, s.seen || {});
  if (!Number.isFinite(out.coins) || out.coins < 0) out.coins = 0;
  out.bestZone = clamp(out.bestZone | 0, 0, ZONES.length - 1);
  return out;
}

// ---------- derived stats ----------
function computeStats(save) {
  const R = ROCKET_BY_ID[save.rocket] || ROCKETS[0];
  const L = id => Math.min(save.up[id] || 0, UPG[id].max);
  const mag = L('magnet');
  return {
    sling: 600 * Math.pow(1.075, L('sling')),
    thrust: 800 * Math.pow(1.03, L('engine')) * R.thrust,
    fuel: 1.3 * Math.pow(1.04, L('tank')) * R.fuel,
    burn: Math.pow(0.97, L('eff')),
    drag: PHYS.DRAG * Math.pow(0.97, L('aero')) * R.drag,
    lift: (0.2 * L('wings') + (R.lift > 1 ? 0.6 * (R.lift - 1) : 0)),
    handling: 2.4 * (1 + 0.1 * L('steer')) * R.handling,
    magnet: (mag ? 30 + 12 * mag : 0) + (R.magnet > 1 ? 70 * (R.magnet - 1) : 0),
    armor: L('armor') + R.armor,
    turbo: L('turbo') + R.turbo,
    coinMult: Math.pow(1.12, L('value')) * R.coin,
    luck: L('luck'),
    canRate: 1 + 0.12 * L('fuelfind'),
    canAmt: (0.22 + 0.015 * L('fuelfind')) * R.can,
    bounce: L('bounce'),
  };
}

// ---------- physics ----------
function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
// r: {x,y,vx,vy,a,fuel,turboT,boosting,hold}; inp: {boost, turn (+1 nose up, -1 nose down), target (pitch) }
// x is the forward distance, y the height. The nose angle a never leaves [PITCH_MIN, PITCH_MAX],
// so the rocket can climb and dive but never turn around.
function stepRocket(r, st, inp, dt) {
  const H = Math.max(0, r.y);
  const rho = airDensity(H);
  const g = gravity(H);
  const sp = Math.hypot(r.vx, r.vy);
  const rate = st.handling;
  if (inp.target != null) {
    const d = clamp(inp.target, PHYS.PITCH_MIN, PHYS.PITCH_MAX) - r.a;
    r.a += clamp(d, -rate * dt, rate * dt);
  } else if (inp.turn) {
    r.a += inp.turn * rate * dt;
  } else if (!inp.boost && !(r.hold > 0) && sp > 60 && rho > 0.05 && r.vx > 0) {
    // weathervane: in the air the nose follows the flight path
    const d = angDiff(r.a, Math.atan2(r.vy, r.vx));
    r.a += clamp(d, -2.2 * rho * dt, 2.2 * rho * dt);
  }
  r.a = clamp(r.a, PHYS.PITCH_MIN, PHYS.PITCH_MAX);
  if (r.hold > 0) r.hold -= dt;   // right after the launch the nose keeps its angle
  let ax = windAt(H), ay = -g;
  r.boosting = !!(inp.boost && r.fuel > 0);
  let thrust = 0;
  if (r.boosting) { thrust = st.thrust; r.fuel = Math.max(0, r.fuel - dt * st.burn); }
  // the turbo pushes on top of the boosters (TURBO_MULT x thrust together) and burns no fuel itself
  if (r.turboT > 0) { thrust += st.thrust * (PHYS.TURBO_MULT - 1); r.turboT -= dt; }
  ax += Math.cos(r.a) * thrust;
  ay += Math.sin(r.a) * thrust;
  const k = st.drag * (PHYS.SPACE_K + (1 - PHYS.SPACE_K) * rho);
  ax -= k * sp * r.vx;
  ay -= k * sp * r.vy;
  if (st.lift > 0 && rho > 0.02) ay += Math.min(g * 0.85, PHYS.LIFT_K * st.lift * rho * r.vx * r.vx);
  r.vx += ax * dt;
  r.vy += ay * dt;
  // forward only: the rocket always keeps a little forward speed
  if (r.vx < PHYS.MIN_VX) r.vx = PHYS.MIN_VX;
  r.x += r.vx * dt;
  r.y += r.vy * dt;
}

// ---------- formatting ----------
const deNum = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtNum(n) {
  n = Math.round(n);
  const a = Math.abs(n);
  if (a < 100000) return deNum(n);
  const units = [[1e15, 'Brd.'], [1e12, 'Bio.'], [1e9, 'Mrd.'], [1e6, 'Mio.'], [1e3, 'Tsd.']];
  for (let i = 0; i < units.length; i++) {
    let [v, u] = units[i];
    if (a < v) continue;
    let x = n / v, d = Math.abs(x) < 10 ? 2 : Math.abs(x) < 100 ? 1 : 0;
    // 999.996 Mio. would print as "1.000 Mio.": move up to the next unit instead
    if (i > 0 && Math.round(Math.abs(x) * 10 ** d) / 10 ** d >= 1000) { [v, u] = units[i - 1]; x = n / v; d = 2; }
    return deNum(x, d) + ' ' + u;
  }
  return deNum(n);
}
function fmtAltParts(A) {
  A = Math.max(0, A);
  if (Math.round(A) < 1000) return [deNum(Math.round(A)), 'm'];
  const km = A / 1000;
  if (Math.round(km * 10) / 10 < 100) return [deNum(km, 1), 'km'];
  if (Math.round(km) < 1e6) return [deNum(km), 'km'];
  const mio = km / 1e6, md = mio < 10 ? 2 : 1;
  if (Math.round(mio * 10 ** md) / 10 ** md < 1000) return [deNum(mio, md), 'Mio. km'];
  const mrd = km / 1e9;
  return [deNum(mrd, mrd < 10 ? 2 : 1), 'Mrd. km'];
}
function fmtAlt(A) { const p = fmtAltParts(A); return p[0] + ' ' + p[1]; }
function fmtSpeed(ms) {
  ms = Math.max(0, ms);
  if (ms < 2800) return deNum(ms * 3.6) + ' km/h';
  const kms = ms / 1000;
  return deNum(kms, Math.round(kms * 10) / 10 < 100 ? 1 : 0) + ' km/s';
}

if (typeof module !== 'undefined') {
  module.exports = { ZONES, ZH, zoneFrac, GOAL_H, SPACE_H, HEIGHT_BONUS, PHYS, launchSpeed, clamp, lerp, smooth, zoneIndexAt,
    altitudeAt, speedScaleAt, coinValueAt, gravity, airDensity, windAt, SKY_STOPS, cloudDensity, UPGRADES, UPG, niceRound, upgradeCost, ROCKETS, ROCKET_BY_ID,
    MISSIONS, defaultSave, normalizeSave, computeStats, angDiff, stepRocket, deNum, fmtNum, fmtAltParts, fmtAlt, fmtSpeed };
}
