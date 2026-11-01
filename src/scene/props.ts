import { alpha, type Ctx, fillShape, rng, roundRect, type StyleSpec, stroked, styled } from './palette';
import type { ObjState, ObjType } from './types';

/**
 * PROCEDURAL OBJECT LIBRARY
 * Every prop is a function of (position, size, state, time), so objects can be ON/OFF, OPEN/CLOSED,
 * VIBRATING, FLICKERING, FALLING… and they animate without any bitmap assets.
 */

export interface PropCtx {
  style: StyleSpec;
  palette: { primary: string; secondary: string; accent: string; shadow: string; sky: string };
  night: boolean;
  t: number;
  seed: number;
  /** Emissive light sources collected while drawing (used by the lighting pass). */
  emitters?: { x: number; y: number; r: number; color: string; strength: number }[];
}

const ON_STATES: ObjState[] = ['on', 'glowing', 'vibrating', 'flickering'];
export const isOn = (s: ObjState) => ON_STATES.includes(s);

/** Per-state transform applied before drawing (shake, fall, swing). */
export function stateTransform(ctx: Ctx, state: ObjState, t: number, size: number, seed: number) {
  const r = rng(seed);
  switch (state) {
    case 'vibrating': {
      const a = Math.sin(t * 46) * size * 0.012 + Math.sin(t * 71 + 1) * size * 0.008;
      ctx.translate(a, Math.cos(t * 53) * size * 0.008);
      ctx.rotate(Math.sin(t * 38) * 0.02);
      break;
    }
    case 'falling': {
      const p = (t * 0.55 + r()) % 1;
      ctx.translate(0, p * p * size * 1.6);
      ctx.rotate(p * 1.1);
      break;
    }
    case 'moving': {
      ctx.translate(Math.sin(t * 0.8) * size * 0.25, 0);
      break;
    }
    case 'broken': {
      ctx.rotate(0.18);
      ctx.translate(0, size * 0.06);
      break;
    }
    default:
      break;
  }
}

function emit(p: PropCtx, x: number, y: number, r: number, color: string, strength: number) {
  p.emitters?.push({ x, y, r, color, strength });
}

/** Local glow so emissive props read correctly even before the lighting pass. */
function glow(ctx: Ctx, x: number, y: number, r: number, color: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(color, a));
  g.addColorStop(1, alpha(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws object `type` with its base at (x, baseY).
 * `S` is the nominal width of the object in pixels.
 */
export function drawProp(ctx: Ctx, type: ObjType, x: number, baseY: number, S: number, state: ObjState, p: PropCtx) {
  const st = p.style;
  const col = (c: string) => styled(c, st);
  const lw = Math.max(0.8, S * 0.012);
  const detail = st.detail;
  const flick = state === 'flickering' ? (Math.sin(p.t * 17) * Math.sin(p.t * 7.3) > -0.25 ? 1 : 0.12) : 1;
  const on = isOn(state) && state !== 'vibrating' ? true : state === 'vibrating' ? true : state === 'off' ? false : null;

  ctx.save();
  ctx.translate(x, baseY);
  stateTransform(ctx, state, p.t, S, p.seed);
  ctx.translate(-x, -baseY);

  switch (type) {
    // ---------------------------------------------------------------- electronics
    case 'phone': {
      roundRect(ctx, x - S * 0.22, baseY - S * 0.9, S * 0.44, S * 0.88, S * 0.1);
      ctx.fillStyle = col('#1b1e24');
      ctx.fill();
      stroked(ctx, st, lw);
      const lit = on !== false && state !== 'default' ? true : state === 'default' ? false : false;
      if (lit) {
        roundRect(ctx, x - S * 0.17, baseY - S * 0.84, S * 0.34, S * 0.68, S * 0.05);
        ctx.fillStyle = alpha(p.palette.secondary, 0.95 * flick);
        ctx.fill();
        glow(ctx, x, baseY - S * 0.5, S * 1.5, p.palette.secondary, 0.3 * flick);
        emit(p, x, baseY - S * 0.5, S * 2.2, p.palette.secondary, 0.4 * flick);
        if (state === 'vibrating' && detail > 0.6) {
          ctx.strokeStyle = alpha('#ffffff', 0.5);
          ctx.lineWidth = lw;
          for (let i = 1; i <= 2; i++) {
            ctx.beginPath();
            ctx.arc(x, baseY - S * 0.45, S * (0.4 + i * 0.22 + ((p.t * 1.6) % 1) * 0.1), -0.9, -0.1);
            ctx.stroke();
          }
        }
      } else {
        roundRect(ctx, x - S * 0.17, baseY - S * 0.84, S * 0.34, S * 0.68, S * 0.05);
        ctx.fillStyle = col('#0b0d10');
        ctx.fill();
      }
      break;
    }
    case 'laptop': {
      ctx.beginPath();
      ctx.moveTo(x - S * 0.5, baseY);
      ctx.lineTo(x + S * 0.5, baseY);
      ctx.lineTo(x + S * 0.42, baseY - S * 0.07);
      ctx.lineTo(x - S * 0.42, baseY - S * 0.07);
      ctx.closePath();
      ctx.fillStyle = col('#aeb6c2');
      ctx.fill();
      stroked(ctx, st, lw);
      const openAmt = state === 'closed' ? 0.06 : 1;
      roundRect(ctx, x - S * 0.4, baseY - S * 0.62 * openAmt, S * 0.8, S * 0.56 * openAmt, S * 0.02);
      ctx.fillStyle = col('#2a2f38');
      ctx.fill();
      stroked(ctx, st, lw);
      if (openAmt > 0.5 && state !== 'off') {
        ctx.fillStyle = alpha(p.palette.secondary, 0.9 * flick);
        ctx.fillRect(x - S * 0.35, baseY - S * 0.57, S * 0.7, S * 0.46);
        glow(ctx, x, baseY - S * 0.34, S * 1.4, p.palette.secondary, 0.22 * flick);
        emit(p, x, baseY - S * 0.34, S * 2, p.palette.secondary, 0.3 * flick);
      }
      break;
    }
    case 'computer':
    case 'tv': {
      roundRect(ctx, x - S * 0.5, baseY - S * 0.62, S, S * 0.62, S * 0.03);
      ctx.fillStyle = col('#20242c');
      ctx.fill();
      stroked(ctx, st, lw);
      if (state !== 'off' && state !== 'broken') {
        const sg = ctx.createLinearGradient(x - S * 0.4, 0, x + S * 0.4, 0);
        sg.addColorStop(0, alpha(p.palette.primary, 0.9 * flick));
        sg.addColorStop(1, alpha(p.palette.secondary, 0.9 * flick));
        ctx.fillStyle = sg;
        ctx.fillRect(x - S * 0.44, baseY - S * 0.57, S * 0.88, S * 0.5);
        if (detail > 0.7) {
          ctx.fillStyle = alpha('#ffffff', 0.12);
          const scan = ((p.t * 0.4) % 1) * S * 0.5;
          ctx.fillRect(x - S * 0.44, baseY - S * 0.57 + scan, S * 0.88, S * 0.03);
        }
        glow(ctx, x, baseY - S * 0.3, S * 1.8, p.palette.secondary, 0.28 * flick);
        emit(p, x, baseY - S * 0.3, S * 2.6, p.palette.secondary, 0.45 * flick);
      } else {
        ctx.fillStyle = col('#0d1014');
        ctx.fillRect(x - S * 0.44, baseY - S * 0.57, S * 0.88, S * 0.5);
      }
      if (type === 'computer') {
        ctx.fillStyle = col('#30363f');
        ctx.fillRect(x - S * 0.08, baseY, S * 0.16, S * 0.12);
        ctx.fillRect(x - S * 0.22, baseY + S * 0.1, S * 0.44, S * 0.04);
      }
      break;
    }

    // ---------------------------------------------------------------- furniture
    case 'table': {
      roundRect(ctx, x - S * 0.5, baseY - S * 0.34, S, S * 0.07, S * 0.015);
      fillShape(ctx, st, col('#8a5a33'), x - S * 0.5, baseY - S * 0.34, S, S * 0.07);
      stroked(ctx, st, lw);
      ctx.fillStyle = col('#6e4728');
      ctx.fillRect(x - S * 0.42, baseY - S * 0.28, S * 0.06, S * 0.28);
      ctx.fillRect(x + S * 0.36, baseY - S * 0.28, S * 0.06, S * 0.28);
      break;
    }
    case 'chair': {
      ctx.fillStyle = col('#6b4a2f');
      roundRect(ctx, x - S * 0.3, baseY - S * 0.3, S * 0.6, S * 0.06, S * 0.01);
      ctx.fill();
      roundRect(ctx, x - S * 0.3, baseY - S * 0.72, S * 0.1, S * 0.44, S * 0.01);
      ctx.fill();
      stroked(ctx, st, lw);
      ctx.fillRect(x - S * 0.26, baseY - S * 0.26, S * 0.05, S * 0.26);
      ctx.fillRect(x + S * 0.2, baseY - S * 0.26, S * 0.05, S * 0.26);
      break;
    }
    case 'bed': {
      ctx.fillStyle = col('#6b4a2f');
      roundRect(ctx, x - S * 0.5, baseY - S * 0.26, S, S * 0.12, S * 0.02);
      ctx.fill();
      stroked(ctx, st, lw);
      roundRect(ctx, x - S * 0.5, baseY - S * 0.36, S, S * 0.12, S * 0.03);
      fillShape(ctx, st, col(p.palette.secondary), x - S * 0.5, baseY - S * 0.36, S, S * 0.12);
      stroked(ctx, st, lw);
      ctx.fillStyle = col('#f1f3f5');
      roundRect(ctx, x - S * 0.46, baseY - S * 0.44, S * 0.28, S * 0.1, S * 0.03);
      ctx.fill();
      stroked(ctx, st, lw);
      ctx.fillStyle = col('#5a3d26');
      roundRect(ctx, x - S * 0.54, baseY - S * 0.62, S * 0.06, S * 0.62, S * 0.01);
      ctx.fill();
      break;
    }
    case 'nightstand': {
      roundRect(ctx, x - S * 0.26, baseY - S * 0.42, S * 0.52, S * 0.42, S * 0.03);
      fillShape(ctx, st, col('#7a5536'), x - S * 0.26, baseY - S * 0.42, S * 0.52, S * 0.42);
      stroked(ctx, st, lw);
      if (detail > 0.6) {
        ctx.strokeStyle = alpha('#000', 0.3);
        ctx.lineWidth = lw;
        ctx.strokeRect(x - S * 0.2, baseY - S * 0.34, S * 0.4, S * 0.12);
        ctx.beginPath();
        ctx.arc(x, baseY - S * 0.28, S * 0.03, 0, Math.PI * 2);
        ctx.fillStyle = col('#e9c46a');
        ctx.fill();
      }
      break;
    }
    case 'shelf': {
      ctx.fillStyle = col('#7a5536');
      roundRect(ctx, x - S * 0.4, baseY - S * 1.1, S * 0.8, S * 1.1, S * 0.02);
      ctx.fill();
      stroked(ctx, st, lw);
      for (let i = 0; i < 3; i++) {
        const sy = baseY - S * (0.28 + i * 0.3);
        ctx.fillStyle = col('#5a3d26');
        ctx.fillRect(x - S * 0.38, sy, S * 0.76, S * 0.03);
        if (detail > 0.5) {
          const r = rng(p.seed + i * 31);
          for (let j = 0; j < 3; j++) {
            ctx.fillStyle = alpha(j % 2 ? p.palette.accent : p.palette.primary, 0.85);
            const bw = S * (0.07 + r() * 0.05);
            ctx.fillRect(x - S * 0.34 + j * S * 0.22, sy - S * 0.16, bw, S * 0.16);
          }
        }
      }
      break;
    }
    case 'rug': {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, baseY + S * 0.02, S * 0.55, S * 0.13, 0, 0, Math.PI * 2);
      ctx.fillStyle = alpha(p.palette.accent, 0.5);
      ctx.fill();
      ctx.strokeStyle = alpha('#000', 0.2);
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.restore();
      break;
    }

    // ---------------------------------------------------------------- architecture
    case 'door': {
      const open = state === 'open';
      const swing = state === 'moving' ? Math.sin(p.t * 1.6) * 0.5 + 0.5 : open ? 1 : 0;
      // frame
      ctx.fillStyle = col('#3b2a1c');
      ctx.fillRect(x - S * 0.56, baseY - S * 2.08, S * 1.12, S * 2.08);
      // dark opening behind the leaf
      ctx.fillStyle = col(p.night ? '#05070c' : '#1a1d26');
      ctx.fillRect(x - S * 0.5, baseY - S * 2.0, S, S * 2.0);
      if (swing > 0.02) {
        glow(ctx, x, baseY - S, S * 1.6, p.night ? p.palette.secondary : '#ffe9b0', 0.18 * swing);
        emit(p, x, baseY - S, S * 2.4, p.night ? p.palette.secondary : '#ffe9b0', 0.3 * swing);
      }
      // leaf (perspective: narrows as it opens)
      const w = S * (1 - swing * 0.82);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x - S * 0.5, baseY - S * 2.0);
      ctx.lineTo(x - S * 0.5 + w, baseY - S * 2.0 + swing * S * 0.1);
      ctx.lineTo(x - S * 0.5 + w, baseY - swing * S * 0.1);
      ctx.lineTo(x - S * 0.5, baseY);
      ctx.closePath();
      fillShape(ctx, st, col('#7a5536'), x - S * 0.5, baseY - S * 2, w, S * 2);
      stroked(ctx, st, lw);
      ctx.restore();
      if (w > S * 0.3) {
        ctx.fillStyle = col(state === 'locked' ? '#c0392b' : '#e9c46a');
        ctx.beginPath();
        ctx.arc(x - S * 0.5 + w * 0.82, baseY - S, S * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'window': {
      ctx.fillStyle = col('#55606e');
      roundRect(ctx, x - S * 0.5, baseY, S, S * 1.1, S * 0.03);
      ctx.fill();
      stroked(ctx, st, lw);
      const wg = ctx.createLinearGradient(x, baseY, x, baseY + S * 1.1);
      wg.addColorStop(0, p.night ? '#0d1733' : '#bfe3ff');
      wg.addColorStop(1, p.night ? '#1b2a4d' : '#87c1ef');
      ctx.fillStyle = wg;
      const openShift = state === 'open' ? S * 0.3 : 0;
      ctx.fillRect(x - S * 0.44, baseY + S * 0.05, S * 0.88, S);
      ctx.strokeStyle = col('#55606e');
      ctx.lineWidth = Math.max(1.5, S * 0.05);
      ctx.beginPath();
      ctx.moveTo(x + openShift, baseY + S * 0.05);
      ctx.lineTo(x + openShift, baseY + S * 1.05);
      ctx.moveTo(x - S * 0.44, baseY + S * 0.55);
      ctx.lineTo(x + S * 0.44, baseY + S * 0.55);
      ctx.stroke();
      if (p.night) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(x + S * 0.24, baseY + S * 0.3, S * 0.1, 0, Math.PI * 2);
        ctx.fill();
      } else {
        emit(p, x, baseY + S * 0.5, S * 3, '#ffeec2', 0.3);
      }
      break;
    }
    case 'curtain': {
      const openAmt = state === 'open' ? 0.22 : 0.46;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + side * S * 0.56, baseY);
        ctx.quadraticCurveTo(x + side * S * (0.56 - openAmt * 0.4), baseY + S * 0.6, x + side * S * (0.56 - openAmt), baseY + S * 1.25);
        ctx.lineTo(x + side * S * 0.6, baseY + S * 1.25);
        ctx.closePath();
        ctx.fillStyle = alpha(p.palette.accent, 0.55);
        ctx.fill();
        stroked(ctx, st, lw * 0.7);
      }
      break;
    }
    case 'lamp': {
      ctx.fillStyle = col('#4a4f57');
      ctx.fillRect(x - S * 0.05, baseY - S * 1.1, S * 0.1, S * 1.1);
      ctx.beginPath();
      ctx.moveTo(x - S * 0.42, baseY - S * 1.1);
      ctx.lineTo(x + S * 0.42, baseY - S * 1.1);
      ctx.lineTo(x + S * 0.26, baseY - S * 1.5);
      ctx.lineTo(x - S * 0.26, baseY - S * 1.5);
      ctx.closePath();
      const lit = state !== 'off' && state !== 'broken';
      ctx.fillStyle = lit ? col(p.palette.accent) : col('#555b63');
      ctx.fill();
      stroked(ctx, st, lw);
      if (lit) {
        glow(ctx, x, baseY - S * 1.15, S * 2.6, '#ffdd96', 0.5 * flick);
        emit(p, x, baseY - S * 1.15, S * 4, '#ffdd96', 0.75 * flick);
      }
      break;
    }
    case 'mirror': {
      roundRect(ctx, x - S * 0.3, baseY - S * 1.2, S * 0.6, S * 1.2, S * 0.28);
      ctx.fillStyle = col('#8a7a5e');
      ctx.fill();
      stroked(ctx, st, lw);
      roundRect(ctx, x - S * 0.24, baseY - S * 1.14, S * 0.48, S * 1.08, S * 0.24);
      ctx.fillStyle = alpha(state === 'broken' ? '#6b7280' : '#cfe4ff', 0.75);
      ctx.fill();
      if (state === 'broken' && detail > 0.5) {
        ctx.strokeStyle = alpha('#ffffff', 0.7);
        ctx.lineWidth = lw;
        const r = rng(p.seed);
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(x, baseY - S * 0.6);
          ctx.lineTo(x + (r() - 0.5) * S * 0.5, baseY - S * (0.1 + r()));
          ctx.stroke();
        }
      }
      break;
    }
    case 'poster': {
      roundRect(ctx, x - S * 0.3, baseY - S * 0.44, S * 0.6, S * 0.44, S * 0.01);
      ctx.fillStyle = alpha(p.palette.primary, 0.75);
      ctx.fill();
      stroked(ctx, st, lw * 0.7);
      if (detail > 0.6) {
        ctx.fillStyle = alpha(p.palette.accent, 0.8);
        ctx.beginPath();
        ctx.arc(x, baseY - S * 0.26, S * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = alpha('#fff', 0.5);
        ctx.fillRect(x - S * 0.2, baseY - S * 0.1, S * 0.4, S * 0.02);
      }
      break;
    }
    case 'sign': {
      ctx.fillStyle = col('#4a4f57');
      ctx.fillRect(x - S * 0.03, baseY - S * 0.9, S * 0.06, S * 0.9);
      roundRect(ctx, x - S * 0.38, baseY - S * 1.35, S * 0.76, S * 0.46, S * 0.04);
      const lit = p.night && state !== 'off';
      ctx.fillStyle = lit ? alpha(p.palette.accent, 0.95 * flick) : col('#8d99a6');
      ctx.fill();
      stroked(ctx, st, lw);
      if (lit) {
        glow(ctx, x, baseY - S * 1.12, S * 2, p.palette.accent, 0.4 * flick);
        emit(p, x, baseY - S * 1.12, S * 3, p.palette.accent, 0.5 * flick);
      }
      if (detail > 0.6) {
        ctx.fillStyle = alpha(lit ? '#1a1205' : '#ffffff', 0.6);
        ctx.fillRect(x - S * 0.26, baseY - S * 1.2, S * 0.52, S * 0.05);
        ctx.fillRect(x - S * 0.26, baseY - S * 1.08, S * 0.34, S * 0.05);
      }
      break;
    }
    case 'plant': {
      ctx.fillStyle = col('#9c6644');
      roundRect(ctx, x - S * 0.16, baseY - S * 0.3, S * 0.32, S * 0.3, S * 0.03);
      ctx.fill();
      stroked(ctx, st, lw);
      const leaves = Math.round(5 * detail) + 2;
      const r = rng(p.seed + 5);
      for (let i = 0; i < leaves; i++) {
        const ang = -Math.PI / 2 + (i / (leaves - 1) - 0.5) * 2.0;
        const len = S * (0.42 + r() * 0.3);
        const sway = Math.sin(p.t * 0.9 + i) * 0.05;
        ctx.save();
        ctx.translate(x, baseY - S * 0.3);
        ctx.rotate(ang + sway);
        ctx.beginPath();
        ctx.ellipse(0, -len * 0.5, S * 0.07, len * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = col(p.night ? '#20503a' : '#3f8f4f');
        ctx.fill();
        stroked(ctx, st, lw * 0.6);
        ctx.restore();
      }
      break;
    }

    // ---------------------------------------------------------------- small props
    case 'book': {
      ctx.fillStyle = col(p.palette.primary);
      roundRect(ctx, x - S * 0.4, baseY - S * 0.16, S * 0.8, S * 0.16, S * 0.02);
      ctx.fill();
      stroked(ctx, st, lw);
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(x - S * 0.36, baseY - S * 0.12, S * 0.72, S * 0.06);
      break;
    }
    case 'cup': {
      ctx.fillStyle = '#f1f3f5';
      roundRect(ctx, x - S * 0.26, baseY - S * 0.55, S * 0.52, S * 0.55, S * 0.06);
      ctx.fill();
      stroked(ctx, st, lw);
      ctx.strokeStyle = '#f1f3f5';
      ctx.lineWidth = Math.max(2, S * 0.08);
      ctx.beginPath();
      ctx.arc(x + S * 0.3, baseY - S * 0.3, S * 0.14, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      if (state === 'on' && detail > 0.6) {
        ctx.strokeStyle = alpha('#ffffff', 0.35);
        ctx.lineWidth = lw;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          const off = ((p.t * 0.4 + i * 0.5) % 1) * S * 0.4;
          ctx.moveTo(x - S * 0.1 + i * S * 0.2, baseY - S * 0.6 - off);
          ctx.quadraticCurveTo(x + S * 0.02 + i * S * 0.2, baseY - S * 0.75 - off, x - S * 0.08 + i * S * 0.2, baseY - S * 0.9 - off);
          ctx.stroke();
        }
      }
      break;
    }
    case 'bottle': {
      ctx.beginPath();
      ctx.moveTo(x - S * 0.14, baseY);
      ctx.lineTo(x - S * 0.14, baseY - S * 0.42);
      ctx.lineTo(x - S * 0.06, baseY - S * 0.56);
      ctx.lineTo(x - S * 0.06, baseY - S * 0.68);
      ctx.lineTo(x + S * 0.06, baseY - S * 0.68);
      ctx.lineTo(x + S * 0.06, baseY - S * 0.56);
      ctx.lineTo(x + S * 0.14, baseY - S * 0.42);
      ctx.lineTo(x + S * 0.14, baseY);
      ctx.closePath();
      ctx.fillStyle = alpha('#4e9a6a', 0.8);
      ctx.fill();
      stroked(ctx, st, lw);
      break;
    }
    case 'clock': {
      ctx.beginPath();
      ctx.arc(x, baseY - S * 0.5, S * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f1f3f5';
      ctx.fill();
      stroked(ctx, st, lw);
      ctx.strokeStyle = '#16181c';
      ctx.lineWidth = Math.max(1.5, S * 0.06);
      const m = state === 'moving' ? p.t * 1.2 : 0;
      ctx.beginPath();
      ctx.moveTo(x, baseY - S * 0.5);
      ctx.lineTo(x + Math.sin(m) * S * 0.3, baseY - S * 0.5 - Math.cos(m) * S * 0.3);
      ctx.moveTo(x, baseY - S * 0.5);
      ctx.lineTo(x + Math.sin(m * 12) * S * 0.22, baseY - S * 0.5 - Math.cos(m * 12) * S * 0.22);
      ctx.stroke();
      break;
    }
    case 'bag': {
      ctx.fillStyle = col('#6b4a2f');
      roundRect(ctx, x - S * 0.3, baseY - S * 0.5, S * 0.6, S * 0.5, S * 0.05);
      ctx.fill();
      stroked(ctx, st, lw);
      ctx.strokeStyle = col('#6b4a2f');
      ctx.lineWidth = Math.max(2, S * 0.07);
      ctx.beginPath();
      ctx.arc(x, baseY - S * 0.5, S * 0.18, Math.PI, 0);
      ctx.stroke();
      break;
    }
    case 'box': {
      const h = S * 0.52;
      roundRect(ctx, x - S * 0.32, baseY - h, S * 0.64, h, S * 0.02);
      fillShape(ctx, st, col('#8a6a45'), x - S * 0.32, baseY - h, S * 0.64, h);
      stroked(ctx, st, lw);
      if (state === 'open') {
        ctx.beginPath();
        ctx.moveTo(x - S * 0.32, baseY - h);
        ctx.lineTo(x - S * 0.46, baseY - h - S * 0.16);
        ctx.lineTo(x - S * 0.1, baseY - h - S * 0.16);
        ctx.lineTo(x, baseY - h);
        ctx.closePath();
        ctx.fillStyle = col('#9c7a52');
        ctx.fill();
        stroked(ctx, st, lw * 0.7);
      } else if (detail > 0.5) {
        ctx.strokeStyle = alpha('#000', 0.25);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x, baseY - h);
        ctx.lineTo(x, baseY);
        ctx.stroke();
      }
      break;
    }
    case 'key': {
      ctx.strokeStyle = col('#e9c46a');
      ctx.lineWidth = Math.max(1.5, S * 0.07);
      ctx.beginPath();
      ctx.arc(x - S * 0.14, baseY - S * 0.1, S * 0.1, 0, Math.PI * 2);
      ctx.moveTo(x - S * 0.05, baseY - S * 0.1);
      ctx.lineTo(x + S * 0.2, baseY - S * 0.1);
      ctx.moveTo(x + S * 0.14, baseY - S * 0.1);
      ctx.lineTo(x + S * 0.14, baseY - S * 0.02);
      ctx.stroke();
      if (isOn(state)) glow(ctx, x, baseY - S * 0.1, S * 0.9, '#ffe08a', 0.4);
      break;
    }

    // ---------------------------------------------------------------- exterior
    case 'car': {
      const lit = p.night || isOn(state);
      ctx.fillStyle = col(p.palette.accent);
      roundRect(ctx, x - S * 0.6, baseY - S * 0.34, S * 1.2, S * 0.26, S * 0.06);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - S * 0.32, baseY - S * 0.34);
      ctx.lineTo(x - S * 0.18, baseY - S * 0.58);
      ctx.lineTo(x + S * 0.2, baseY - S * 0.58);
      ctx.lineTo(x + S * 0.34, baseY - S * 0.34);
      ctx.closePath();
      ctx.fill();
      stroked(ctx, st, lw);
      ctx.fillStyle = '#9ad2f5';
      ctx.fillRect(x - S * 0.15, baseY - S * 0.54, S * 0.3, S * 0.18);
      ctx.fillStyle = '#16181c';
      for (const o of [-0.34, 0.34]) {
        ctx.beginPath();
        ctx.arc(x + S * o, baseY - S * 0.06, S * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      if (lit) {
        ctx.fillStyle = alpha('#fff3c4', 0.95);
        ctx.beginPath();
        ctx.ellipse(x + S * 0.58, baseY - S * 0.2, S * 0.05, S * 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
        glow(ctx, x + S * 0.6, baseY - S * 0.2, S * 1.6, '#fff3c4', 0.35);
        emit(p, x + S * 0.6, baseY - S * 0.2, S * 2.4, '#fff3c4', 0.45);
      }
      break;
    }
    case 'tree': {
      ctx.fillStyle = col('#5a3d26');
      ctx.fillRect(x - S * 0.07, baseY - S * 0.75, S * 0.14, S * 0.75);
      const leaf = col(p.night ? '#1d4a2b' : '#2f8f47');
      const sway = Math.sin(p.t * 0.6 + p.seed % 7) * S * 0.015;
      for (const [ox, oy, rr] of [[-0.26, -0.9, 0.34], [0.26, -0.92, 0.32], [0, -1.18, 0.38]] as const) {
        ctx.beginPath();
        ctx.arc(x + S * ox + sway, baseY + S * oy, S * rr, 0, Math.PI * 2);
        ctx.fillStyle = leaf;
        ctx.fill();
        stroked(ctx, st, lw);
      }
      break;
    }
    case 'streetlight': {
      ctx.fillStyle = col('#3f454e');
      ctx.fillRect(x - S * 0.05, baseY - S * 2.4, S * 0.1, S * 2.4);
      ctx.beginPath();
      ctx.moveTo(x, baseY - S * 2.4);
      ctx.quadraticCurveTo(x - S * 0.5, baseY - S * 2.6, x - S * 0.6, baseY - S * 2.3);
      ctx.lineWidth = Math.max(2, S * 0.09);
      ctx.strokeStyle = col('#3f454e');
      ctx.stroke();
      if (state !== 'off') {
        glow(ctx, x - S * 0.6, baseY - S * 2.25, S * 2.4, '#ffe096', 0.55 * flick);
        emit(p, x - S * 0.6, baseY - S * 2.25, S * 4, '#ffe096', 0.7 * flick);
      }
      break;
    }
  }
  ctx.restore();
}

/** Horizontal screen position for a logical object slot. */
export function objectX(pos: string, w: number): number {
  switch (pos) {
    case 'far_left': return w * 0.1;
    case 'left': return w * 0.26;
    case 'right': return w * 0.74;
    case 'far_right': return w * 0.9;
    default: return w * 0.5;
  }
}

/** Props that hang on the wall rather than standing on the floor. */
export const WALL_PROPS: ObjType[] = ['window', 'poster', 'clock', 'mirror', 'curtain', 'sign'];
export const BIG_PROPS: ObjType[] = ['bed', 'door', 'car', 'tree', 'streetlight', 'shelf', 'tv', 'table', 'window', 'mirror', 'curtain'];
