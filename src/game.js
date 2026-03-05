// ============================================================
// SPACE CLUCKERS - MVP Space Shooter (Mobile + Desktop)
// ============================================================

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
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
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

const SFX = {
  shoot:     () => playTone(880, 'square', 0.08, 0.2),
  hit:       () => playTone(220, 'sawtooth', 0.15, 0.3),
  explode:   () => playTone(80, 'sawtooth', 0.4, 0.4),
  powerup:   () => playTone(440, 'sine', 0.3, 0.35),
  lose_life: () => playTone(150, 'square', 0.5, 0.4),
  gameover:  () => { playTone(200, 'sawtooth', 0.6, 0.5); setTimeout(() => playTone(150, 'sawtooth', 0.6, 0.5), 400); }
};

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

function drawChicken(x, y, t) {
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

// ── State ────────────────────────────────────────────────────
const STATE = { START: 0, PLAY: 1, GAMEOVER: 2, PAUSED: 3 };
let state = STATE.START;

let player, bullets, enemies, enemyBullets, explosions, particles;
let score, lives, wave, waveTimer, spawnTimer, tick;
let shakeTimer = 0;
let highScore = parseInt(localStorage.getItem('sc_hi') || '0');

function initGame() {
  player = { x: GAME_W / 2, y: GAME_H - 60, w: 28, h: 36, speed: 4, shootCooldown: 0 };
  bullets = [];
  enemies = [];
  enemyBullets = [];
  explosions = [];
  particles = [];
  score = 0; lives = 3; wave = 0; tick = 0;
  waveTimer = 0; spawnTimer = 0;
  spawnWave();
}

// ── Wave / Enemy patterns ───────────────────────────────────
function spawnWave() {
  wave++;
  enemies = [];
  const rows = 2 + Math.floor(wave / 2);
  const cols = 6;

  if (wave % 3 === 0) {
    for (let i = 0; i < 10; i++) {
      enemies.push({
        x: GAME_W / 2 + (i % 2 === 0 ? -1 : 1) * (Math.floor(i / 2) + 1) * 40,
        y: -30 - i * 20, w: 28, h: 28, hp: 1,
        pattern: 'rush', t: 0, angle: Math.PI / 2,
        shootTimer: 60 + Math.random() * 60
      });
    }
  } else if (wave % 3 === 1) {
    for (let r = 0; r < Math.min(rows, 4); r++) {
      for (let c = 0; c < cols; c++) {
        enemies.push({
          x: 60 + c * 65, y: 60 + r * 55, w: 28, h: 28, hp: 1,
          pattern: 'grid', t: 0, dir: 1,
          shootTimer: 80 + Math.random() * 80
        });
      }
    }
  } else {
    for (let i = 0; i < 8 + wave; i++) {
      enemies.push({
        x: Math.random() * (GAME_W - 60) + 30,
        y: -40 - i * 35, w: 28, h: 28, hp: 1,
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

function tryShoot() {
  if (player.shootCooldown > 0) return;
  bullets.push({ x: player.x, y: player.y - 18, w: 4, h: 12, vy: -10 });
  player.shootCooldown = 12;
  SFX.shoot();
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

  // Auto-shoot while Space held
  if (keys['Space']) tryShoot();
  if (player.shootCooldown > 0) player.shootCooldown--;

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].y += bullets[i].vy;
    if (bullets[i].y < -20) bullets.splice(i, 1);
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
    if (e.pattern === 'grid') {
      e.x += e.dir * speed;
      if (e.x > GAME_W - 40 || e.x < 40) e.dir *= -1;
      e.y += 0.08 * wave;
    } else if (e.pattern === 'swoop') {
      e.y += speed * 0.8;
      e.x += Math.sin(e.t * 0.04 + i) * 2.5;
    } else if (e.pattern === 'rush') {
      e.y += speed * 1.5;
    }

    e.shootTimer--;
    if (e.shootTimer <= 0 && e.y > 0) {
      const edx = player.x - e.x;
      const edy = player.y - e.y;
      const edist = Math.sqrt(edx * edx + edy * edy);
      const spd = 3 + wave * 0.2;
      enemyBullets.push({ x: e.x, y: e.y, vx: (edx / edist) * spd, vy: (edy / edist) * spd, w: 6, h: 10 });
      e.shootTimer = 80 + Math.random() * 80;
    }

    if (e.y > GAME_H + 40) enemies.splice(i, 1);
  }

  // Bullet-enemy collisions
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (Math.abs(b.x - e.x) < e.w / 2 + 2 && Math.abs(b.y - e.y) < e.h / 2 + 2) {
        spawnExplosion(e.x, e.y);
        SFX.hit();
        score += 10;
        enemies.splice(ei, 1);
        bullets.splice(bi, 1);
        break;
      }
    }
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

  // Next wave
  if (enemies.length === 0) {
    score += wave * 50;
    spawnWave();
  }

  if (shakeTimer > 0) shakeTimer--;
  updateStars();
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

  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, GAME_W, GAME_H);
  drawStars();

  if (state === STATE.START) { drawStart(); }
  else if (state === STATE.GAMEOVER) { drawGameOver(); }
  else { drawGame(); if (state === STATE.PAUSED) drawPause(); }

  ctx.restore();
}

function drawGame() {
  drawPlayer(player.x, player.y);

  // Player bullets
  ctx.fillStyle = '#00ffff';
  for (const b of bullets) {
    ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 8;
    ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }
  ctx.shadowBlur = 0;

  // Enemy bullets
  ctx.fillStyle = '#ffeeaa';
  for (const b of enemyBullets) {
    ctx.beginPath(); ctx.ellipse(b.x, b.y, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Enemies
  for (const e of enemies) drawChicken(e.x, e.y, e.t);

  // Explosions
  for (const ex of explosions) drawExplosion(ex.x, ex.y, ex.frame);

  // HUD
  ctx.font = 'bold 16px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${score}`, 10, 24);
  ctx.textAlign = 'right';
  ctx.fillText(`HI: ${highScore}`, GAME_W - 10, 24);
  ctx.textAlign = 'center';
  ctx.fillText(`WAVE ${wave}`, GAME_W / 2, 24);

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

  // Controls hint
  ctx.font = '12px monospace';
  ctx.fillStyle = '#666';
  ctx.textAlign = 'right';
  const isMobile = 'ontouchstart' in window;
  ctx.fillText(isMobile ? 'TOUCH TO MOVE | AUTO-FIRE' : 'CLICK+DRAG TO MOVE | [P] PAUSE', GAME_W - 10, GAME_H - 8);
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
  draw();
  requestAnimationFrame(loop);
}

loop();
