import { alpha, type Ctx, rng } from './palette';
import type { EffectType } from './types';

/**
 * EFFECT ENGINE — deterministic, time-driven particle systems.
 * Particles are derived analytically from (index, time) instead of being simulated,
 * so frame N always looks the same whether it is drawn in the live preview or the
 * offline frame-by-frame encoder. Counts scale with the quality setting.
 */

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
const DENSITY: Record<Quality, number> = { low: 0.35, medium: 0.7, high: 1, ultra: 1.45 };

export interface EffectCtx {
  w: number;
  h: number;
  t: number; // absolute scene time (s)
  seed: number;
  quality: Quality;
  intensity: number;
}

export function drawEffect(ctx: Ctx, fx: EffectType, e: EffectCtx) {
  switch (fx) {
    case 'rain': return rain(ctx, e);
    case 'snow': return snow(ctx, e);
    case 'fog': return fog(ctx, e);
    case 'smoke': return smoke(ctx, e);
    case 'fire': return fire(ctx, e);
    case 'sparks': return sparks(ctx, e);
    case 'dust': return dust(ctx, e);
    case 'particles': return particles(ctx, e);
    case 'lightning': return lightning(ctx, e);
    case 'glow': return glowFx(ctx, e);
    case 'shadow': return shadowFx(ctx, e);
    case 'screen_flicker': return flicker(ctx, e);
    case 'wind': return wind(ctx, e);
    case 'window_reflection': return windowReflection(ctx, e);
    case 'floating_dust': return floatingDust(ctx, e);
    case 'moving_shadows': return movingShadows(ctx, e);
  }
}

/** Slow motes drifting in a light shaft — makes empty rooms feel alive. */
function floatingDust(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(42 * DENSITY[e.quality]);
  const r = rng(e.seed + 21);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const bx = r() * e.w;
    const by = r() * e.h;
    const sp = 0.15 + r() * 0.4;
    const x = bx + Math.sin(e.t * sp + i) * e.w * 0.03;
    const y = (by - e.t * sp * 14 + e.h) % e.h;
    const rad = e.w * (0.0012 + r() * 0.0026);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 3);
    g.addColorStop(0, `rgba(255,243,214,${0.25 + r() * 0.45})`);
    g.addColorStop(1, 'rgba(255,243,214,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Large soft shadows sliding across the frame — unseen presence / passing traffic. */
function movingShadows(ctx: Ctx, e: EffectCtx) {
  const n = Math.max(2, Math.round(3 * DENSITY[e.quality]));
  const r = rng(e.seed + 33);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < n; i++) {
    const speed = 0.06 + r() * 0.1;
    const phase = (e.t * speed + r()) % 1.4 - 0.2;
    const x = phase * e.w * 1.3;
    const wdt = e.w * (0.18 + r() * 0.22);
    const g = ctx.createLinearGradient(x - wdt, 0, x + wdt, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, `rgba(0,0,0,${0.3 + r() * 0.2})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - wdt, 0, wdt * 2, e.h);
  }
  ctx.restore();
}

function rain(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(240 * DENSITY[e.quality]);
  const r = rng(e.seed + 1);
  ctx.save();
  ctx.strokeStyle = 'rgba(190,220,255,0.55)';
  ctx.lineWidth = Math.max(1, e.w * 0.0016);
  for (let i = 0; i < n; i++) {
    const x0 = r() * e.w * 1.3 - e.w * 0.15;
    const speed = 700 + r() * 700;
    const len = e.h * (0.035 + r() * 0.05);
    const y = ((r() * e.h + e.t * speed) % (e.h * 1.3)) - e.h * 0.15;
    ctx.globalAlpha = 0.25 + r() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 - e.w * 0.012, y + len);
    ctx.stroke();
  }
  // splashes
  ctx.globalAlpha = 0.3;
  const r2 = rng(e.seed + 55);
  for (let i = 0; i < n / 8; i++) {
    const x = r2() * e.w;
    const phase = (e.t * 2 + r2()) % 1;
    const yy = e.h * (0.82 + r2() * 0.16);
    ctx.beginPath();
    ctx.ellipse(x, yy, e.w * 0.012 * phase, e.w * 0.003 * phase, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,230,255,0.5)';
    ctx.stroke();
  }
  ctx.restore();
}

function snow(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(170 * DENSITY[e.quality]);
  const r = rng(e.seed + 2);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < n; i++) {
    const base = r() * e.w;
    const sp = 40 + r() * 90;
    const y = ((r() * e.h + e.t * sp) % (e.h * 1.2)) - e.h * 0.1;
    const x = base + Math.sin(e.t * 0.7 + i) * e.w * 0.03;
    ctx.globalAlpha = 0.35 + r() * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, e.w * (0.0018 + r() * 0.004), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function fog(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(9 * DENSITY[e.quality]) + 3;
  const r = rng(e.seed + 3);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const y = e.h * (0.45 + r() * 0.5);
    const x = ((r() * 1.6 - 0.3) * e.w + e.t * (6 + r() * 18)) % (e.w * 1.8) - e.w * 0.4;
    const rad = e.w * (0.22 + r() * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(205,215,230,${0.1 + r() * 0.13 * e.intensity})`);
    g.addColorStop(1, 'rgba(205,215,230,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function smoke(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(14 * DENSITY[e.quality]);
  const r = rng(e.seed + 4);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const life = (e.t * 0.3 + r()) % 1;
    const x = e.w * (0.3 + r() * 0.4) + Math.sin(life * 4 + i) * e.w * 0.05;
    const y = e.h * (0.95 - life * 0.8);
    const rad = e.w * (0.04 + life * 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(90,95,105,${0.3 * (1 - life)})`);
    g.addColorStop(1, 'rgba(90,95,105,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function fire(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(30 * DENSITY[e.quality]);
  const r = rng(e.seed + 5);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const baseX = e.w * 0.5;
  const baseY = e.h * 0.9;
  for (let i = 0; i < n; i++) {
    const life = (e.t * 1.4 + r()) % 1;
    const x = baseX + (r() - 0.5) * e.w * 0.16 + Math.sin(life * 6 + i) * e.w * 0.02;
    const y = baseY - life * e.h * 0.3;
    const rad = e.w * (0.035 * (1 - life) + 0.008);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(255,${180 - life * 120},60,${0.75 * (1 - life)})`);
    g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function sparks(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(45 * DENSITY[e.quality]);
  const r = rng(e.seed + 6);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const life = (e.t * 0.9 + r()) % 1;
    const ang = r() * Math.PI * 2;
    const dist = life * e.w * 0.3;
    const x = e.w * 0.5 + Math.cos(ang) * dist;
    const y = e.h * 0.6 + Math.sin(ang) * dist * 0.6 + life * life * e.h * 0.2;
    ctx.fillStyle = `rgba(255,${200 - life * 100},120,${1 - life})`;
    ctx.beginPath();
    ctx.arc(x, y, e.w * 0.0035 * (1 - life * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function dust(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(60 * DENSITY[e.quality]);
  const r = rng(e.seed + 7);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = (r() * e.w + Math.sin(e.t * 0.3 + i) * e.w * 0.04) % e.w;
    const y = (r() * e.h + e.t * (4 + r() * 10)) % e.h;
    ctx.globalAlpha = 0.1 + r() * 0.3;
    ctx.fillStyle = '#ffeccc';
    ctx.beginPath();
    ctx.arc(x, y, e.w * (0.0008 + r() * 0.0022), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function particles(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(48 * DENSITY[e.quality]);
  const r = rng(e.seed + 8);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const ph = e.t * (0.2 + r() * 0.5) + r() * 10;
    const x = e.w * (0.1 + 0.8 * ((Math.sin(ph) + 1) / 2));
    const y = e.h * (0.15 + 0.75 * ((Math.cos(ph * 0.7 + i) + 1) / 2));
    const rad = e.w * (0.004 + r() * 0.01);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(170,210,255,${0.35 + r() * 0.4})`);
    g.addColorStop(1, 'rgba(170,210,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function lightning(ctx: Ctx, e: EffectCtx) {
  const cycle = 3.4;
  const p = (e.t % cycle) / cycle;
  if (p > 0.07) return;
  const flash = Math.max(0, 1 - p / 0.07);
  const r = rng(e.seed + Math.floor(e.t / cycle) * 977);
  ctx.save();
  ctx.fillStyle = `rgba(225,235,255,${flash * 0.55})`;
  ctx.fillRect(0, 0, e.w, e.h);
  ctx.strokeStyle = `rgba(255,255,255,${flash})`;
  ctx.lineWidth = Math.max(1.6, e.w * 0.004);
  ctx.beginPath();
  let x = e.w * (0.2 + r() * 0.6);
  let y = 0;
  ctx.moveTo(x, y);
  while (y < e.h * 0.6) {
    x += (r() - 0.5) * e.w * 0.12;
    y += e.h * (0.05 + r() * 0.08);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function glowFx(ctx: Ctx, e: EffectCtx) {
  const pulse = 0.55 + Math.sin(e.t * 1.6) * 0.18;
  const g = ctx.createRadialGradient(e.w * 0.5, e.h * 0.42, 0, e.w * 0.5, e.h * 0.42, e.w * 0.65);
  g.addColorStop(0, `rgba(255,236,190,${0.2 * pulse * e.intensity})`);
  g.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, e.w, e.h);
  ctx.restore();
}

function shadowFx(ctx: Ctx, e: EffectCtx) {
  ctx.save();
  const g = ctx.createLinearGradient(0, e.h * 0.35, 0, e.h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, e.w, e.h);
  ctx.restore();
}

function flicker(ctx: Ctx, e: EffectCtx) {
  const n = Math.sin(e.t * 37) * Math.sin(e.t * 13.3) * Math.sin(e.t * 5.1);
  const a = Math.max(0, n) * 0.18;
  ctx.save();
  ctx.fillStyle = `rgba(150,200,255,${a})`;
  ctx.fillRect(0, 0, e.w, e.h);
  // scanlines
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#000';
  const step = Math.max(2, e.h / 220);
  for (let y = (e.t * 40) % (step * 2); y < e.h; y += step * 2) ctx.fillRect(0, y, e.w, step);
  ctx.restore();
}

function wind(ctx: Ctx, e: EffectCtx) {
  const n = Math.round(16 * DENSITY[e.quality]);
  const r = rng(e.seed + 11);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, e.w * 0.0015);
  for (let i = 0; i < n; i++) {
    const y = r() * e.h;
    const x = ((r() * 1.4 - 0.2) * e.w + e.t * (120 + r() * 220)) % (e.w * 1.5) - e.w * 0.25;
    const len = e.w * (0.06 + r() * 0.14);
    ctx.globalAlpha = 0.1 + r() * 0.25;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y - e.h * 0.01, x + len, y);
    ctx.stroke();
  }
  ctx.restore();
}

function windowReflection(ctx: Ctx, e: EffectCtx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const x = e.w * 0.72;
  const g = ctx.createLinearGradient(x - e.w * 0.2, 0, x + e.w * 0.25, e.h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.45, alpha('#cfe4ff', 0.12 * e.intensity));
  g.addColorStop(0.55, alpha('#cfe4ff', 0.16 * e.intensity));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - e.w * 0.1, 0);
  ctx.lineTo(x + e.w * 0.22, 0);
  ctx.lineTo(x + e.w * 0.02, e.h);
  ctx.lineTo(x - e.w * 0.3, e.h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Film grain / paper texture driven by the visual style. */
export function drawGrain(ctx: Ctx, w: number, h: number, amount: number, t: number, quality: Quality) {
  if (amount <= 0.005) return;
  const step = quality === 'low' ? 5 : quality === 'medium' ? 3 : 2;
  const r = rng(Math.floor(t * 24) * 7919);
  ctx.save();
  ctx.globalAlpha = amount * 0.6;
  for (let y = 0; y < h; y += step * 4) {
    for (let x = 0; x < w; x += step * 4) {
      const v = r();
      if (v > 0.55) {
        ctx.fillStyle = v > 0.8 ? '#ffffff' : '#000000';
        ctx.fillRect(x, y, step, step);
      }
    }
  }
  ctx.restore();
}
