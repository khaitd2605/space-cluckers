#!/usr/bin/env node
// ============================================================
// Procedural Planet Generator — Space Cluckers
// Generates 8+ distinct planets with transparent backgrounds
// Output: static icon + animated spritesheet (rotation frames)
// Usage: node tools/generate-planets.js [--seed=42]
// ============================================================

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

// ── Seeded PRNG (Mulberry32) ──────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Color helpers ─────────────────────────────────────────────
function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbStr(r, g, b, a = 1) {
  return `rgba(${r},${g},${b},${a})`;
}

// ── Planet Definitions ────────────────────────────────────────
const PLANET_DEFS = [
  { id: 'terra',    name: 'Terra',    hue: 200, sat: 60, lit: 45, hasRings: false, hasClouds: true,  hasCraters: false, hasStripes: false, glowColor: [100,180,255] },
  { id: 'mars',     name: 'Mars',     hue: 15,  sat: 70, lit: 40, hasRings: false, hasClouds: false, hasCraters: true,  hasStripes: false, glowColor: [255,120,80]  },
  { id: 'saturn',   name: 'Saturn',   hue: 45,  sat: 50, lit: 55, hasRings: true,  hasClouds: false, hasCraters: false, hasStripes: true,  glowColor: [255,220,130] },
  { id: 'neptune',  name: 'Neptune',  hue: 220, sat: 65, lit: 40, hasRings: false, hasClouds: true,  hasCraters: false, hasStripes: true,  glowColor: [80,130,255]  },
  { id: 'jupiter',  name: 'Jupiter',  hue: 30,  sat: 55, lit: 50, hasRings: false, hasClouds: true,  hasCraters: false, hasStripes: true,  glowColor: [255,180,100] },
  { id: 'venus',    name: 'Venus',    hue: 50,  sat: 40, lit: 60, hasRings: false, hasClouds: true,  hasCraters: false, hasStripes: false, glowColor: [255,240,180] },
  { id: 'ice',      name: 'Ice',      hue: 190, sat: 30, lit: 70, hasRings: true,  hasClouds: false, hasCraters: false, hasStripes: false, glowColor: [200,230,255] },
  { id: 'lava',     name: 'Lava',     hue: 5,   sat: 80, lit: 35, hasRings: false, hasClouds: false, hasCraters: true,  hasStripes: false, glowColor: [255,80,40]   },
  { id: 'toxic',    name: 'Toxic',    hue: 100, sat: 70, lit: 40, hasRings: false, hasClouds: true,  hasCraters: false, hasStripes: true,  glowColor: [120,255,80]  },
  { id: 'purple',   name: 'Purple',   hue: 280, sat: 60, lit: 45, hasRings: true,  hasClouds: false, hasCraters: false, hasStripes: true,  glowColor: [200,100,255] },
];

const FRAME_COUNT = 20;
const FRAME_W = 128;
const FRAME_H = 128;
const PLANET_RADIUS = 48;
const SHEET_COLS = 5;

// ── Draw a single planet frame ────────────────────────────────
function drawPlanetFrame(ctx, def, rng, rotAngle) {
  const cx = FRAME_W / 2;
  const cy = FRAME_H / 2;
  const r = PLANET_RADIUS;

  ctx.clearRect(0, 0, FRAME_W, FRAME_H);

  // Atmosphere glow
  const [gr, gg, gb] = def.glowColor;
  const glow = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.35);
  glow.addColorStop(0, rgbStr(gr, gg, gb, 0.15));
  glow.addColorStop(1, rgbStr(gr, gg, gb, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);

  // Planet body
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Base gradient (sphere shading)
  const baseGrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  const [br, bg, bb] = hslToRgb(def.hue, def.sat, def.lit + 15);
  const [dr, dg, db] = hslToRgb(def.hue, def.sat, def.lit - 15);
  baseGrad.addColorStop(0, rgbStr(br, bg, bb));
  baseGrad.addColorStop(1, rgbStr(dr, dg, db));
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);

  // Stripes (horizontal bands that shift with rotation)
  if (def.hasStripes) {
    const stripeCount = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < stripeCount; i++) {
      const yOff = (i / stripeCount) * r * 2 - r;
      const bandY = cy + yOff + Math.sin(rotAngle + i) * 3;
      const bandH = r * 0.08 + rng() * r * 0.06;
      const [sr, sg, sb] = hslToRgb(def.hue + (rng() - 0.5) * 30, def.sat + 10, def.lit + (rng() - 0.5) * 20);
      ctx.fillStyle = rgbStr(sr, sg, sb, 0.3 + rng() * 0.2);
      ctx.fillRect(cx - r, bandY - bandH / 2, r * 2, bandH);
    }
  }

  // Surface detail (noise-like patches that rotate)
  const patchCount = 8 + Math.floor(rng() * 6);
  for (let i = 0; i < patchCount; i++) {
    const angle = (i / patchCount) * Math.PI * 2 + rotAngle;
    const dist = rng() * r * 0.7;
    const px = cx + Math.cos(angle) * dist;
    const py = cy + Math.sin(angle) * dist * 0.6;
    const patchR = r * 0.08 + rng() * r * 0.12;
    const [pr, pg, pb] = hslToRgb(def.hue + (rng() - 0.5) * 40, def.sat - 10, def.lit + (rng() - 0.5) * 25);
    ctx.fillStyle = rgbStr(pr, pg, pb, 0.15 + rng() * 0.15);
    ctx.beginPath();
    ctx.arc(px, py, patchR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Craters
  if (def.hasCraters) {
    const craterCount = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < craterCount; i++) {
      const angle = (i / craterCount) * Math.PI * 2 + rotAngle;
      const dist = rng() * r * 0.65;
      const crx = cx + Math.cos(angle) * dist;
      const cry = cy + Math.sin(angle) * dist * 0.7;
      const crr = r * 0.06 + rng() * r * 0.08;
      // Crater shadow
      ctx.fillStyle = rgbStr(0, 0, 0, 0.2);
      ctx.beginPath();
      ctx.arc(crx + 1, cry + 1, crr, 0, Math.PI * 2);
      ctx.fill();
      // Crater
      const [cr2, cg2, cb2] = hslToRgb(def.hue, def.sat - 20, def.lit - 10);
      ctx.fillStyle = rgbStr(cr2, cg2, cb2, 0.5);
      ctx.beginPath();
      ctx.arc(crx, cry, crr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Clouds
  if (def.hasClouds) {
    const cloudCount = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < cloudCount; i++) {
      const angle = (i / cloudCount) * Math.PI * 2 + rotAngle * 1.3;
      const dist = rng() * r * 0.6;
      const clx = cx + Math.cos(angle) * dist;
      const cly = cy + Math.sin(angle) * dist * 0.5;
      const clr = r * 0.12 + rng() * r * 0.15;
      ctx.fillStyle = rgbStr(255, 255, 255, 0.12 + rng() * 0.1);
      ctx.beginPath();
      ctx.arc(clx, cly, clr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Shadow (terminator line - dark side)
  const shadowGrad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  shadowGrad.addColorStop(0, 'rgba(0,0,0,0)');
  shadowGrad.addColorStop(0.55, 'rgba(0,0,0,0)');
  shadowGrad.addColorStop(0.85, 'rgba(0,0,0,0.4)');
  shadowGrad.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);

  // Specular highlight
  const specGrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx - r * 0.2, cy - r * 0.2, r * 0.4);
  specGrad.addColorStop(0, 'rgba(255,255,255,0.25)');
  specGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = specGrad;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);

  ctx.restore();

  // Rings (drawn outside clip)
  if (def.hasRings) {
    ctx.save();
    ctx.translate(cx, cy);

    // Back ring half (behind planet)
    drawRingHalf(ctx, def, rng, r, 'back');

    // Re-draw planet body on top of back ring (clip trick)
    // Just draw front ring half
    drawRingHalf(ctx, def, rng, r, 'front');

    ctx.restore();
  }
}

function drawRingHalf(ctx, def, rng, r, half) {
  const ringInner = r * 1.2;
  const ringOuter = r * 1.6;
  const ringTilt = 0.3; // ellipse Y squash

  const [rr, rg, rb] = hslToRgb(def.hue + 20, def.sat - 10, def.lit + 20);

  ctx.save();
  ctx.scale(1, ringTilt);

  for (let band = 0; band < 3; band++) {
    const inner = ringInner + (ringOuter - ringInner) * (band / 3);
    const outer = ringInner + (ringOuter - ringInner) * ((band + 1) / 3);
    const alpha = 0.15 + band * 0.08;

    ctx.beginPath();
    if (half === 'front') {
      ctx.arc(0, 0, outer, 0, Math.PI, false);
      ctx.arc(0, 0, inner, Math.PI, 0, true);
    } else {
      ctx.arc(0, 0, outer, Math.PI, Math.PI * 2, false);
      ctx.arc(0, 0, inner, Math.PI * 2, Math.PI, true);
    }
    ctx.closePath();
    ctx.fillStyle = rgbStr(rr, rg, rb, alpha);
    ctx.fill();
  }

  ctx.restore();
}

// ── Generate all frames for one planet ────────────────────────
function generatePlanetFrames(def, seed) {
  const frames = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const canvas = createCanvas(FRAME_W, FRAME_H);
    const ctx = canvas.getContext('2d');
    const rng = mulberry32(seed + def.id.charCodeAt(0) * 1000);
    // Advance rng to consistent state
    for (let w = 0; w < 20; w++) rng();
    const rotAngle = (i / FRAME_COUNT) * Math.PI * 2;
    drawPlanetFrame(ctx, def, rng, rotAngle);
    frames.push(canvas);
  }
  return frames;
}

// ── Build spritesheet from frames ─────────────────────────────
function buildSpritesheet(frames) {
  const rows = Math.ceil(FRAME_COUNT / SHEET_COLS);
  const sheetW = SHEET_COLS * FRAME_W;
  const sheetH = rows * FRAME_H;
  const sheet = createCanvas(sheetW, sheetH);
  const sctx = sheet.getContext('2d');

  for (let i = 0; i < frames.length; i++) {
    const col = i % SHEET_COLS;
    const row = Math.floor(i / SHEET_COLS);
    sctx.drawImage(frames[i], col * FRAME_W, row * FRAME_H);
  }
  return sheet;
}

// ── Build atlas JSON ──────────────────────────────────────────
function buildAtlas(def) {
  const rows = Math.ceil(FRAME_COUNT / SHEET_COLS);
  const atlas = {
    id: def.id,
    name: def.name,
    frameCount: FRAME_COUNT,
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    sheetCols: SHEET_COLS,
    sheetRows: rows,
    sheetWidth: SHEET_COLS * FRAME_W,
    sheetHeight: rows * FRAME_H,
  };
  return atlas;
}

// ── Main generator ────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let seed = 42;
  for (const a of args) {
    const m = a.match(/--seed=(\d+)/);
    if (m) seed = parseInt(m[1], 10);
  }

  console.log(`Generating ${PLANET_DEFS.length} planets (seed=${seed})...`);

  const outBase = path.join(__dirname, '..', 'assets', 'planets');
  const manifest = [];

  for (const def of PLANET_DEFS) {
    const dir = path.join(outBase, def.id);
    fs.mkdirSync(dir, { recursive: true });

    console.log(`  ${def.name}...`);

    // Generate frames
    const frames = generatePlanetFrames(def, seed);

    // Save icon (frame 0)
    const iconBuf = frames[0].toBuffer('image/png');
    fs.writeFileSync(path.join(dir, 'icon.png'), iconBuf);
    if (sharp) {
      await sharp(iconBuf).webp({ quality: 85 }).toFile(path.join(dir, 'icon.webp'));
    }

    // Build and save spritesheet
    const sheet = buildSpritesheet(frames);
    const sheetBuf = sheet.toBuffer('image/png');
    fs.writeFileSync(path.join(dir, 'sheet.png'), sheetBuf);
    if (sharp) {
      await sharp(sheetBuf).webp({ quality: 85 }).toFile(path.join(dir, 'sheet.webp'));
    }

    // Save atlas
    const atlas = buildAtlas(def);
    fs.writeFileSync(path.join(dir, 'atlas.json'), JSON.stringify(atlas, null, 2));

    manifest.push(atlas);
  }

  // Global manifest
  fs.writeFileSync(
    path.join(outBase, 'planets-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`Done! ${PLANET_DEFS.length} planets generated in assets/planets/`);
  console.log(`Manifest: assets/planets/planets-manifest.json`);
  if (!sharp) {
    console.log('WARNING: sharp not installed, WebP files not generated (PNG only).');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
