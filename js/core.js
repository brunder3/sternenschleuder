
'use strict';
/* Sternenschleuder core: data, formulas and flight physics.
   No DOM or WebGL access here, so the balance can be simulated headless (see README). */

// Altitude zones. H = physical game height (world units), A = displayed altitude in metres.
const ZONES = [
  { id:'wiese',   name:'Startwiese',         H:0,     A:0,        val:1,     desc:'Hier fängt alles an.' },
  { id:'voegel',  name:'Vogelzug',           H:800,   A:80,       val:2,     desc:'Zugvögel kreuzen die Flugbahn.' },
  { id:'wolken',  name:'Wolkenmeer',         H:1100,  A:1000,     val:4,     desc:'Ab hier wird alles weiß.' },
  { id:'jet',     name:'Jetstream',          H:1500,  A:9000,     val:9,     desc:'In Reiseflughöhe schiebt dich der Höhenwind nach rechts.' },
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
  // beyond the Solar System (1 light-year = 9,46e15 m)
  { id:'oort',    name:'Oortsche Wolke',     H:65600,  A:3.0e14,  val:325,  desc:'Milliarden Eisbrocken: die Heimat der Kometen.' },
  { id:'proxima', name:'Proxima Centauri',   H:89900,  A:4.01e16, val:647,  desc:'4,24 Lichtjahre: der nächste Stern nach der Sonne.' },
  { id:'wega',    name:'Wega',               H:123000, A:2.37e17, val:3370,  desc:'Ein blauweißer Riese, 25 Lichtjahre von der Erde.' },
  { id:'plejaden',name:'Plejaden',           H:169000, A:4.2e18,  val:4220, desc:'Das Siebengestirn: ein Haufen junger blauer Sterne.' },
  { id:'orionnebel', name:'Orionnebel',      H:231000, A:1.27e19, val:27600, desc:'Eine leuchtende Wolke, in der neue Sterne entstehen.' },
  { id:'zentrum', name:'Milchstraßenzentrum',H:317000, A:2.46e20, val:96800, desc:'26.000 Lichtjahre: hier wohnt ein Schwarzes Loch.' },
  { id:'andromeda', name:'Andromeda',        H:434000, A:2.4e22,  val:136000, desc:'2,5 Millionen Lichtjahre: die Nachbargalaxie.' },
];
const LIGHTYEAR = 9.4607e15;   // metres
const LIGHTSPEED = 299792458;  // m/s
const ZH = Object.fromEntries(ZONES.map(z => [z.id, z.H]));
// height a fraction f of the way from zone id to the next zone (f may be negative)
function zoneFrac(id, f) {
  const i = ZONES.findIndex(z => z.id === id);
  const a = ZONES[i].H, b = i < ZONES.length - 1 ? ZONES[i + 1].H : a * 1.25;
  return a + (b - a) * (f || 0);
}
const GOAL_H = ZH.andromeda;
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
  // launch pad: tilt range of the launch rail and the ignition meter
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
// Displayed speed in m/s for a speed in u/s at height H. The scale is tuned so that a rocket that has just
// reached a zone shows a realistic speed there: Mach 1 in the jet stream, 7,8 km/s in orbit, 11,2 km/s
// escape velocity, then fractions of light speed between the stars. It never reaches light speed.
const SPEED_STOPS = [[0, 0.1], [800, 0.1202], [1100, 0.2739], [1500, 0.5004], [2050, 0.7613], [2800, 2.085], [3850, 3.167], [5300, 8.999], [7250, 10.53], [9950, 10.75], [13600, 14.02], [18650, 15.18], [25550, 16.04], [34950, 17.29], [47900, 21.23], [65600, 55.35], [89900, 7762], [123000, 2.244e+04], [169000, 5.422e+04], [231000, 1.053e+05], [317000, 1.987e+05], [434000, 3.351e+05]];
function speedScaleAt(H) {
  H = Math.max(0, H);
  const A = SPEED_STOPS;
  if (H <= A[0][0]) return A[0][1];
  for (let i = 1; i < A.length; i++) if (H <= A[i][0]) return A[i - 1][1] * Math.pow(A[i][1] / A[i - 1][1], (H - A[i - 1][0]) / (A[i][0] - A[i - 1][0]));
  return A[A.length - 1][1];
}
function displaySpeed(sp, H) {
  const v = sp * speedScaleAt(H);
  return LIGHTSPEED * -Math.expm1(-v / LIGHTSPEED);   // ~v when slow, approaches c without reaching it
}
// Time-lapse factor: how much faster the displayed altitude rises than the displayed speed would allow.
// 1 near the ground; billions between the stars.
function timeLapseAt(H) {
  H = Math.max(0, H);
  const dA = (altitudeAt(H + 2) - altitudeAt(Math.max(0, H - 2))) / (H + 2 - Math.max(0, H - 2));
  return Math.max(1, dA / speedScaleAt(H));
}
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
  { H: ZH.oort,               c: ['#02040c', '#081226', '#13243e'] },
  { H: ZH.proxima,            c: ['#0c0304', '#1d0a0b', '#341214'] },
  { H: ZH.wega,               c: ['#020818', '#0a1a3c', '#183068'] },
  { H: ZH.plejaden,           c: ['#03081c', '#0d1c48', '#1d3a7c'] },
  { H: ZH.orionnebel,         c: ['#12041a', '#2a0c34', '#4a1650'] },
  { H: ZH.zentrum,            c: ['#120b04', '#2a1a0a', '#4a3214'] },
  { H: ZH.andromeda,          c: ['#06040f', '#120c26', '#241a44'] },
];
// chance that a cloud sits at height h (u)
function cloudDensity(h) {
  if (h < ZH.voegel * 0.35) return 0;
  return 0.18 * smooth(ZH.voegel * 0.35, ZH.voegel, h) * (1 - smooth(zoneFrac('wolken', 0.5), ZH.jet, h))
    + 0.5 * smooth(zoneFrac('voegel', 0.6), zoneFrac('wolken', 0.4), h) * (1 - smooth(zoneFrac('jet', 0.5), ZH.strato, h))
    + 0.12 * smooth(ZH.strato, zoneFrac('strato', 0.4), h) * (1 - smooth(zoneFrac('strato', 0.8), ZH.meso, h));
}
// between the stars there is little to refuel from: fuel cans (and the fuel from boost rings) thin out
// beyond the Heliopause, so the tank and the engine decide how far a flight goes
function fuelScarcity(H) { return H <= ZH.edge ? 1 : Math.max(0.08, Math.pow(ZH.edge / H, 1.3)); }
function windAt(H) { return 110 * smooth(zoneFrac('jet', -0.05), zoneFrac('jet', 0.25), H) * (1 - smooth(zoneFrac('jet', 0.8), ZH.strato, H)); }

// ---------- upgrades ----------
// cost(L) = base * e^(g * L): each level costs a fixed factor more than the one before
const UPGRADES = [
  { id:'sling', name:'Startbooster', max:30, base:24, g:1, desc:'Stärkere Feststoffbooster an der Rampe für mehr Tempo beim Start.' },
  { id:'engine', name:'Triebwerk', max:45, base:40, g:0.667, desc:'Mehr Schub, solange du Gas gibst.' },
  { id:'tank', name:'Tank', max:45, base:36, g:0.667, desc:'Größerer Tank, längere Brenndauer.' },
  { id:'aero', name:'Aerodynamik', max:30, base:120, g:1, desc:'Glattere Hülle, weniger Luftwiderstand.' },
  { id:'value', name:'Münzpräger', max:40, base:105, g:0.8, desc:'Jede Münze ist mehr wert.' },
  { id:'eff', name:'Einspritzung', max:22, base:330, g:1.333, desc:'Weniger Verbrauch bei gleichem Schub.' },
  { id:'magnet', name:'Münzmagnet', max:20, base:210, g:1.333, desc:'Zieht Münzen aus der Umgebung an.' },
  { id:'steer', name:'Steuerdüsen', max:12, base:90, g:2, desc:'Engere Kurven, präziseres Lenken.' },
  { id:'wings', name:'Gleitflügel', max:15, base:270, g:1.667, desc:'Auftrieb in der Luft für lange Gleitflüge.' },
  { id:'fuelfind', name:'Kanister-Radar', max:16, base:420, g:1.667, desc:'Mehr und vollere Treibstoffkanister am Himmel.' },
  { id:'luck', name:'Glückspilz', max:16, base:600, g:1.667, desc:'Mehr Gold, mehr Edelsteine.' },
  { id:'armor', name:'Schutzschild', max:8, base:300, g:1.517, desc:'Wehrt je Ladung einen Zusammenstoß ab.' },
  { id:'turbo', name:'Nachbrenner', max:7, base:600, g:1.86, desc:'Turbo-Zündungen pro Flug. Schiebt zusätzlich zum Booster und kostet keinen Treibstoff.' },
  { id:'bounce', name:'Sprungfedern', max:5, base:200, g:2.6, desc:'Prallt bei der Landung wieder ab und fliegt weiter.' },
];
const UPG = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

function niceRound(n) {
  if (n < 100) return Math.round(n);
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}
function upgradeCost(u, level) { return niceRound(u.base * Math.exp(u.g * level)); }

// ---------- rockets ----------
const ROCKETS = [
  { id:'funke', name:'Funke', cost:0, req:0, blurb:'Ein Silvesterkracher mit großen Träumen.',
    thrust:1, fuel:1, drag:1, handling:1, lift:1, magnet:1, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#f3ede0', accent:'#e2402f', trim:'#f6c445', nose:'cone', fins:'delta', len:.92, w:.85, boosters:0, stripes:3, windows:0, flame:'warm' } },
  { id:'sprudel', name:'Sprudel', cost:310, req:0, blurb:'Eine Limoflasche unter Druck. Mehr Tank, mehr Spaß.',
    thrust:1.08, fuel:1.2, drag:0.98, handling:1, lift:1, magnet:1, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#86dcc6', accent:'#e84a5f', trim:'#ffd166', nose:'blunt', fins:'round', len:.95, w:.95, boosters:0, stripes:1, windows:0, flame:'water' } },
  { id:'spatz', name:'Spatz', cost:1200, req:2, blurb:'Nachbau der Jupiter-C, die 1958 den ersten US-Satelliten trug. Leicht, flink und ausdauernd.',
    thrust:1.16, fuel:1.4, drag:0.96, handling:1.15, lift:1.2, magnet:1, coin:1, armor:0, turbo:0, can:1,
    look:{ model:'jupiterc', fat:1.35, body:'#ffffff', accent:'#3b7ddd', trim:'#ffd54a', nose:'ogive', fins:'swept', len:1.05, w:.9, boosters:0, stripes:2, windows:1, flame:'warm' } },
  { id:'hummel', name:'Hummel', cost:2400, req:3, blurb:'Kurz, dick, unverwüstlich. Bringt eine Schildladung mit.',
    thrust:1.24, fuel:1.6, drag:0.94, handling:1, lift:1, magnet:1, coin:1, armor:1, turbo:0, can:1,
    look:{ body:'#ffcd2e', accent:'#1f1f26', trim:'#fff3c2', nose:'blunt', fins:'round', len:.92, w:1.18, boosters:0, stripes:3, windows:1, flame:'warm' } },
  { id:'komet', name:'Komet', cost:5300, req:4, blurb:'Ein eingebauter Münzmagnet zieht Beute an.',
    thrust:1.33, fuel:1.8, drag:0.92, handling:1.1, lift:1, magnet:1.45, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#2b3a67', accent:'#5ee7ff', trim:'#c4f5ff', nose:'ogive', fins:'swept', len:1.05, w:.92, boosters:0, stripes:1, windows:1, flame:'blue' } },
  { id:'falke', name:'Falke', cost:9400, req:5, blurb:'Lange Flügel, scharfe Kurven, elegante Gleitflüge.',
    thrust:1.42, fuel:2.0, drag:0.89, handling:1.45, lift:1.9, magnet:1, coin:1, armor:0, turbo:0, can:1,
    look:{ body:'#e9edf3', accent:'#ff6b2c', trim:'#2a2f3a', nose:'ogive', fins:'wing', len:1.15, w:.9, boosters:0, stripes:1, windows:2, flame:'warm' } },
  { id:'polaris', name:'Polaris', cost:17000, req:6, blurb:'Nachbau der Ares I-X. Schlank wie ein Bleistift, mit Schild. Gebaut fürs All.',
    thrust:1.52, fuel:2.2, drag:0.86, handling:1.2, lift:1, magnet:1.1, coin:1.1, armor:1, turbo:0, can:1,
    look:{ model:'ares1b', fat:1.5, body:'#f4f6fb', accent:'#14203d', trim:'#d9b25a', nose:'cone', fins:'grid', len:1.3, w:.95, boosters:0, stripes:2, windows:1, flame:'warm' } },
  { id:'titan', name:'Titan', cost:30000, req:7, blurb:'Nachbau der Saturn V, die Menschen zum Mond brachte. Fünf Triebwerke, doppelte Panzerung.',
    thrust:1.62, fuel:2.4, drag:0.84, handling:1.1, lift:1, magnet:1.1, coin:1.1, armor:2, turbo:0, can:1,
    look:{ model:'saturnv', fat:1.3, body:'#cfd5df', accent:'#c0392b', trim:'#6b7480', nose:'ogive', fins:'delta', len:1.45, w:1.05, boosters:2, stripes:2, windows:0, flame:'warm' } },
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
  { id:'ionenwind', name:'Ionenwind', cost:1.9e6, req:13, blurb:'Ein Ionentriebwerk: sparsam wie keine Rakete zuvor.',
    thrust:2.15, fuel:3.6, drag:0.74, handling:1.4, lift:1, magnet:1.4, coin:1.6, armor:2, turbo:2, can:1.8,
    look:{ body:'#e8f1ff', accent:'#2f7bff', trim:'#9fd2ff', nose:'cone', fins:'grid', len:1.38, w:.95, boosters:0, stripes:2, windows:2, flame:'cyan' } },
  { id:'sonnensegel', name:'Sonnensegel', cost:6.4e6, req:14, blurb:'Segelt auf dem Licht der Sonne und gleitet weit.',
    thrust:2.25, fuel:3.8, drag:0.7, handling:1.6, lift:2.2, magnet:1.5, coin:1.7, armor:2, turbo:2, can:1.8,
    look:{ body:'#fff6dc', accent:'#f2a900', trim:'#ffffff', nose:'ogive', fins:'wing', len:1.4, w:.9, boosters:0, stripes:1, windows:1, flame:'gold' } },
  { id:'kometenjaeger', name:'Kometenjäger', cost:7.9e6, req:15, blurb:'Dicker Eisschild und ein Magnet für Kometenstaub.',
    thrust:2.35, fuel:4.0, drag:0.68, handling:1.5, lift:1, magnet:1.9, coin:1.8, armor:4, turbo:2, can:2.0,
    look:{ body:'#cfe9f3', accent:'#1b5f7a', trim:'#ffffff', nose:'blunt', fins:'delta', len:1.36, w:1.1, boosters:2, stripes:3, windows:1, flame:'white' } },
  { id:'fusionsfackel', name:'Fusionsfackel', cost:3.8e7, req:16, blurb:'Ein kleiner Stern im Heck: Kernfusion als Antrieb.',
    thrust:2.5, fuel:4.2, drag:0.66, handling:1.5, lift:1, magnet:1.6, coin:1.9, armor:3, turbo:3, can:2.0,
    look:{ body:'#2a1c14', accent:'#ff7a1a', trim:'#ffd38a', nose:'ogive', fins:'swept', len:1.45, w:1.05, boosters:2, stripes:2, windows:1, flame:'red' } },
  { id:'pulsar', name:'Pulsar', cost:1.6e8, req:17, blurb:'Blitzt im Takt und zündet vier Turbos pro Flug.',
    thrust:2.65, fuel:4.4, drag:0.64, handling:1.7, lift:1, magnet:1.8, coin:2, armor:3, turbo:4, can:2.0,
    look:{ body:'#101a3a', accent:'#7df9ff', trim:'#ffffff', nose:'cone', fins:'grid', len:1.42, w:1, boosters:0, stripes:3, windows:2, flame:'cyan' } },
  { id:'sternenwanderer', name:'Sternenwanderer', cost:1e9, req:18, blurb:'Holt aus jedem Treibstoffkanister fast das Zweieinhalbfache heraus.',
    thrust:2.8, fuel:4.6, drag:0.62, handling:1.7, lift:1.5, magnet:2, coin:2.2, armor:3, turbo:4, can:2.4,
    look:{ body:'#efe8ff', accent:'#7a4dff', trim:'#ffcf4a', nose:'ogive', fins:'wing', len:1.48, w:.98, boosters:2, stripes:2, windows:2, flame:'pink' } },
  { id:'antares', name:'Antares', cost:5.7e9, req:19, blurb:'Antimaterie im Tank. Mehr Schub geht kaum.',
    thrust:3.0, fuel:4.8, drag:0.6, handling:1.8, lift:1, magnet:2.1, coin:2.4, armor:4, turbo:4, can:2.2,
    look:{ body:'#1a0508', accent:'#ff2448', trim:'#ffb0bf', nose:'ogive', fins:'swept', len:1.52, w:1.04, boosters:2, stripes:2, windows:1, flame:'red' } },
  { id:'lichtbringer', name:'Lichtbringer', cost:4.7e10, req:20, blurb:'So nah an der Lichtgeschwindigkeit wie nichts sonst.',
    thrust:3.25, fuel:5.0, drag:0.58, handling:2, lift:2, magnet:2.4, coin:2.7, armor:5, turbo:5, can:2.4,
    look:{ body:'#ffffff', accent:'#ffd84a', trim:'#9ff3ff', nose:'ogive', fins:'wing', len:1.58, w:1.02, boosters:2, stripes:1, windows:2, flame:'white' } },
];
const ROCKET_BY_ID = Object.fromEntries(ROCKETS.map(r => [r.id, r]));
// the hull carries the rocket's name, painted lengthwise like the lettering on real launchers
ROCKETS.forEach(r => { r.look.label = r.name.toUpperCase(); });

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
  { id:'aoort', g:'Höhe', t:'alt', goal:3.0e14,   reward:1.6e6,   text:'In die Oortsche Wolke: 2.000 Astronomische Einheiten' },
  { id:'aly1',  g:'Höhe', t:'alt', goal:LIGHTYEAR, reward:2e6,  text:'Ein ganzes Lichtjahr' },
  { id:'aprox', g:'Höhe', t:'alt', goal:4.01e16,  reward:2e6,   text:'Bis Proxima Centauri: 4,24 Lichtjahre' },
  { id:'awega', g:'Höhe', t:'alt', goal:2.37e17,  reward:9.4e6,   text:'Zur Wega: 25 Lichtjahre' },
  { id:'aplej', g:'Höhe', t:'alt', goal:4.2e18,   reward:3.9e7,   text:'Zu den Plejaden: 444 Lichtjahre' },
  { id:'aori',  g:'Höhe', t:'alt', goal:1.27e19,  reward:2.6e8,   text:'In den Orionnebel: 1.344 Lichtjahre' },
  { id:'azen',  g:'Höhe', t:'alt', goal:2.46e20,  reward:1.4e9, text:'Zum Zentrum der Milchstraße: 26.000 Lichtjahre' },
  { id:'aand',  g:'Höhe', t:'alt', goal:2.4e22,   reward:1.2e10,   text:'Ankunft in der Andromeda-Galaxie' },
  { id:'mach1', g:'Tempo', t:'speed', goal:343,    reward:450,   text:'Schallmauer durchbrechen: Mach 1' },
  { id:'mach5', g:'Tempo', t:'speed', goal:1715,   reward:3200,  text:'Hyperschall: Mach 5' },
  { id:'v79',   g:'Tempo', t:'speed', goal:7900,   reward:22000, text:'Erste kosmische Geschwindigkeit: 7,9 km/s' },
  { id:'v112',  g:'Tempo', t:'speed', goal:11200,  reward:22000, text:'Fluchtgeschwindigkeit: 11,2 km/s' },
  { id:'v192',  g:'Tempo', t:'speed', goal:192000, reward:360000,   text:'Schneller als die Parker-Sonde: 192 km/s' },
  { id:'c01',   g:'Tempo', t:'speed', goal:0.1 * LIGHTSPEED,  reward:9.4e6, text:'Ein Zehntel der Lichtgeschwindigkeit' },
  { id:'c05',   g:'Tempo', t:'speed', goal:0.5 * LIGHTSPEED,  reward:2.6e8, text:'Halbe Lichtgeschwindigkeit' },
  { id:'c09',   g:'Tempo', t:'speed', goal:0.9 * LIGHTSPEED,  reward:1.2e10, text:'90 % der Lichtgeschwindigkeit' },
  { id:'c100',  g:'Beute', t:'runCoins', goal:100,   reward:450, text:'100 Münzen in einem Flug' },
  { id:'c1k',   g:'Beute', t:'runCoins', goal:1000,  reward:3200, text:'1.000 Münzen in einem Flug' },
  { id:'c5k',   g:'Beute', t:'runCoins', goal:5000,  reward:5600, text:'5.000 Münzen in einem Flug' },
  { id:'c25k',  g:'Beute', t:'runCoins', goal:25000, reward:58000, text:'25.000 Münzen in einem Flug' },
  { id:'c100k', g:'Beute', t:'runCoins', goal:1e5,   reward:140000, text:'100.000 Münzen in einem Flug' },
  { id:'c500k', g:'Beute', t:'runCoins', goal:5e5,   reward:710000, text:'500.000 Münzen in einem Flug' },
  { id:'c2m',   g:'Beute', t:'runCoins', goal:2e6,   reward:1.5e6, text:'2 Mio. Münzen in einem Flug' },
  { id:'c50m',  g:'Beute', t:'runCoins', goal:5e7,   reward:3.9e7, text:'50 Mio. Münzen in einem Flug' },
  { id:'c1b',   g:'Beute', t:'runCoins', goal:1e9,   reward:1.4e9, text:'1 Mrd. Münzen in einem Flug' },
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
  { id:'f400',  g:'Pilot', t:'flights', goal:400, reward:2.6e8,   text:'400 Flüge absolvieren' },
  { id:'nob60', g:'Pilot', t:'noBoost', goal:60,  reward:120,   text:'Nur mit den Startboostern: 60 m ohne Triebwerk' },
  { id:'nob500',g:'Pilot', t:'noBoost', goal:500, reward:20000, text:'Rampen-Profi: 500 m ohne Triebwerk' },
  { id:'sh10',  g:'Pilot', t:'shieldHits', goal:10, reward:25000, text:'Dein Schild wehrt 10 Treffer ab' },
  { id:'tur25', g:'Pilot', t:'turbos', goal:25, reward:22000, text:'25-mal den Turbo zünden' },
  { id:'bnc3',  g:'Pilot', t:'runBounces', goal:3, reward:60000, text:'3-mal in einem Flug abprallen' },
  { id:'rk2',   g:'Sammlung', t:'rockets', goal:2,  reward:120,   text:'Eine zweite Rakete kaufen' },
  { id:'rk6',   g:'Sammlung', t:'rockets', goal:6,  reward:5600, text:'Sechs Raketen besitzen' },
  { id:'rk12',  g:'Sammlung', t:'rockets', goal:12, reward:500000,  text:'Zwölf Raketen besitzen' },
  { id:'rk20',  g:'Sammlung', t:'rockets', goal:20, reward:1.2e10,  text:'Alle zwanzig Raketen besitzen' },
  { id:'max1',  g:'Sammlung', t:'maxed', goal:1, reward:5600, text:'Ein Upgrade auf Höchststufe' },
  { id:'max7',  g:'Sammlung', t:'maxed', goal:7, reward:400000,   text:'Sieben Upgrades auf Höchststufe' },
  { id:'max14', g:'Sammlung', t:'maxed', goal:14, reward:1.2e10,   text:'Alle Upgrades auf Höchststufe' },
  { id:'earn1m', g:'Beute', t:'earned', goal:1e6,  reward:58000,  text:'Insgesamt 1 Mio. Münzen verdienen' },
  { id:'earn1b', g:'Beute', t:'earned', goal:1e9,  reward:3.9e7,  text:'Insgesamt 1 Mrd. Münzen verdienen' },
  { id:'earn1t', g:'Beute', t:'earned', goal:1e12, reward:1.4e10, text:'Insgesamt 1 Billion Münzen verdienen' },
  { id:'gem1k', g:'Beute', t:'gems', goal:1000, reward:2.6e8, text:'1.000 Edelsteine finden' },
  { id:'perf1',  g:'Pilot', t:'perfects', goal:1,   reward:230,    text:'Eine perfekte Zündung' },
  { id:'perf25', g:'Pilot', t:'perfects', goal:25,  reward:22000,  text:'25 perfekte Zündungen' },
  { id:'perf100',g:'Pilot', t:'perfects', goal:100, reward:500000, text:'100 perfekte Zündungen' },
  { id:'play1h', g:'Pilot', t:'playTime', goal:3600,  reward:22000,  text:'Eine Stunde in der Luft' },
  { id:'play5h', g:'Pilot', t:'playTime', goal:18000, reward:1.5e6,  text:'Fünf Stunden in der Luft' },
  { id:'rkFunke', g:'Raketen', t:'rocketAlt', rocket:'funke', goal:100000, reward:58000, text:'Mit der Funke ins All: 100 km' },
  { id:'rkSpatz', g:'Raketen', t:'rocketAlt', rocket:'spatz', goal:8849, reward:450, text:'Mit der Jupiter-C (Spatz) über den Mount Everest' },
  { id:'rkPolaris', g:'Raketen', t:'rocketAlt', rocket:'polaris', goal:100000, reward:3200, text:'Mit der Ares I-X (Polaris) in den Weltraum' },
  { id:'rkTitan', g:'Raketen', t:'rocketAlt', rocket:'titan', goal:3.844e8, reward:22000, text:'Mit der Saturn V (Titan) zum Mond' },
  { id:'rkOrion', g:'Raketen', t:'rocketAlt', rocket:'orion', goal:7.8e10, reward:58000, text:'Mit der Orion zum Mars' },
  { id:'rkLicht', g:'Raketen', t:'rocketAlt', rocket:'lichtbringer', goal:2.4e22, reward:1.2e10, text:'Mit dem Lichtbringer nach Andromeda' },
  { id:'pet1',   g:'Begleiter', t:'hatched', goal:1,   reward:150,   text:'Dein erstes Ei ausbrüten' },
  { id:'pet25',  g:'Begleiter', t:'hatched', goal:25,  reward:5600,  text:'25 Eier ausbrüten' },
  { id:'pet100', g:'Begleiter', t:'hatched', goal:100, reward:140000, text:'100 Eier ausbrüten' },
  { id:'pet500', g:'Begleiter', t:'hatched', goal:500, reward:3.9e7,  text:'500 Eier ausbrüten' },
  { id:'gold1',  g:'Begleiter', t:'fused', goal:1,  reward:12000,  text:'Einen goldenen Begleiter fusionieren' },
  { id:'gold10', g:'Begleiter', t:'fused', goal:10, reward:2.6e8,  text:'Zehn goldene Begleiter fusionieren' },
  { id:'idx10',  g:'Begleiter', t:'indexed', goal:10, reward:22000, text:'10 verschiedene Begleiter finden' },
  { id:'idx40',  g:'Begleiter', t:'indexed', goal:40, reward:1.2e10, text:'Alle 40 Begleiter finden' },
  { id:'myth1',  g:'Begleiter', t:'mythics', goal:1, reward:1.5e6, text:'Einen mythischen Begleiter ausbrüten' },
  { id:'lv10',   g:'Pilot', t:'level', goal:10, reward:5600,   text:'Pilotenlevel 10' },
  { id:'lv25',   g:'Pilot', t:'level', goal:25, reward:500000, text:'Pilotenlevel 25' },
  { id:'lv50',   g:'Pilot', t:'level', goal:50, reward:1.4e9,  text:'Pilotenlevel 50' },
  { id:'rb1',  g:'Rebirth', t:'rebirths', goal:1,  reward:5000,   text:'Dein erster Rebirth' },
  { id:'rb3',  g:'Rebirth', t:'rebirths', goal:3,  reward:60000,  text:'Drei Rebirths' },
  { id:'rb5',  g:'Rebirth', t:'rebirths', goal:5,  reward:1.5e6,  text:'Fünf Rebirths' },
  { id:'rb10', g:'Rebirth', t:'rebirths', goal:10, reward:2.6e8,  text:'Zehn Rebirths' },
  { id:'rb14', g:'Rebirth', t:'rebirths', goal:14, reward:1.2e10, text:'Rebirth-Legende: 14 Rebirths' },
];

// ---------- rebirth ----------
// As in Roblox simulators: start over without coins, upgrades and rockets (back to the Funke), keep
// records and quests, and earn one more times the coins for good with every rebirth (x2, x3, ...). Each rebirth asks to reach a
// farther zone within the current round (since the last rebirth), and the stronger rockets need a number
// of rebirths: from the Titan on, the way out is only open with rebirths.
const REBIRTH_ZONES = ['space', 'geo', 'moon', 'mars', 'jupiter', 'saturn', 'edge', 'oort', 'proxima', 'wega', 'plejaden', 'orionnebel', 'zentrum', 'andromeda'];
const ZONE_INDEX = Object.fromEntries(ZONES.map((z, i) => [z.id, i]));
function rebirthZone(n) { return ZONE_INDEX[REBIRTH_ZONES[Math.min(n, REBIRTH_ZONES.length - 1)]]; }
function rebirthMult(n) { return 1 + n; }
// rebirths a rocket needs: one per rebirth goal that lies below the zone that unlocks the rocket
for (const R of ROCKETS) R.rb = REBIRTH_ZONES.filter(id => ZONE_INDEX[id] < R.req).length;
function canRebirth(save) { return save.life.bestZone >= rebirthZone(save.rebirths); }
function applyRebirth(save) {
  if (!canRebirth(save)) return false;
  save.rebirths++;
  save.coins = 0; save.up = {}; save.life = { bestZone: 0 };
  save.rockets = ['funke']; save.rocket = 'funke';
  return true;
}

// ---------- daily quests ----------
// Three quests a day, drawn from a pool by the date; goals and rewards grow with the player's progress.
const DAILY_POOL = [
  { k:'flights',  text: n => `${n} Flüge absolvieren`,                 goal: p => 4 + Math.min(6, p.zone >> 2) },
  { k:'coins',    text: n => `${fmtNum(n)} Münzen verdienen`,           goal: p => niceRound(Math.max(300, p.runCoins * 3)) },
  { k:'rings',    text: n => `Durch ${n} Boost-Ringe fliegen`,         goal: p => 6 + 2 * Math.min(6, p.zone >> 1) },
  { k:'cans',     text: n => `${n} Treibstoffkanister einsammeln`,     goal: p => 4 + Math.min(8, p.zone >> 1) },
  { k:'perfects', text: n => `${n}-mal perfekt zünden`,                goal: () => 3 },
  { k:'balloons', text: n => `${n} Ballons platzen lassen`,            goal: () => 4 },
  { k:'zone',     text: (n, p) => `In einem Flug ${ZONES[n].name} erreichen (${fmtAlt(ZONES[n].A)})`, goal: p => Math.max(2, p.zone - 1) },
];
function dayKey(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dailyReward(save) { return niceRound(Math.max(150, ZONES[save.bestZone].val * 30) * rebirthMult(save.rebirths)); }
function makeDaily(save, day) {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const p = { zone: save.bestZone, runCoins: save.stats.bestRunCoins };
  const pool = DAILY_POOL.slice(), quests = [], reward = dailyReward(save);
  while (quests.length < 3) {
    const t = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    quests.push({ k: t.k, goal: t.goal(p), prog: 0, reward, claimed: false });
  }
  return { day, quests, bonus: reward * 3, bonusClaimed: false };
}
function dailyText(q) { const t = DAILY_POOL.find(x => x.k === q.k); return t ? t.text(q.goal) : q.k; }
function dailyDone(q) { return q.prog >= q.goal; }

// ---------- pets ----------
// Companions hatched from eggs with coins, like the pets of Roblox simulators. Each pet boosts one value
// (coins, thrust, fuel or magnet) by its egg tier and rarity; five equal pets fuse into a golden one with
// twice the bonus. Pets stay through rebirths. Finding all five pets of an egg adds 5 % coins for good.
const PET_RARITIES = [
  { id:'common',  name:'Gewöhnlich', w:60,  mult:1,   color:'#a9b6d6' },
  { id:'rare',    name:'Selten',     w:27,  mult:1.8, color:'#4fb0ff' },
  { id:'epic',    name:'Episch',     w:10,  mult:3.2, color:'#b25cff' },
  { id:'legend',  name:'Legendär',   w:2.7, mult:6,   color:'#ffc928' },
  { id:'mythic',  name:'Mythisch',   w:0.3, mult:12,  color:'#ff4fd8' },
];
const PET_TYPES = { coins:'Münzen', thrust:'Schub', fuel:'Tank', magnet:'Magnet' };
const EGGS = [
  { id:'wiese',   name:'Wiesen-Ei',   zone:0,  cost:150,   color:'#7bd35a', pets:[['Grashüpfi','coins','#7bd35a'], ['Kleeblatt','magnet','#3fb45a'], ['Pusteblume','fuel','#f2f2e6'], ['Marienkäfer','coins','#ff4a3d'], ['Goldkäfer','coins','#ffc928']] },
  { id:'wolken',  name:'Wolken-Ei',   zone:2,  cost:500,   color:'#cfe7ff', pets:[['Wölkchen','coins','#eef6ff'], ['Regentropf','fuel','#4fb0ff'], ['Blitzi','thrust','#ffe14a'], ['Regenbogen','coins','#ff7ac0'], ['Donnervogel','thrust','#6a5cff']] },
  { id:'orbit',   name:'Orbit-Ei',    zone:7,  cost:5000,  color:'#9fb2c8', pets:[['Satelliti','coins','#c9d2de'], ['Funkmast','magnet','#ff8a2a'], ['Raumsonde','thrust','#ffd36a'], ['Astro-Hund','fuel','#e8c39e'], ['ISS-Kätzchen','coins','#ffffff']] },
  { id:'mond',    name:'Mond-Ei',     zone:9,  cost:20000, color:'#d9d6cc', pets:[['Mondhase','coins','#e9e6dc'], ['Kraterkrabbe','magnet','#a8a39a'], ['Mondstaub','fuel','#c7c2ff'], ['Lunar-Eule','thrust','#8fa0c8'], ['Silbermond','coins','#e8f0ff']] },
  { id:'mars',    name:'Mars-Ei',     zone:10, cost:4e4,   color:'#e0643a', pets:[['Marsmännchen','coins','#6fe05a'], ['Rostkäfer','fuel','#c4572c'], ['Olympus','thrust','#ff9a5a'], ['Phobos','magnet','#9a7a66'], ['Roter Drache','coins','#ff3a2a']] },
  { id:'ring',    name:'Ring-Ei',     zone:13, cost:2.5e5, color:'#f0d9a0', pets:[['Eisbrocken','fuel','#cfefff'], ['Ringling','coins','#f0d9a0'], ['Titan-Qualle','magnet','#ffb06a'], ['Ringkröte','thrust','#d9b56a'], ['Ringkönig','coins','#ffd84a']] },
  { id:'stern',   name:'Sternen-Ei',  zone:16, cost:3.5e6, color:'#ffe88a', pets:[['Funkel','coins','#fff3a8'], ['Pulsarchen','thrust','#7df9ff'], ['Nebelfuchs','magnet','#ff8ad8'], ['Supernova','fuel','#ff9a3a'], ['Sternenwal','coins','#8ab4ff']] },
  { id:'galaxie', name:'Galaxie-Ei',  zone:20, cost:2.5e9, color:'#b48cff', pets:[['Wirbel','coins','#c9a8ff'], ['Schwarzes Loch','magnet','#2a1f44'], ['Quasar-Qualle','thrust','#5ee7ff'], ['Galaxiedrache','fuel','#ff5fd2'], ['Andromeda-Phönix','coins','#ffb23e']] },
];
const PETS = [];
EGGS.forEach((e, tier) => { e.tier = tier; e.pets = e.pets.map(([name, type, color], r) => { const p = { id: e.id + r, name, type, color, rarity: r, egg: e.id, tier }; PETS.push(p); return p; }); });
const PET_BY_ID = Object.fromEntries(PETS.map(p => [p.id, p]));
const EGG_BY_ID = Object.fromEntries(EGGS.map(e => [e.id, e]));
const PET_MAX = 60;
// raw strength of a pet; the type decides how it turns into a bonus
function petPower(p, golden) { return 0.02 * (1 + p.tier * 0.6) * PET_RARITIES[p.rarity].mult * (golden ? 2 : 1); }
const PET_SCALE = { coins: 1, thrust: 0.3, fuel: 0.3, magnet: 1 };
function petBonusValue(p, golden) { return petPower(p, golden) * PET_SCALE[p.type]; }
function petSlots(save) { return Math.min(8, 3 + Math.floor(save.rebirths / 2)); }
function eggUnlocked(save, e) { return save.bestZone >= e.zone; }
function bestEgg(save) { return EGGS.filter(e => eggUnlocked(save, e)).pop() || EGGS[0]; }
function eggCompleted(save, e) { return e.pets.every(p => save.index[p.id]); }
function petBonus(save) {
  const b = { coins: 0, thrust: 0, fuel: 0, magnet: 0 };
  for (const uid of save.equipped) {
    const it = save.pets.find(x => x.uid === uid);
    if (it) { const p = PET_BY_ID[it.id]; b[p.type] += petBonusValue(p, it.golden); }
  }
  b.coins += 0.05 * EGGS.filter(e => eggCompleted(save, e)).length;
  return b;
}
// draws one pet; luck > 1 makes the rarer ones more likely
function hatchPet(save, egg, luck, rnd = Math.random) {
  const w = PET_RARITIES.map((r, i) => r.w * (i > 0 ? luck : 1));
  let x = rnd() * w.reduce((a, b) => a + b, 0), r = 0;
  while (r < w.length - 1 && (x -= w[r]) > 0) r++;
  const p = egg.pets[r];
  save.petUid = (save.petUid || 0) + 1;
  const item = { uid: save.petUid, id: p.id, golden: false };
  save.pets.push(item);
  save.index[p.id] = 1;
  save.stats.hatched = (save.stats.hatched || 0) + 1;
  return item;
}
function equipBest(save) {
  const rank = it => petPower(PET_BY_ID[it.id], it.golden) * (PET_BY_ID[it.id].type === 'coins' ? 1.2 : 1);
  save.equipped = save.pets.slice().sort((a, b) => rank(b) - rank(a)).slice(0, petSlots(save)).map(it => it.uid);
}
// five equal, normal pets fuse into one golden pet
function canFuse(save, id) { return save.pets.filter(it => it.id === id && !it.golden).length >= 5; }
function fusePets(save, id) {
  if (!canFuse(save, id)) return null;
  let n = 0;
  save.pets = save.pets.filter(it => { if (n < 5 && it.id === id && !it.golden) { n++; save.equipped = save.equipped.filter(u => u !== it.uid); return false; } return true; });
  save.petUid++;
  const item = { uid: save.petUid, id, golden: true };
  save.pets.push(item);
  return item;
}

// ---------- pilot level ----------
// Every flight earns XP; each level adds 1 % coins for good and pays a reward.
function xpForLevel(L) { return Math.round(30 * Math.pow(L, 1.25)); }
function flightXp(run) { return 10 + 4 * zoneIndexAt(run.maxH) + (run.perfect ? 5 : 0) + 2 * Math.floor(Math.log10(1 + run.coins)); }

// ---------- boosts, rewards ----------
// Boosts run on play time (seconds the game is open), like the potions of Roblox games.
const BOOSTS = { coins: { name:'2× Münzen', color:'#ffc928' }, luck: { name:'2× Glück', color:'#a463ff' } };
function boostActive(save, k) { return (save.boosts[k] || 0) > 0; }
// a "coin pack": some flights' worth of coins at the player's current stage
function coinPack(save, k) { return niceRound(Math.max(100, ZONES[save.bestZone].val * 20 * k) * rebirthMult(save.rebirths)); }
// 7-day login calendar: a missed day only pauses it, it never starts over
const LOGIN_REWARDS = [
  { kind:'coins', k:2 }, { kind:'boost', boost:'coins', min:10 }, { kind:'coins', k:4 }, { kind:'egg', luck:1 },
  { kind:'boost', boost:'luck', min:15 }, { kind:'coins', k:8 }, { kind:'egg', luck:4 },
];
// presents for staying: minutes of play in this session
const GIFTS = [
  { min:2, kind:'coins', k:1 }, { min:5, kind:'boost', boost:'coins', min2:5 }, { min:10, kind:'egg', luck:1 },
  { min:15, kind:'coins', k:4 }, { min:25, kind:'boost', boost:'luck', min2:10 }, { min:40, kind:'egg', luck:2 }, { min:60, kind:'coins', k:12 },
];
// wheel of fortune: one free spin every three hours
const WHEEL = [
  { kind:'coins', k:1, w:26, label:'Münzen' }, { kind:'boost', boost:'coins', min2:5, w:16, label:'2× Münzen' },
  { kind:'coins', k:3, w:16, label:'Münzen ×3' }, { kind:'egg', luck:1, w:12, label:'Gratis-Ei' },
  { kind:'boost', boost:'luck', min2:10, w:12, label:'2× Glück' }, { kind:'coins', k:6, w:9, label:'Münzen ×6' },
  { kind:'egg', luck:3, w:6, label:'Glücks-Ei' }, { kind:'coins', k:25, w:3, label:'Jackpot' },
];
const WHEEL_EVERY = 3 * 3600 * 1000;
function wheelPick(rnd = Math.random) { let x = rnd() * WHEEL.reduce((a, s) => a + s.w, 0); for (let i = 0; i < WHEEL.length; i++) if ((x -= WHEEL[i].w) <= 0) return i; return 0; }
// codes to redeem once each
const CODES = {
  STERNENSCHLEUDER: { kind:'coins', k:5, text:'Münzpaket' },
  ANDROMEDA: { kind:'egg', luck:3, text:'Glücks-Ei' },
  SATURNV: { kind:'boost', boost:'luck', min2:20, text:'20 Minuten 2× Glück' },
  ABHEBEN: { kind:'boost', boost:'coins', min2:15, text:'15 Minuten 2× Münzen' },
};


// ---------- save ----------
function defaultSave() {
  return {
    v: 2, coins: 0, up: {}, rockets: ['funke'], rocket: 'funke', claimed: {}, seen: {}, bestZone: 0, won: false,
    rebirths: 0, life: { bestZone: 0 }, daily: null,
    pets: [], equipped: [], petUid: 0, index: {}, level: 1, xp: 0, boosts: { coins: 0, luck: 0 },
    login: { day: '', step: 0, claimed: true }, wheelNext: 0, codes: {},
    settings: { sound: true },
    stats: { flights:0, bestH:0, bestA:0, bestV:0, bestRunCoins:0, bestRunRings:0, bestNoBoost:0, bestRunBounces:0,
             earned:0, coinsPicked:0, gems:0, rings:0, cans:0, balloons:0, shieldHits:0, turbos:0, hits:0, playTime:0,
             perfects:0, rocketBest:{}, hatched:0, fused:0 },
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
  out.rebirths = Math.max(0, out.rebirths | 0);
  // saves from before rebirths count their whole history as the current round
  out.life = { bestZone: clamp((s.life && Number.isFinite(s.life.bestZone) ? s.life.bestZone : out.bestZone) | 0, 0, ZONES.length - 1) };
  out.stats.rocketBest = Object.assign({}, (s.stats && s.stats.rocketBest) || {});
  if (!out.daily || typeof out.daily !== 'object' || !Array.isArray(out.daily.quests)) out.daily = null;
  out.pets = Array.isArray(s.pets) ? s.pets.filter(it => it && PET_BY_ID[it.id] && Number.isFinite(it.uid)).map(it => ({ uid: it.uid, id: it.id, golden: !!it.golden })) : [];
  out.petUid = Math.max(out.petUid | 0, ...out.pets.map(it => it.uid), 0);
  out.equipped = Array.isArray(s.equipped) ? s.equipped.filter(u => out.pets.some(it => it.uid === u)).slice(0, petSlots(out)) : [];
  out.index = Object.assign({}, s.index || {});
  out.level = Math.max(1, out.level | 0); out.xp = Math.max(0, +out.xp || 0);
  out.boosts = { coins: Math.max(0, +(s.boosts && s.boosts.coins) || 0), luck: Math.max(0, +(s.boosts && s.boosts.luck) || 0) };
  out.login = Object.assign({ day: '', step: 0, claimed: true }, s.login || {});
  out.codes = Object.assign({}, s.codes || {});
  out.wheelNext = +out.wheelNext || 0;
  // version 1 ended at the Heliopause; the goal is now Andromeda, so that win does not count any more
  if (!(s.v >= 2)) { out.won = false; out.v = 2; }
  return out;
}

// ---------- derived stats ----------
function computeStats(save) {
  const R = ROCKET_BY_ID[save.rocket] || ROCKETS[0];
  const L = id => Math.min(save.up[id] || 0, UPG[id].max);
  const mag = L('magnet');
  const pb = save.pets ? petBonus(save) : { coins: 0, thrust: 0, fuel: 0, magnet: 0 };
  return {
    sling: 600 * Math.pow(1.075, L('sling')),
    thrust: 800 * Math.pow(1.03, L('engine')) * R.thrust * (1 + pb.thrust),
    fuel: 1.3 * Math.pow(1.04, L('tank')) * R.fuel * (1 + pb.fuel),
    burn: Math.pow(0.97, L('eff')),
    drag: PHYS.DRAG * Math.pow(0.97, L('aero')) * R.drag,
    lift: (0.2 * L('wings') + (R.lift > 1 ? 0.6 * (R.lift - 1) : 0)),
    handling: 2.4 * (1 + 0.1 * L('steer')) * R.handling,
    magnet: (mag ? 30 + 12 * mag : 0) + (R.magnet > 1 ? 70 * (R.magnet - 1) : 0) + 60 * pb.magnet,
    armor: L('armor') + R.armor,
    turbo: L('turbo') + R.turbo,
    coinMult: Math.pow(1.12, L('value')) * R.coin * rebirthMult(save.rebirths || 0) * (1 + pb.coins) * (1 + 0.01 * ((save.level || 1) - 1))
      * (save.boosts && save.boosts.coins > 0 ? 2 : 1),
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
  const mrd = km / 1e9, rd = mrd < 10 ? 2 : mrd < 100 ? 1 : 0;
  if (Math.round(mrd * 10 ** rd) / 10 ** rd < 1000) return [deNum(mrd, rd), 'Mrd. km'];
  // from about a tenth of a light-year on: light-years
  const ly = A / LIGHTYEAR;
  if (ly < 1e6) { const d = ly < 10 ? 2 : ly < 100 ? 1 : 0; return [deNum(ly, d), 'Lichtjahre']; }
  const mly = ly / 1e6;
  return [deNum(mly, mly < 10 ? 2 : 1), 'Mio. Lichtjahre'];
}
function fmtAlt(A) { const p = fmtAltParts(A); return p[0] + ' ' + p[1]; }
// [value, unit]: km/h, then km/s, then percent of light speed
function fmtSpeedParts(ms) {
  ms = Math.max(0, ms);
  if (ms < 2800) return [deNum(ms * 3.6), 'km/h'];
  if (ms < 0.05 * LIGHTSPEED) { const kms = ms / 1000; return [deNum(kms, Math.round(kms * 10) / 10 < 100 ? 1 : 0), 'km/s']; }
  const pct = Math.min(99.9, ms / LIGHTSPEED * 100);
  return [deNum(pct, pct < 99 ? 0 : 1), '% Licht'];
}
function fmtSpeed(ms) { const p = fmtSpeedParts(ms); return p[1] === '% Licht' ? p[0] + ' % Lichtgeschw.' : p[0] + ' ' + p[1]; }
// time-lapse factor as "×20.000" or "×5 Mrd."
function fmtLapse(x) {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(1, x))));
  const r = Math.round(x / e) * e;
  if (r < 1e6) return '×' + deNum(r);
  const [v, u] = r >= 1e15 ? [1e15, 'Brd.'] : r >= 1e12 ? [1e12, 'Bio.'] : r >= 1e9 ? [1e9, 'Mrd.'] : [1e6, 'Mio.'];
  return '×' + deNum(Math.round(r / v)) + ' ' + u;
}

if (typeof module !== 'undefined') {
  module.exports = { ZONES, ZH, zoneFrac, GOAL_H, SPACE_H, HEIGHT_BONUS, PHYS, launchSpeed, clamp, lerp, smooth, zoneIndexAt,
    LIGHTYEAR, LIGHTSPEED, SPEED_STOPS, fuelScarcity, displaySpeed, timeLapseAt, fmtSpeedParts, fmtLapse,
    altitudeAt, speedScaleAt, coinValueAt, gravity, airDensity, windAt, SKY_STOPS, cloudDensity, UPGRADES, UPG, niceRound, upgradeCost, ROCKETS, ROCKET_BY_ID,
    MISSIONS, defaultSave, normalizeSave, computeStats, REBIRTH_ZONES, rebirthZone, rebirthMult, canRebirth, applyRebirth,
    DAILY_POOL, dayKey, dailyReward, makeDaily, dailyText, dailyDone,
    PET_RARITIES, PET_TYPES, EGGS, PETS, PET_BY_ID, EGG_BY_ID, PET_MAX, petPower, petBonusValue, petSlots, eggUnlocked, bestEgg, eggCompleted, petBonus,
    hatchPet, equipBest, canFuse, fusePets, xpForLevel, flightXp, BOOSTS, boostActive, coinPack, LOGIN_REWARDS, GIFTS, WHEEL, WHEEL_EVERY, wheelPick, CODES, angDiff, stepRocket, deNum, fmtNum, fmtAltParts, fmtAlt, fmtSpeed };
}
