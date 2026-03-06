// ============================================================
// SPACE CLUCKERS - MVP Space Shooter (Mobile + Desktop)
// ============================================================
const GAME_VERSION = 'v0.4.2';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ── Responsive canvas sizing ─────────────────────────────────
const GAME_W = 480;
const GAME_H = 640;
canvas.width = GAME_W;
canvas.height = GAME_H;
let scale = 1;

function resizeCanvas() {
  const ratio = GAME_W / GAME_H;
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (w / h > ratio) { w = h * ratio; } else { h = w / ratio; }
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  scale = GAME_W / w;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Helper: convert page coords to canvas coords
function toCanvasCoords(pageX, pageY) {
  const rect = canvas.getBoundingClientRect();
  return { x: (pageX - rect.left) * scale, y: (pageY - rect.top) * scale };
}

// ── Audio (Web Audio API synthesis) ─────────────────────────
let AC;
function ensureAudio() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    loadSoundBuffers();
  }
  // Must resume in user gesture handler for iOS
  if (AC.state === 'suspended') {
    AC.resume().catch(() => {});
  }
}

function playTone(freq, type, dur, vol = 0.3) {
  if (!AC) return;
  try {
    const g = AC.createGain();
    const o = AC.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, AC.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, AC.currentTime + dur);
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch(e) {}
}

// Sound buffer loader — try flac first (Android/desktop), fallback to m4a (iOS)
const sfxBuffers = { hit: null, shoot: null, boom: null, claim: null };

function loadSoundBuffers() {
  if (!AC) return;
  ['hit', 'shoot', 'boom', 'claim'].forEach(name => {
    loadBuffer(`assets/sounds/${name}.flac`, name)
      .catch(() => loadBuffer(`assets/sounds/${name}.m4a`, name))
      .catch(() => {});
  });
}

function loadBuffer(url, name) {
  return fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => AC.decodeAudioData(buf))
    .then(decoded => { sfxBuffers[name] = decoded; });
}

function playBuffer(name, vol = 0.4) {
  if (!AC || !sfxBuffers[name]) return false;
  try {
    const src = AC.createBufferSource();
    const g = AC.createGain();
    src.buffer = sfxBuffers[name];
    g.gain.value = vol;
    src.connect(g); g.connect(AC.destination);
    src.start();
    return true;
  } catch(e) { return false; }
}

// Background music
const bgmTracks = ['assets/sounds/music1.ogg', 'assets/sounds/music2.ogg'];
let bgmAudio = null;

function playBGM() {
  const src = bgmTracks[Math.floor(Math.random() * bgmTracks.length)];
  stopBGM();
  bgmAudio = new Audio(src);
  bgmAudio.volume = 0.15;
  bgmAudio.loop = true;
  bgmAudio.play().catch(() => {});
}

function stopBGM() {
  if (bgmAudio) { bgmAudio.pause(); bgmAudio.currentTime = 0; }
  bgmAudio = null;
}

// Pause/resume BGM on tab visibility
document.addEventListener('visibilitychange', () => {
  if (!bgmAudio) return;
  if (document.hidden) bgmAudio.pause();
  else if (state === STATE.PLAY) bgmAudio.play().catch(() => {});
});

const SFX = {
  shoot:     () => { if (!playBuffer('shoot', 0.15)) playTone(880, 'square', 0.12, 0.15); },
  hit:       () => { if (!playBuffer('hit', 0.4)) playTone(220, 'sawtooth', 0.15, 0.3); },
  explode:   () => { if (!playBuffer('boom', 0.4)) playTone(80, 'sawtooth', 0.4, 0.4); },
  powerup:   () => { if (!playBuffer('claim', 0.35)) playTone(440, 'sine', 0.3, 0.35); },
  lose_life: () => playTone(150, 'square', 0.5, 0.4),
  gameover:  () => { stopBGM(); playTone(200, 'sawtooth', 0.6, 0.5); setTimeout(() => playTone(150, 'sawtooth', 0.6, 0.5), 400); }
};

// ── Galaxy Background Color System ───────────────────────────
// Cycles to next color each time a boss is defeated.
const GALAXY_COLORS = [
  [8, 18, 12],      // dark green space
  [55, 15, 80],     // purple nebula
  [12, 45, 90],     // deep ocean blue
  [85, 20, 30],     // crimson void
  [15, 75, 78],     // teal nebula
  [80, 55, 12],     // amber dust
  [85, 15, 70],     // magenta cloud
  [25, 55, 95],     // cobalt haze
];
let galaxyColorIdx = 0;
let galaxyFrom = GALAXY_COLORS[0].slice();
let galaxyTo = GALAXY_COLORS[0].slice();
let galaxyT = 1; // 0→1 transition progress (1 = complete)

function advanceGalaxyColor() {
  galaxyFrom = galaxyTo.slice();
  galaxyColorIdx = (galaxyColorIdx + 1) % GALAXY_COLORS.length;
  galaxyTo = GALAXY_COLORS[galaxyColorIdx].slice();
  galaxyT = 0;
  console.log('GALAXY COLOR →', galaxyColorIdx, galaxyTo);
}

function getGalaxyBg() {
  if (galaxyT < 1) galaxyT = Math.min(galaxyT + 0.003, 1); // ~5.5 sec transition
  const t = galaxyT;
  const r = Math.round(galaxyFrom[0] + (galaxyTo[0] - galaxyFrom[0]) * t);
  const g = Math.round(galaxyFrom[1] + (galaxyTo[1] - galaxyFrom[1]) * t);
  const b = Math.round(galaxyFrom[2] + (galaxyTo[2] - galaxyFrom[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// ── Multi-Planet Animated Sprite System ──────────────────────
// Loads procedurally-generated planet spritesheets (WebP first, PNG fallback).
// Spawns random planets as background decoration or boss visual.
const PLANET_CFG = {
  BASE_PATH: 'assets/planets/',
  ENABLED: true,
  FRAME_COUNT: 20, FRAME_W: 128, FRAME_H: 128, SHEET_COLS: 5, SHEET_ROWS: 4,
  catalog: [],
};
const PLANET_IDS = ['terra','mars','neptune','jupiter','venus','lava','toxic'];
let planetEntities = [];

// Load all planet spritesheets immediately (WebP first, PNG fallback)
function loadPlanetAssets() {
  if (PLANET_CFG.catalog.length > 0) return;
  for (const id of PLANET_IDS) {
    const entry = { id, sheet: new Image(), ready: false };
    const webpSrc = PLANET_CFG.BASE_PATH + id + '/sheet.webp';
    const pngSrc = PLANET_CFG.BASE_PATH + id + '/sheet.png';
    entry.sheet.onload = () => { entry.ready = true; };
    entry.sheet.onerror = () => {
      entry.sheet.onerror = () => { entry.ready = false; };
      entry.sheet.src = pngSrc;
    };
    entry.sheet.src = webpSrc;
    PLANET_CFG.catalog.push(entry);
  }
}
loadPlanetAssets();

// Pick a random loaded planet from catalog
function randomPlanetEntry() {
  const ready = PLANET_CFG.catalog.filter(p => p.ready);
  if (ready.length === 0) return null;
  return ready[Math.floor(Math.random() * ready.length)];
}

// Planet entity factory — _entry is direct reference to catalog entry (no lookup needed)
function createPlanetEntity(config) {
  return {
    x: config.x || GAME_W / 2,
    y: config.y || -80,
    mode: config.mode || 'background',
    _entry: config._entry || null,
    scale: config.scale || 0.5,
    rotation: config.rotation || 0,
    rotationSpeed: config.rotationSpeed || 0,
    animFps: config.animFps || 8,
    layer: config.layer || 0,
    alpha: config.alpha != null ? config.alpha : 0.6,
    vx: config.vx || 0,
    vy: config.vy || 0.3,
    animFrame: 0,
    animAccum: 0,
    alive: true,
    linkedBossId: config.linkedBossId || null,
  };
}

function updatePlanetEntity(s) {
  if (!s.alive) return;
  s.animAccum += s.animFps / 60;
  if (s.animAccum >= 1) {
    const advance = Math.floor(s.animAccum);
    s.animFrame = (s.animFrame + advance) % PLANET_CFG.FRAME_COUNT;
    s.animAccum -= advance;
  }
  s.rotation += s.rotationSpeed;
  s.x += s.vx;
  s.y += s.vy;

  if (s.mode === 'background') {
    if (s.y > GAME_H + PLANET_CFG.FRAME_H * s.scale) s.alive = false;
  } else if (s.mode === 'boss') {
    if (s.linkedBossId != null) {
      const boss = enemies.find(e => e.isBoss);
      if (boss) { s.x = boss.x; s.y = boss.y; }
      else { s.alive = false; }
    }
  }
}

function drawPlanetEntity(s) {
  if (!s.alive || !s._entry || !s._entry.ready) return;
  const f = s.animFrame;
  const col = f % PLANET_CFG.SHEET_COLS;
  const row = Math.floor(f / PLANET_CFG.SHEET_COLS);
  const sx = col * PLANET_CFG.FRAME_W;
  const sy = row * PLANET_CFG.FRAME_H;
  const dw = PLANET_CFG.FRAME_W * s.scale;
  const dh = PLANET_CFG.FRAME_H * s.scale;

  ctx.save();
  ctx.globalAlpha = s.alpha;
  ctx.translate(s.x, s.y);
  if (s.rotation !== 0) ctx.rotate(s.rotation);
  ctx.drawImage(s._entry.sheet, sx, sy, PLANET_CFG.FRAME_W, PLANET_CFG.FRAME_H, -dw / 2, -dh / 2, dw, dh);
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Planet Spawn Helpers ────────────────────────────────────
function spawnPlanetBackground(opts) {
  if (!PLANET_CFG.ENABLED) return null;
  const entry = randomPlanetEntry();
  if (!entry) return null;
  // Depth: 0=far(small,dim,slow) → 1=near(big,bright,fast)
  const depth = opts.depth != null ? opts.depth : Math.random();
  const sc = opts.scale || 0.45 + depth * 1.65;
  const alpha = opts.alpha != null ? opts.alpha : 0.15 + depth * 0.35;
  const spd = 0.08 + depth * 0.3;
  const s = createPlanetEntity({
    mode: 'background',
    _entry: entry,
    x: opts.x != null ? opts.x : Math.random() * GAME_W,
    y: opts.y != null ? opts.y : -(PLANET_CFG.FRAME_H * sc),
    scale: sc,
    rotationSpeed: 0,
    animFps: 0,
    layer: opts.layer || 0,
    alpha: alpha,
    vx: opts.vx || (Math.random() - 0.5) * 0.15,
    vy: opts.vy || spd,
  });
  planetEntities.push(s);
  return s;
}

function spawnPlanetBossVisual(opts) {
  if (!PLANET_CFG.ENABLED) return null;
  const entry = randomPlanetEntry();
  if (!entry) return null;
  const s = createPlanetEntity({
    mode: 'boss',
    _entry: entry,
    x: opts.x || GAME_W / 2,
    y: opts.y || -60,
    scale: opts.scale || 0.7,
    rotationSpeed: opts.rotationSpeed || 0.005,
    animFps: opts.animFps || 12,
    layer: opts.layer || 1,
    alpha: opts.alpha != null ? opts.alpha : 0.85,
    vx: 0, vy: 0,
    linkedBossId: true,
  });
  planetEntities.push(s);
  return s;
}

function despawnAllPlanets() {
  planetEntities.length = 0;
}

function cleanupPlanetEntities() {
  for (let i = planetEntities.length - 1; i >= 0; i--) {
    if (!planetEntities[i].alive) planetEntities.splice(i, 1);
  }
}

// ── Starfield ────────────────────────────────────────────────
const stars = Array.from({ length: 80 }, () => ({
  x: Math.random() * GAME_W,
  y: Math.random() * GAME_H,
  s: Math.random() * 2 + 0.5,
  spd: Math.random() * 1.5 + 0.5
}));

function updateStars() {
  for (const s of stars) {
    s.y += s.spd;
    if (s.y > GAME_H) { s.y = 0; s.x = Math.random() * GAME_W; }
  }
}

function drawStars() {
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    ctx.globalAlpha = 0.6 + Math.random() * 0.4;
    ctx.fillRect(s.x, s.y, s.s, s.s);
  }
  ctx.globalAlpha = 1;
}

// ── Chicken Image System ─────────────────────────────────────
const CHICKEN_IMGS = [
  'OrdinaryChickenRegular.webp',
  'chicken1.webp',
  'CowardChicken.webp',
  'DroneChicken.webp',
  'DroneChicken (1).webp',
  'CIU_NormalChicken_Elmo_Easter.webp',
  'CIU_NormalChicken_Pudgy_Summer.webp',
];
const BOSS_IMGS = [
  'boss/Phoenix_Chicken_.webp',
  'boss/UFOChicken.webp',
  'boss/SubmarineChicken.PNG.webp',
  'boss/Chiller3.webp',
  'boss/CIU_ArmoredChicken_Xmas.webp',
  'boss/CIU_Alchemist_Easter.webp',
  'boss/chicken.webp',
];
const CHICKEN_BASE = 'assets/chicken/';
const chickenSheets = []; // [{img, ready}]
const bossSheets = [];
let waveChickenIdx = 0;   // which chicken image this wave uses
let waveBossIdx = 0;      // which boss image this wave uses

function loadChickenAssets() {
  for (const f of CHICKEN_IMGS) {
    const entry = { img: new Image(), ready: false };
    entry.img.onload = () => { entry.ready = true; };
    entry.img.src = CHICKEN_BASE + f;
    chickenSheets.push(entry);
  }
  for (const f of BOSS_IMGS) {
    const entry = { img: new Image(), ready: false };
    entry.img.onload = () => { entry.ready = true; };
    entry.img.src = CHICKEN_BASE + f;
    bossSheets.push(entry);
  }
}
loadChickenAssets();

// ── Drawing helpers ──────────────────────────────────────────
function drawPlayer(x, y) {
  ctx.fillStyle = '#00eeff';
  ctx.beginPath();
  ctx.moveTo(x, y - 18);
  ctx.lineTo(x - 14, y + 14);
  ctx.lineTo(x, y + 8);
  ctx.lineTo(x + 14, y + 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 4, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff6600';
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 14);
  ctx.lineTo(x, y + 20 + Math.random() * 6);
  ctx.lineTo(x + 7, y + 14);
  ctx.closePath();
  ctx.fill();
}

function drawWingman(x, y) {
  ctx.fillStyle = '#66ccff';
  ctx.beginPath();
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x - 8, y + 8);
  ctx.lineTo(x, y + 5);
  ctx.lineTo(x + 8, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff6600';
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 8);
  ctx.lineTo(x, y + 12 + Math.random() * 3);
  ctx.lineTo(x + 4, y + 8);
  ctx.closePath();
  ctx.fill();
}

function drawChicken(x, y, t) {
  const entry = chickenSheets[waveChickenIdx];
  if (entry && entry.ready) {
    const bob = Math.sin(t * 0.1) * 3;
    const sz = 40;
    ctx.drawImage(entry.img, x - sz / 2, y - sz / 2 + bob, sz, sz);
  } else {
    // Fallback: hand-drawn chicken
    const flap = Math.sin(t * 0.1) * 4;
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath(); ctx.ellipse(x, y, 14, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y - 16, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff3333';
    ctx.beginPath(); ctx.ellipse(x, y - 24, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff9900';
    ctx.beginPath(); ctx.moveTo(x + 8, y - 16); ctx.lineTo(x + 14, y - 13); ctx.lineTo(x + 8, y - 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(x + 3, y - 17, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e6b800';
    ctx.beginPath(); ctx.ellipse(x - 16, y + flap, 7, 5, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 16, y - flap, 7, 5, 0.4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawExplosion(x, y, frame) {
  const r = frame * 4;
  const alpha = 1 - frame / 12;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffff00';
  ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

// ── Weapon System (11 types, data-driven) ──────────────────
// Each weapon: id, name, color, maxTier, baseCooldown, minCooldown,
//   pickup shape key, fire function key
const WEAPON_DB = [
  { id: 0,  name: 'Blaster',     color: '#00ffff', maxTier: 8, baseCd: 12, minCd: 5,  shape: 'diamond',   pierce: false },
  { id: 1,  name: 'Neutron',     color: '#ff00ff', maxTier: 8, baseCd: 10, minCd: 4,  shape: 'circle',    pierce: false },
  { id: 2,  name: 'Spread',      color: '#00ff66', maxTier: 8, baseCd: 16, minCd: 7,  shape: 'star',      pierce: false },
  { id: 3,  name: 'Laser',       color: '#ff4444', maxTier: 8, baseCd: 18, minCd: 8,  shape: 'bolt',      pierce: true  },
  { id: 4,  name: 'Ion',         color: '#44aaff', maxTier: 8, baseCd: 14, minCd: 6,  shape: 'hexagon',   pierce: false },
  { id: 5,  name: 'Plasma',      color: '#ff8800', maxTier: 8, baseCd: 20, minCd: 9,  shape: 'triangle',  pierce: false },
  { id: 6,  name: 'Vulcan',      color: '#ffff00', maxTier: 8, baseCd: 6,  minCd: 2,  shape: 'cross',     pierce: false },
  { id: 7,  name: 'Lightning',   color: '#aa88ff', maxTier: 8, baseCd: 15, minCd: 6,  shape: 'zigzag',    pierce: true  },
  { id: 8,  name: 'Fireball',    color: '#ff5500', maxTier: 8, baseCd: 22, minCd: 10, shape: 'flame',     pierce: false },
  { id: 9,  name: 'Boron',       color: '#88ff88', maxTier: 8, baseCd: 13, minCd: 5,  shape: 'pentagon',  pierce: false },
  { id: 10, name: 'Photon',      color: '#ffffff', maxTier: 8, baseCd: 11, minCd: 4,  shape: 'ring',      pierce: false },
];
const WEAPON_COUNT = WEAPON_DB.length;
const PICKUP_DROP_CHANCE = 0.12;
const MAX_TIER_SCORE_BONUS = 50;
const GROWTH_CAP = 3.0;

// ── Ammo Pool System ────────────────────────────────────────
// Within each 5-wave block, only 3-4 weapon types can drop.
// After each boss clear, +1 new type unlocks into pool.
const INITIAL_UNLOCKED = 3;   // start with 3 weapon types available
const POOL_SIZE_PER_BLOCK = 4; // 3-4 types drop per 5-wave block [ASSUMPTION: 4]
const GAUGE_MAX = 50;          // leaf+drumstick gauge capacity
const GAUGE_COOLDOWN = 300;    // 5 sec anti-spam after Explode All
const LEAF_VALUE = 1;
const DRUMSTICK_VALUE = 3;
const LEAF_DROP_CHANCE = 0.25;       // per enemy kill
const DRUMSTICK_DROP_CHANCE = 0.08;  // rarer, per enemy kill

// ── State ────────────────────────────────────────────────────
const STATE = { START: 0, PLAY: 1, GAMEOVER: 2, PAUSED: 3 };
let state = STATE.START;

let player, wingmen, bullets, enemies, enemyBullets, explosions, particles, pickups;
const MAX_LIVES = 5;
const HEAT_MAX = 100;         // overheat threshold
const HEAT_PER_SHOT = 4;      // heat added per shot (~25 shots to overheat)
const HEAT_COOL_RATE = 0.6;   // heat lost per frame (natural cooling)
const OVERHEAT_LOCKOUT = 300; // 5 seconds at 60fps
let score, lives, wave, waveTimer, spawnTimer, tick;
let shakeTimer = 0;
let bossActive = false;
let highScore = parseInt(localStorage.getItem('sc_hi') || '0');

let unlockedWeaponCount, ammoPool, gauge, gaugeItems;

function initGame() {
  player = {
    x: GAME_W / 2, y: GAME_H - 60, w: 28, h: 36, speed: 4,
    shootCooldown: 0,
    heat: 0,              // current heat level (0 to HEAT_MAX)
    overheated: false,     // true = locked out from firing
    overheatTimer: 0,      // frames remaining in lockout
    isFiring: false,       // true during frames where player is shooting
    weaponId: 0,  // index into WEAPON_DB
    weaponTier: 0 // 0-based, max = WEAPON_DB[id].maxTier - 1
  };
  wingmen = [
    { offsetX: -30, offsetY: 10, x: player.x - 30, y: player.y + 10 },
    { offsetX:  30, offsetY: 10, x: player.x + 30, y: player.y + 10 }
  ];
  bullets = [];
  enemies = [];
  enemyBullets = [];
  explosions = [];
  particles = [];
  pickups = [];
  gaugeItems = [];  // falling leaf/drumstick collectibles
  score = 0; lives = MAX_LIVES; wave = 0; tick = 0;
  waveTimer = 0; spawnTimer = 0;
  bossActive = false;
  unlockedWeaponCount = INITIAL_UNLOCKED;
  ammoPool = [];
  gauge = { value: 0, cooldown: 0, flashTimer: 0 };
  despawnAllPlanets();
  galaxyColorIdx = 0; galaxyFrom = GALAXY_COLORS[0].slice(); galaxyTo = GALAXY_COLORS[0].slice(); galaxyT = 1;
  spawnWave();
}

// ── Boss System ─────────────────────────────────────────────
const BOSS_INTERVAL = 5; // boss every 5 waves
function shouldSpawnBoss(round) {
  return round > 0 && round % BOSS_INTERVAL === 0;
}

function spawnBossForRound(round) {
  if (bossActive) return;
  const milestone = round / BOSS_INTERVAL;
  bossActive = true;
  // HP: early bosses manageable, scaling with diminishing returns
  const baseHp = 20 + milestone * 15;
  const scaledHp = Math.min(baseHp, 200); // hard cap
  enemies.push({
    x: GAME_W / 2, y: -60, w: 60, h: 50,
    hp: scaledHp, maxHp: scaledHp,
    pattern: 'boss', t: 0, dir: 1,
    shootTimer: 60,
    spreadTimer: Math.max(60, 120 - milestone * 5), // faster spread at higher milestones
    milestone, isBoss: true
  });
  // Attach planet visual to boss (behind boss sprite)
  spawnPlanetBossVisual({ x: GAME_W / 2, y: -60, scale: 0.55 + milestone * 0.08 });
}

function drawBossChicken(x, y, t, hpRatio) {
  const entry = bossSheets[waveBossIdx];
  const sz = 90;
  if (entry && entry.ready) {
    const bob = Math.sin(t * 0.08) * 4;
    ctx.drawImage(entry.img, x - sz / 2, y - sz / 2 + bob, sz, sz);
  } else {
    // Fallback: hand-drawn boss
    const flap = Math.sin(t * 0.08) * 6;
    ctx.fillStyle = '#ff6600';
    ctx.beginPath(); ctx.ellipse(x, y, 28, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffaa00';
    ctx.beginPath(); ctx.ellipse(x, y - 28, 14, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 38); ctx.lineTo(x - 8, y - 48); ctx.lineTo(x - 4, y - 40);
    ctx.lineTo(x, y - 50); ctx.lineTo(x + 4, y - 40); ctx.lineTo(x + 8, y - 48); ctx.lineTo(x + 12, y - 38);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff0000';
    ctx.beginPath(); ctx.arc(x - 5, y - 30, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 5, y - 30, 3, 0, Math.PI * 2); ctx.fill();
  }
  // HP bar (always drawn)
  const barW = 60;
  const barH = 5;
  ctx.fillStyle = '#333';
  ctx.fillRect(x - barW / 2, y - sz / 2 - 8, barW, barH);
  ctx.fillStyle = hpRatio > 0.5 ? '#00ff00' : hpRatio > 0.25 ? '#ffff00' : '#ff0000';
  ctx.fillRect(x - barW / 2, y - sz / 2 - 8, barW * hpRatio, barH);
}

// ── Ammo Pool Logic ─────────────────────────────────────────
// Builds the pool of droppable weapon ids for current 5-wave block.
// Uses deterministic seed from block index so pool is stable within block.
function buildAmmoPool(waveNum) {
  const block = Math.floor((waveNum - 1) / BOSS_INTERVAL); // 0-based block index
  const available = Math.min(unlockedWeaponCount, WEAPON_COUNT);
  const poolSize = Math.min(POOL_SIZE_PER_BLOCK, available);
  // Seeded shuffle: pick poolSize from first `available` weapon ids
  // Simple deterministic pick using block as offset
  const pool = [];
  for (let i = 0; i < available; i++) pool.push(i);
  // Fisher-Yates with deterministic seed
  let seed = block * 7 + 13;
  for (let i = pool.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  return pool.slice(0, poolSize);
}

function onBossDefeated(milestone) {
  // Unlock +1 new weapon type (up to max 11)
  if (unlockedWeaponCount < WEAPON_COUNT) {
    unlockedWeaponCount++;
  }
  // Rebuild pool for next block
  ammoPool = buildAmmoPool(wave + 1);
  // Shift galaxy background color
  advanceGalaxyColor();
}

// ── Wave / Enemy patterns ───────────────────────────────────
function spawnWave() {
  wave++;
  // Bonus life every 10 waves
  if (wave > 1 && wave % 10 === 1 && lives < MAX_LIVES) {
    lives++;
    SFX.powerup();
  }
  enemies = [];
  // Random chicken type per wave (same within a wave)
  waveChickenIdx = Math.floor(Math.random() * chickenSheets.length);
  // Rebuild ammo pool at start of each new 5-wave block (or first wave)
  if ((wave - 1) % BOSS_INTERVAL === 0 || ammoPool.length === 0) {
    ammoPool = buildAmmoPool(wave);
  }

  if (shouldSpawnBoss(wave)) {
    waveBossIdx = Math.floor(Math.random() * bossSheets.length);
    spawnBossForRound(wave);
    return;
  }

  const rows = 2 + Math.floor(wave / 2);
  const cols = 6;
  const enemyHp = 1 + Math.floor(wave / 5);

  if (wave % 3 === 0) {
    for (let i = 0; i < 10; i++) {
      enemies.push({
        x: GAME_W / 2 + (i % 2 === 0 ? -1 : 1) * (Math.floor(i / 2) + 1) * 40,
        y: -30 - i * 20, w: 28, h: 28, hp: enemyHp,
        pattern: 'rush', t: 0, angle: Math.PI / 2,
        shootTimer: 60 + Math.random() * 60
      });
    }
  } else if (wave % 3 === 1) {
    for (let r = 0; r < Math.min(rows, 4); r++) {
      for (let c = 0; c < cols; c++) {
        enemies.push({
          x: 60 + c * 65, y: -30 - r * 55, w: 28, h: 28, hp: enemyHp,
          pattern: 'grid', t: 0, dir: 1,
          gridTargetY: 60 + r * 55, // target Y to fly down to
          shootTimer: 80 + Math.random() * 80
        });
      }
    }
  } else {
    for (let i = 0; i < 8 + wave; i++) {
      enemies.push({
        x: Math.random() * (GAME_W - 60) + 30,
        y: -40 - i * 35, w: 28, h: 28, hp: enemyHp,
        pattern: 'swoop', t: 0,
        shootTimer: 70 + Math.random() * 60
      });
    }
  }
}

// ── Input (keyboard) ────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyP' && state === STATE.PLAY) state = STATE.PAUSED;
  else if (e.code === 'KeyP' && state === STATE.PAUSED) state = STATE.PLAY;
  if (e.code === 'KeyE' && state === STATE.PLAY) tryExplodeAll();
  if (e.code === 'Space') {
    if (state === STATE.START) { startGame(); }
    else if (state === STATE.GAMEOVER) { state = STATE.START; }
    else if (state === STATE.PLAY) tryShoot();
    e.preventDefault();
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('click', () => {
  if (state === STATE.START) { startGame(); }
  else if (state === STATE.GAMEOVER) { state = STATE.START; }
});

function startGame() {
  ensureAudio();
  playBGM();
  state = STATE.PLAY;
  initGame();
}

// ── Mouse follow (desktop) ──────────────────────────────────
let mouseTarget = null;
let isMouseDown = false;

canvas.addEventListener('mousedown', e => {
  if (state !== STATE.PLAY) return;
  isMouseDown = true;
  mouseTarget = toCanvasCoords(e.pageX, e.pageY);
});

canvas.addEventListener('mousemove', e => {
  if (state !== STATE.PLAY || !isMouseDown) return;
  mouseTarget = toCanvasCoords(e.pageX, e.pageY);
});

canvas.addEventListener('mouseup', () => { isMouseDown = false; mouseTarget = null; });
canvas.addEventListener('mouseleave', () => { isMouseDown = false; mouseTarget = null; });

// ── Touch follow (mobile) ───────────────────────────────────
let touchTarget = null;
let isTouching = false;
const TOUCH_OFFSET_Y = -60; // ship appears above finger so it's visible

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  ensureAudio();

  if (state === STATE.START) { startGame(); return; }
  if (state === STATE.GAMEOVER) { state = STATE.START; return; }
  if (state !== STATE.PLAY) return;

  const t = e.changedTouches[0];
  const pos = toCanvasCoords(t.pageX, t.pageY);
  // Bomb button hit test (bottom-right circle)
  const bx = GAME_W - 70, by = GAME_H - 70, br = 35;
  if (Math.hypot(pos.x - bx, pos.y - by) < br) { tryExplodeAll(); return; }
  touchTarget = { x: pos.x, y: pos.y + TOUCH_OFFSET_Y };
  isTouching = true;
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  const pos = toCanvasCoords(t.pageX, t.pageY);
  touchTarget = { x: pos.x, y: pos.y + TOUCH_OFFSET_Y };
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  isTouching = false;
  touchTarget = null;
}, { passive: false });

canvas.addEventListener('touchcancel', () => { isTouching = false; touchTarget = null; });

// ── Progressive Power Scaling ───────────────────────────────
// Curve: early modest, mid noticeable, late diminishing returns
// Returns { cooldown, damage } based on wave + weapon tier
function computeWeaponPowerByTier(waveNum, weaponId, tier) {
  const w = WEAPON_DB[weaponId];
  if (!w) return { cooldown: 12, damage: 1 };
  // Wave progression factor: log2 curve, capped
  const waveFactor = Math.min(1 + Math.log2(1 + Math.max(0, waveNum)) * 0.25, GROWTH_CAP);
  // Tier multiplier: each tier gives ~15% boost, diminishing
  const tierMult = 1 + Math.log2(1 + Math.max(0, tier)) * 0.4;
  const combined = Math.min(waveFactor * tierMult, GROWTH_CAP * 2); // hard cap 6.0
  const cd = Math.max(Math.round(w.baseCd / combined), w.minCd);
  const dmg = Math.max(1, Math.min(Math.floor(combined), 6)); // 1-6 damage range
  return { cooldown: cd, damage: dmg };
}

// ── Weapon Fire Patterns ────────────────────────────────────
// tier: 0-7, higher = more bullets / wider spread / bigger projectiles
// Spawn bullets from a given position using current weapon
function spawnBulletsAt(px, py, scale, tierOverride) {
  const w = WEAPON_DB[player.weaponId];
  const tier = tierOverride !== undefined ? tierOverride : player.weaponTier;
  const power = computeWeaponPowerByTier(wave, player.weaponId, tier);
  const color = w.color;
  const pierce = w.pierce;
  const dmg = Math.max(1, Math.round(power.damage * scale));

  // Bullet count scales with tier for most weapons
  const bc = Math.min(1 + Math.floor(tier / 2), 5); // 1-5 streams

  switch (w.id) {
    case 0: // Blaster — straight shots, more streams at higher tiers
      for (let i = 0; i < bc; i++) {
        const off = (i - (bc - 1) / 2) * 8;
        bullets.push({ x: px + off, y: py, w: 4, h: 12, vx: 0, vy: -10, color, damage: dmg, pierce });
      }
      break;

    case 1: // Neutron — twin angled shots that converge
      for (let i = 0; i < bc; i++) {
        const ang = (i - (bc - 1) / 2) * 0.08;
        bullets.push({ x: px, y: py, w: 5, h: 10, vx: Math.sin(ang) * 10, vy: -10 * Math.cos(ang), color, damage: dmg, pierce });
      }
      break;

    case 2: // Spread — fan of bullets
      { const count = 2 + bc; // 3-7 bullets
        for (let i = 0; i < count; i++) {
          const ang = (i - (count - 1) / 2) * 0.18;
          bullets.push({ x: px, y: py, w: 3, h: 8, vx: Math.sin(ang) * 10, vy: -10 * Math.cos(ang), color, damage: dmg, pierce });
        }
      }
      break;

    case 3: // Laser — wide beam, pierces
      { const bw = 6 + tier * 2;
        bullets.push({ x: px, y: py, w: bw, h: 22, vx: 0, vy: -8, color, damage: dmg, pierce: true });
      }
      break;

    case 4: // Ion — homing-ish: slight curve toward nearest enemy
      for (let i = 0; i < bc; i++) {
        const off = (i - (bc - 1) / 2) * 10;
        bullets.push({ x: px + off, y: py, w: 5, h: 5, vx: 0, vy: -9, color, damage: dmg, pierce, isIon: true });
      }
      break;

    case 5: // Plasma — big slow orbs, high damage
      { const count = Math.min(1 + Math.floor(tier / 3), 3);
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 14;
          bullets.push({ x: px + off, y: py, w: 10 + tier, h: 10 + tier, vx: 0, vy: -6, color, damage: dmg + 1, pierce });
        }
      }
      break;

    case 6: // Vulcan — very fast tiny bullets
      { const count = 1 + Math.floor(tier / 2);
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 6;
          const spread = (Math.random() - 0.5) * 0.15;
          bullets.push({ x: px + off, y: py, w: 3, h: 6, vx: Math.sin(spread) * 12, vy: -12, color, damage: dmg, pierce });
        }
      }
      break;

    case 7: // Lightning — zigzag path
      for (let i = 0; i < bc; i++) {
        const off = (i - (bc - 1) / 2) * 10;
        bullets.push({ x: px + off, y: py, w: 3, h: 14, vx: 0, vy: -9, color, damage: dmg, pierce: true, isZigzag: true, zigT: 0 });
      }
      break;

    case 8: // Fireball — arcing splash projectiles
      { const count = Math.min(1 + Math.floor(tier / 2), 4);
        for (let i = 0; i < count; i++) {
          const ang = (i - (count - 1) / 2) * 0.12;
          bullets.push({ x: px, y: py, w: 8, h: 8, vx: Math.sin(ang) * 8, vy: -9, color, damage: dmg + 1, pierce, isSplash: true });
        }
      }
      break;

    case 9: // Boron — twin parallel streams, widen with tier
      { const count = 2 + Math.floor(tier / 2);
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * (6 + tier);
          bullets.push({ x: px + off, y: py, w: 4, h: 10, vx: 0, vy: -10, color, damage: dmg, pierce });
        }
      }
      break;

    case 10: // Photon — swirl pattern
      for (let i = 0; i < bc; i++) {
        const ang = (tick * 0.15) + (i * Math.PI * 2 / bc);
        bullets.push({ x: px, y: py, w: 4, h: 10, vx: Math.sin(ang) * 3, vy: -10, color, damage: dmg, pierce });
      }
      break;
  }
}

function tryShoot() {
  if (player.shootCooldown > 0) return;
  const power = computeWeaponPowerByTier(wave, player.weaponId, player.weaponTier);
  // Player fires only if not overheated
  if (!player.overheated) {
    spawnBulletsAt(player.x, player.y - 18, 1);
    player.isFiring = true;
  }
  // Wingmen always fire same weapon as player but at tier 0 (not affected by overheat)
  for (const wm of wingmen) {
    spawnBulletsAt(wm.x, wm.y - 10, 0.5, 0);
  }
  player.shootCooldown = power.cooldown;
  SFX.shoot();
}

// ── Pickup System (Chicken Invaders style) ──────────────────
// Same-type pickup = level up tier. Different-type = switch weapon (tier resets to 0).
// Max tier + same-type = score bonus fallback.
function onPickupAmmoItem(pickupWeaponId) {
  if (pickupWeaponId < 0 || pickupWeaponId >= WEAPON_COUNT) return false;
  if (pickupWeaponId === player.weaponId) {
    return applySameTypeLevelUp();
  } else {
    return switchAmmoType(pickupWeaponId);
  }
}

function applySameTypeLevelUp() {
  const w = WEAPON_DB[player.weaponId];
  if (player.weaponTier >= w.maxTier - 1) {
    // Already max tier — fallback reward
    score += MAX_TIER_SCORE_BONUS;
    SFX.powerup();
    return true;
  }
  player.weaponTier++;
  SFX.powerup();
  return true;
}

function switchAmmoType(newWeaponId) {
  // [ASSUMPTION] Switch resets tier to 0 (Chicken Invaders convention)
  player.weaponId = newWeaponId;
  player.weaponTier = 0;
  SFX.powerup();
  return true;
}

function spawnPickup(x, y) {
  // Only drop from current wave's ammo pool
  const pool = ammoPool.length > 0 ? ammoPool : [0];
  const weaponId = pool[Math.floor(Math.random() * pool.length)];
  pickups.push({ x, y, weaponId, vy: 1.5, t: 0 });
}

function spawnPickupGuaranteed(x, y, weaponId) {
  pickups.push({ x, y, weaponId, vy: 1.5, t: 0 });
}

// ── Pickup Visuals (11 distinct shapes) ─────────────────────
function drawPickup(p) {
  const w = WEAPON_DB[p.weaponId];
  if (!w) return;
  const color = w.color;
  const s = 9; // base size
  const rot = p.t * 0.04;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  switch (w.shape) {
    case 'diamond': // Blaster
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
      ctx.closePath(); ctx.fill();
      break;
    case 'circle': // Neutron
      ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
      break;
    case 'star': // Spread — 5-point star
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a1 = (i * 2 * Math.PI / 5) - Math.PI / 2;
        const a2 = a1 + Math.PI / 5;
        ctx.lineTo(Math.cos(a1) * s, Math.sin(a1) * s);
        ctx.lineTo(Math.cos(a2) * s * 0.45, Math.sin(a2) * s * 0.45);
      }
      ctx.closePath(); ctx.fill();
      break;
    case 'bolt': // Laser — lightning bolt
      ctx.beginPath();
      ctx.moveTo(-3, -s); ctx.lineTo(3, -s); ctx.lineTo(1, -2);
      ctx.lineTo(5, -2); ctx.lineTo(-2, s); ctx.lineTo(0, 1);
      ctx.lineTo(-4, 1);
      ctx.closePath(); ctx.fill();
      break;
    case 'hexagon': // Ion
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      }
      ctx.closePath(); ctx.fill();
      break;
    case 'triangle': // Plasma — thick triangle
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s, s * 0.7); ctx.lineTo(-s, s * 0.7);
      ctx.closePath(); ctx.fill();
      break;
    case 'cross': // Vulcan — plus sign
      { const a = s * 0.35;
        ctx.fillRect(-a, -s, a * 2, s * 2);
        ctx.fillRect(-s, -a, s * 2, a * 2);
      }
      break;
    case 'zigzag': // Lightning — zigzag line
      ctx.beginPath();
      ctx.moveTo(-s, -s); ctx.lineTo(0, -s * 0.3); ctx.lineTo(-s * 0.5, 0);
      ctx.lineTo(s * 0.3, s * 0.3); ctx.lineTo(-s * 0.2, s);
      ctx.lineTo(s, s); ctx.lineTo(0, s * 0.3); ctx.lineTo(s * 0.5, 0);
      ctx.lineTo(-s * 0.3, -s * 0.3); ctx.lineTo(s * 0.2, -s);
      ctx.closePath(); ctx.fill();
      break;
    case 'flame': // Fireball — flame shape
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s, -s * 0.3, s * 0.6, s * 0.5);
      ctx.quadraticCurveTo(s * 0.2, s * 0.3, 0, s);
      ctx.quadraticCurveTo(-s * 0.2, s * 0.3, -s * 0.6, s * 0.5);
      ctx.quadraticCurveTo(-s, -s * 0.3, 0, -s);
      ctx.closePath(); ctx.fill();
      break;
    case 'pentagon': // Boron
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      }
      ctx.closePath(); ctx.fill();
      break;
    case 'ring': // Photon — hollow ring
      ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();
      break;
    default:
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
      ctx.closePath(); ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ── Leaf + Drumstick Gauge System ────────────────────────────
function spawnGaugeItem(x, y, type) {
  // type: 'leaf' or 'drumstick'
  gaugeItems.push({ x, y, type, vy: 1.8, t: 0 });
}

function trySpawnGaugeDrops(x, y) {
  if (Math.random() < LEAF_DROP_CHANCE) spawnGaugeItem(x, y, 'leaf');
  if (Math.random() < DRUMSTICK_DROP_CHANCE) spawnGaugeItem(x, y, 'drumstick');
}

function addGauge(amount) {
  gauge.value = Math.min(gauge.value + amount, GAUGE_MAX); // overflow-safe
}

function tryExplodeAll() {
  if (gauge.value < GAUGE_MAX) return false;
  if (gauge.cooldown > 0) return false;
  // Kill all non-boss enemies on screen
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.isBoss) {
      // Boss takes 30% max HP damage instead of instant kill
      e.hp -= Math.ceil(e.maxHp * 0.3);
      if (e.hp <= 0) e.hp = 1; // don't let Explode All fully kill boss [ASSUMPTION]
      continue;
    }
    spawnExplosion(e.x, e.y);
    score += 10;
    // Gauge items don't drop from explode-all kills [ASSUMPTION: prevent feedback loop]
    enemies.splice(i, 1);
  }
  // Clear enemy bullets too for dramatic effect
  enemyBullets.length = 0;
  gauge.value = 0;
  gauge.cooldown = GAUGE_COOLDOWN;
  gauge.flashTimer = 30; // white flash frames
  shakeTimer = 15;
  SFX.explode();
  // Double tone for big boom
  playTone(120, 'sawtooth', 0.6, 0.5);
  return true;
}

function drawGaugeItem(item) {
  ctx.save();
  ctx.translate(item.x, item.y);
  const bob = Math.sin(item.t * 0.1) * 2;
  ctx.translate(0, bob);

  if (item.type === 'leaf') {
    // Green leaf shape
    ctx.fillStyle = '#44cc44';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.quadraticCurveTo(6, -2, 4, 4);
    ctx.quadraticCurveTo(0, 6, -4, 4);
    ctx.quadraticCurveTo(-6, -2, 0, -6);
    ctx.closePath();
    ctx.fill();
    // Vein
    ctx.strokeStyle = '#228822';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.stroke();
  } else {
    // Drumstick: brown shape
    ctx.fillStyle = '#cc8844';
    ctx.beginPath();
    ctx.ellipse(0, -2, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bone handle
    ctx.fillStyle = '#eeddcc';
    ctx.fillRect(-1.5, 2, 3, 7);
    // Bone end knob
    ctx.beginPath();
    ctx.arc(0, 9, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Update ───────────────────────────────────────────────────
function update() {
  if (state !== STATE.PLAY) return;
  tick++;

  // Keyboard movement
  let kbDx = 0, kbDy = 0;
  if (keys['ArrowLeft'] || keys['KeyA']) kbDx -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) kbDx += 1;
  if (keys['ArrowUp'] || keys['KeyW']) kbDy -= 1;
  if (keys['ArrowDown'] || keys['KeyS']) kbDy += 1;
  const kbLen = Math.sqrt(kbDx * kbDx + kbDy * kbDy);
  if (kbLen > 0) {
    player.x += (kbDx / kbLen) * player.speed;
    player.y += (kbDy / kbLen) * player.speed;
  }

  // Mouse/touch follow: ship smoothly moves toward target
  const followTarget = touchTarget || mouseTarget;
  if (followTarget) {
    const fdx = followTarget.x - player.x;
    const fdy = followTarget.y - player.y;
    const fdist = Math.sqrt(fdx * fdx + fdy * fdy);
    if (fdist > 2) {
      const moveSpeed = Math.min(fdist, player.speed * 2);
      player.x += (fdx / fdist) * moveSpeed;
      player.y += (fdy / fdist) * moveSpeed;
    }
    // Auto-shoot while following
    tryShoot();
  }

  // Clamp to bounds
  player.x = Math.max(player.w / 2 + 5, Math.min(GAME_W - player.w / 2 - 5, player.x));
  player.y = Math.max(player.h / 2 + 5, Math.min(GAME_H - player.h / 2 - 5, player.y));

  // Wingmen smoothly follow toward target offset position
  for (const wm of wingmen) {
    const tx = player.x + wm.offsetX;
    const ty = player.y + wm.offsetY;
    wm.x += (tx - wm.x) * 0.12;
    wm.y += (ty - wm.y) * 0.12;
  }

  // Auto-shoot while Space held
  if (keys['Space']) tryShoot();
  if (player.shootCooldown > 0) player.shootCooldown--;
  // Heat system: accumulate while firing, cool when idle
  if (player.overheated) {
    player.overheatTimer--;
    if (player.overheatTimer <= 0) {
      player.overheated = false;
      player.heat = 0;
    }
  } else if (player.isFiring) {
    player.heat = Math.min(HEAT_MAX, player.heat + HEAT_PER_SHOT);
    if (player.heat >= HEAT_MAX) {
      player.overheated = true;
      player.overheatTimer = OVERHEAT_LOCKOUT;
    }
  } else {
    player.heat = Math.max(0, player.heat - HEAT_COOL_RATE);
  }
  player.isFiring = false; // reset each frame, tryShoot sets it

  // Bullets (with special movement for ion/zigzag)
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    // Ion bullets: slight homing toward nearest enemy
    if (b.isIon && enemies.length > 0) {
      let nearest = null, nd = Infinity;
      for (const e of enemies) {
        const d = Math.abs(e.x - b.x) + Math.abs(e.y - b.y);
        if (d < nd) { nd = d; nearest = e; }
      }
      if (nearest) {
        const dx = nearest.x - b.x;
        b.vx += (dx > 0 ? 0.3 : -0.3); // gentle homing
        b.vx = Math.max(-4, Math.min(4, b.vx)); // clamp
      }
    }
    // Zigzag bullets: oscillate x
    if (b.isZigzag) {
      b.zigT = (b.zigT || 0) + 1;
      b.vx = Math.sin(b.zigT * 0.3) * 3;
    }
    b.x += (b.vx || 0);
    b.y += b.vy;
    if (b.y < -20 || b.x < -20 || b.x > GAME_W + 20) bullets.splice(i, 1);
  }

  // Enemy bullets
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    b.x += b.vx; b.y += b.vy;
    if (b.y > GAME_H + 20 || b.x < -20 || b.x > GAME_W + 20)
      enemyBullets.splice(i, 1);
  }

  // Enemies
  const speed = 1 + wave * 0.15;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.t++;

    if (e.pattern === 'boss') {
      // Boss movement: enter from top, oscillate side-to-side
      if (e.y < 80) { e.y += 1; }
      else {
        e.x += e.dir * 1.5;
        if (e.x > GAME_W - 60 || e.x < 60) e.dir *= -1;
      }
      // Aimed shot
      e.shootTimer--;
      if (e.shootTimer <= 0 && e.y >= 80) {
        const edx = player.x - e.x;
        const edy = player.y - e.y;
        const edist = Math.sqrt(edx * edx + edy * edy);
        const spd = 3.5;
        enemyBullets.push({ x: e.x, y: e.y + 25, vx: (edx / edist) * spd, vy: (edy / edist) * spd, w: 8, h: 12 });
        e.shootTimer = 40;
      }
      // Spread burst
      e.spreadTimer--;
      if (e.spreadTimer <= 0 && e.y >= 80) {
        for (let a = -2; a <= 2; a++) {
          const angle = (a / 2) * 0.4 + Math.PI / 2;
          enemyBullets.push({
            x: e.x, y: e.y + 25,
            vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3,
            w: 6, h: 10
          });
        }
        e.spreadTimer = 90;
      }
    } else if (e.pattern === 'grid') {
      // Fly down to formation position first, then move side-to-side
      if (e.gridTargetY != null && e.y < e.gridTargetY) {
        e.y += 2.5;
      } else {
        e.x += e.dir * speed;
        if (e.x > GAME_W - 40 || e.x < 40) e.dir *= -1;
        e.y += 0.08 * wave;
      }
    } else if (e.pattern === 'swoop') {
      e.y += speed * 0.8;
      e.x += Math.sin(e.t * 0.04 + i) * 2.5;
    } else if (e.pattern === 'rush') {
      e.y += speed * 1.5;
    }

    if (e.pattern !== 'boss') {
      e.shootTimer--;
      if (e.shootTimer <= 0 && e.y > 0) {
        const edx = player.x - e.x;
        const edy = player.y - e.y;
        const edist = Math.sqrt(edx * edx + edy * edy);
        const spd = 3 + wave * 0.2;
        enemyBullets.push({ x: e.x, y: e.y, vx: (edx / edist) * spd, vy: (edy / edist) * spd, w: 6, h: 10 });
        e.shootTimer = 80 + Math.random() * 80;
      }
    }

    if (!e.isBoss && e.y > GAME_H + 40) enemies.splice(i, 1);
  }

  // Bullet-enemy collisions
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    let bulletConsumed = false;
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (Math.abs(b.x - e.x) < e.w / 2 + b.w / 2 && Math.abs(b.y - e.y) < e.h / 2 + b.h / 2) {
        e.hp -= (b.damage || 1);
        SFX.hit();
        if (e.hp <= 0) {
          spawnExplosion(e.x, e.y);
          if (e.isBoss) {
            // Boss death: big explosion, score, guaranteed pickup
            for (let k = 0; k < 5; k++) {
              spawnExplosion(e.x + (Math.random() - 0.5) * 40, e.y + (Math.random() - 0.5) * 40);
            }
            score += 500 * e.milestone;
            bossActive = false;
            if (lives < MAX_LIVES) { lives++; SFX.powerup(); }
            onBossDefeated(e.milestone);
            // Boss drops current weapon type (guaranteed level-up)
            spawnPickupGuaranteed(e.x, e.y, player.weaponId);
            SFX.explode();
          } else {
            score += 10;
            if (Math.random() < PICKUP_DROP_CHANCE) spawnPickup(e.x, e.y);
            trySpawnGaugeDrops(e.x, e.y);
          }
          enemies.splice(ei, 1);
        }
        if (!b.pierce) { bulletConsumed = true; break; }
      }
    }
    if (bulletConsumed) bullets.splice(bi, 1);
  }

  // Enemy bullet-player collision
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    if (Math.abs(b.x - player.x) < 12 && Math.abs(b.y - player.y) < 18) {
      enemyBullets.splice(i, 1);
      loseLife();
    }
  }

  // Explosions
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].frame++;
    if (explosions[i].frame > 12) explosions.splice(i, 1);
  }

  // Pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.y += p.vy;
    p.t++;
    // Player collision
    if (Math.abs(p.x - player.x) < 18 && Math.abs(p.y - player.y) < 22) {
      onPickupAmmoItem(p.weaponId);
      pickups.splice(i, 1);
      continue;
    }
    if (p.y > GAME_H + 20) pickups.splice(i, 1);
  }

  // Gauge items (leaves + drumsticks)
  for (let i = gaugeItems.length - 1; i >= 0; i--) {
    const g = gaugeItems[i];
    g.y += g.vy;
    g.t++;
    // Player collection
    if (Math.abs(g.x - player.x) < 20 && Math.abs(g.y - player.y) < 24) {
      addGauge(g.type === 'drumstick' ? DRUMSTICK_VALUE : LEAF_VALUE);
      gaugeItems.splice(i, 1);
      continue;
    }
    if (g.y > GAME_H + 20) gaugeItems.splice(i, 1);
  }

  // Gauge cooldown + flash
  if (gauge.cooldown > 0) gauge.cooldown--;
  if (gauge.flashTimer > 0) gauge.flashTimer--;

  // Next wave
  if (enemies.length === 0 && !bossActive) {
    score += wave * 50;
    spawnWave();
  }

  if (shakeTimer > 0) shakeTimer--;
  updateStars();

  // (Planet entities updated in main loop — runs on all screens)
}

function spawnExplosion(x, y) {
  explosions.push({ x, y, frame: 0 });
}

function loseLife() {
  lives--;
  shakeTimer = 20;
  SFX.lose_life();
  spawnExplosion(player.x, player.y);
  if (lives <= 0) endGame();
}

function endGame() {
  state = STATE.GAMEOVER;
  if (score > highScore) { highScore = score; localStorage.setItem('sc_hi', highScore); }
  SFX.gameover();
}

// ── Draw ─────────────────────────────────────────────────────
function draw() {
  ctx.save();
  if (shakeTimer > 0) {
    ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
  }

  // Black base + galaxy overlay at 50% opacity
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, GAME_W, GAME_H);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = getGalaxyBg();
  ctx.fillRect(0, 0, GAME_W, GAME_H);
  ctx.globalAlpha = 1;
  drawStars();

  // Planet background layer (rendered after background)
  for (const s of planetEntities) {
    if (s.layer === 0) drawPlanetEntity(s);
  }

  if (state === STATE.START) { drawStart(); }
  else if (state === STATE.GAMEOVER) { drawGameOver(); }
  else { drawGame(); if (state === STATE.PAUSED) drawPause(); }

  ctx.restore();
}

function drawGame() {
  drawPlayer(player.x, player.y);
  for (const wm of wingmen) drawWingman(wm.x, wm.y);

  // Player bullets (color per weapon type, shape varies)
  for (const b of bullets) {
    ctx.fillStyle = b.color || '#00ffff';
    ctx.shadowColor = b.color || '#00ffff';
    ctx.shadowBlur = 6;
    if (b.isSplash || (b.w > 7 && b.h > 7 && b.w === b.h)) {
      // Round projectiles (plasma, fireball)
      ctx.beginPath(); ctx.arc(b.x, b.y, b.w / 2, 0, Math.PI * 2); ctx.fill();
    } else if (b.isZigzag) {
      // Zigzag bolts
      ctx.strokeStyle = b.color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x - 3, b.y + 6); ctx.lineTo(b.x + 3, b.y); ctx.lineTo(b.x - 3, b.y - 6);
      ctx.stroke();
    } else {
      ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    }
  }
  ctx.shadowBlur = 0;

  // Enemy bullets
  ctx.fillStyle = '#ffeeaa';
  for (const b of enemyBullets) {
    ctx.beginPath(); ctx.ellipse(b.x, b.y, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Planet boss layer (behind boss sprite, above bullets)
  for (const s of planetEntities) {
    if (s.layer === 1) drawPlanetEntity(s);
  }

  // Enemies
  for (const e of enemies) {
    if (e.isBoss) {
      drawBossChicken(e.x, e.y, e.t, e.hp / e.maxHp);
    } else {
      drawChicken(e.x, e.y, e.t);
    }
  }

  // Pickups
  for (const p of pickups) drawPickup(p);

  // Gauge items (leaves + drumsticks)
  for (const g of gaugeItems) drawGaugeItem(g);

  // Explosions
  for (const ex of explosions) drawExplosion(ex.x, ex.y, ex.frame);

  // Explode All flash overlay
  if (gauge.flashTimer > 0) {
    ctx.globalAlpha = gauge.flashTimer / 30 * 0.4;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.globalAlpha = 1;
  }

  // HUD
  ctx.font = 'bold 16px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${score}`, 10, 24);
  ctx.textAlign = 'right';
  ctx.fillText(`HI: ${highScore}`, GAME_W - 10, 24);
  ctx.textAlign = 'center';
  ctx.fillText(`WAVE ${wave}`, GAME_W / 2, 24);

  // Weapon indicator (bottom-right): name + tier pips
  { const cw = WEAPON_DB[player.weaponId];
    const wColor = cw ? cw.color : '#fff';
    const wName = cw ? cw.name : '???';
    const maxT = cw ? cw.maxTier : 1;
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = wColor;
    ctx.fillText(`${wName.toUpperCase()} T${player.weaponTier + 1}`, GAME_W - 14, GAME_H - 30);
    // Tier pips
    const pipW = 5, pipH = 3, pipGap = 2;
    const totalPipW = maxT * (pipW + pipGap);
    for (let i = 0; i < maxT; i++) {
      const px = GAME_W - 14 - totalPipW + i * (pipW + pipGap);
      ctx.fillStyle = i <= player.weaponTier ? wColor : '#333';
      ctx.fillRect(px, GAME_H - 25, pipW, pipH);
    }
  }

  // Gauge bar (left side, vertical or horizontal)
  { const gx = 10, gy = 38, gw = 80, gh = 8;
    const ratio = Math.min(gauge.value / GAUGE_MAX, 1);
    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(gx, gy, gw, gh);
    // Fill: green→yellow→gold as it fills
    const gc = ratio < 0.5 ? '#44cc44' : ratio < 1 ? '#cccc00' : '#ffaa00';
    ctx.fillStyle = gc;
    ctx.fillRect(gx, gy, gw * ratio, gh);
    // Border
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(gx, gy, gw, gh);
    // Leaf + drumstick icons as labels
    ctx.font = '9px monospace';
    ctx.fillStyle = '#44cc44';
    ctx.textAlign = 'left';
    ctx.fillText('\u{1F343}', gx + 1, gy + 7); // leaf emoji fallback
    // "EXPLODE ALL" prompt when full
    if (gauge.value >= GAUGE_MAX && gauge.cooldown <= 0) {
      const blink = Math.sin(tick * 0.12) > 0;
      if (blink) {
        ctx.fillStyle = '#ffaa00';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        const isMob = 'ontouchstart' in window;
        ctx.fillText(isMob ? 'BOMB READY!' : '[E] EXPLODE ALL!', gx, gy + 20);
      }
      // Mobile bomb button (bottom-right)
      if ('ontouchstart' in window) {
        const bx = GAME_W - 70, by = GAME_H - 70, br = 28;
        ctx.globalAlpha = blink ? 0.9 : 0.6;
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BOMB', bx, by + 6);
        ctx.globalAlpha = 1;
      }
    }
    // Cooldown indicator
    if (gauge.cooldown > 0) {
      ctx.fillStyle = '#666';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      const cdSec = Math.ceil(gauge.cooldown / 60);
      ctx.fillText(`CD: ${cdSec}s`, gx, gy + 20);
    }
  }

  // Lives
  for (let i = 0; i < lives; i++) {
    ctx.fillStyle = '#00eeff';
    ctx.beginPath();
    ctx.moveTo(10 + i * 22, GAME_H - 12);
    ctx.lineTo(10 + i * 22 - 8, GAME_H - 4);
    ctx.lineTo(10 + i * 22, GAME_H - 8);
    ctx.lineTo(10 + i * 22 + 8, GAME_H - 4);
    ctx.closePath();
    ctx.fill();
  }

  // Heat bar (above lives)
  const heatBarW = 80, heatBarH = 6;
  const hbx = 10, hby = GAME_H - 24;
  ctx.fillStyle = '#333';
  ctx.fillRect(hbx, hby, heatBarW, heatBarH);
  if (player.overheated) {
    // Show countdown bar draining over 5s
    const lockPct = player.overheatTimer / OVERHEAT_LOCKOUT;
    ctx.fillStyle = '#ff2222';
    ctx.fillRect(hbx, hby, heatBarW * lockPct, heatBarH);
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    const secs = (player.overheatTimer / 60).toFixed(1);
    ctx.fillText(`OVERHEAT ${secs}s`, hbx + heatBarW + 5, hby + 6);
  } else {
    const heatPct = player.heat / HEAT_MAX;
    ctx.fillStyle = heatPct > 0.7 ? '#ff8800' : '#44cc44';
    ctx.fillRect(hbx, hby, heatBarW * heatPct, heatBarH);
  }

  // Controls hint
  ctx.font = '12px monospace';
  ctx.fillStyle = '#666';
  ctx.textAlign = 'right';
  const isMobile = 'ontouchstart' in window;
  ctx.fillText(isMobile ? 'TOUCH | [E] BOOM' : 'CLICK+DRAG | [P] PAUSE | [E] BOOM', GAME_W - 10, GAME_H - 8);
}

function drawStart() {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffcc00';
  ctx.font = 'bold 42px monospace';
  ctx.shadowColor = '#ff9900'; ctx.shadowBlur = 20;
  ctx.fillText('SPACE', GAME_W / 2, 160);
  ctx.fillText('CLUCKERS', GAME_W / 2, 210);
  ctx.shadowBlur = 0;

  drawChicken(GAME_W / 2, 310, tick);

  ctx.fillStyle = '#ffffff';
  ctx.font = '16px monospace';
  const isMobile = 'ontouchstart' in window;
  if (isMobile) {
    ctx.fillText('TOUCH to move ship', GAME_W / 2, 400);
    ctx.fillText('Auto-fire while touching', GAME_W / 2, 425);
  } else {
    ctx.fillText('CLICK+DRAG or WASD to move', GAME_W / 2, 400);
    ctx.fillText('Auto-fire while moving', GAME_W / 2, 425);
  }

  ctx.fillStyle = '#00ffff';
  ctx.font = 'bold 18px monospace';
  const blink = Math.sin(tick * 0.06) > 0;
  if (blink) ctx.fillText(isMobile ? '>> TAP TO START <<' : '>> PRESS SPACE TO START <<', GAME_W / 2, 480);

  ctx.fillStyle = '#888';
  ctx.font = '13px monospace';
  ctx.fillText(`HIGH SCORE: ${highScore}`, GAME_W / 2, 520);

  ctx.fillStyle = '#555';
  ctx.font = '11px monospace';
  ctx.fillText(GAME_VERSION, GAME_W / 2, GAME_H - 15);
}

function drawGameOver() {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff3333';
  ctx.font = 'bold 40px monospace';
  ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 20;
  ctx.fillText('GAME OVER', GAME_W / 2, 220);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#ffffff';
  ctx.font = '22px monospace';
  ctx.fillText(`SCORE: ${score}`, GAME_W / 2, 290);
  ctx.fillStyle = '#ffcc00';
  ctx.fillText(`HIGH SCORE: ${highScore}`, GAME_W / 2, 325);

  ctx.fillStyle = '#aaaaaa';
  ctx.font = '14px monospace';
  ctx.fillText(`WAVE REACHED: ${wave}`, GAME_W / 2, 370);

  ctx.fillStyle = '#00ffff';
  ctx.font = 'bold 16px monospace';
  const blink = Math.sin(tick * 0.06) > 0;
  const isMobile = 'ontouchstart' in window;
  if (blink) ctx.fillText(isMobile ? 'TAP TO RESTART' : 'PRESS SPACE TO RESTART', GAME_W / 2, 430);
}

function drawPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, GAME_W, GAME_H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px monospace';
  ctx.fillText('PAUSED', GAME_W / 2, GAME_H / 2);
  ctx.font = '16px monospace';
  ctx.fillText('[P] to resume', GAME_W / 2, GAME_H / 2 + 40);
}

// ── Loop ─────────────────────────────────────────────────────
function loop() {
  tick++;
  update();
  // Planet entities always update (decorative, all screens)
  for (let i = planetEntities.length - 1; i >= 0; i--) {
    updatePlanetEntity(planetEntities[i]);
  }
  cleanupPlanetEntities();
  if (PLANET_CFG.ENABLED && PLANET_CFG.catalog.length > 0 && Math.random() < 0.0015) {
    // Only spawn if no planet is still near the top (minimum vertical spacing)
    const tooClose = planetEntities.some(p => p.alive && p.mode === 'background' && p.y < GAME_H * 0.3);
    if (!tooClose) spawnPlanetBackground({});
  }
  draw();
  requestAnimationFrame(loop);
}

loop();
