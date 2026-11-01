import { alpha, type Ctx, hash, mix, rng, roundRect, shade, type StyleSpec, stroked, styled, TIME_SKY } from './palette';
import type { EnvType, SceneSpec, StyleBible, TimeOfDay } from './types';

/**
 * PROCEDURAL ENVIRONMENT ENGINE
 * Each environment is drawn into three depth bands so camera movement creates true parallax:
 *   FAR   (sky, skyline, distant hills)        depth 0.25
 *   BACK  (walls, buildings, tree line, floor) depth 0.55
 *   MID   (floor detail, fixtures)             depth 0.8
 * Props and characters live above these; a foreground band frames the shot.
 */

export interface EnvCtx {
  w: number;
  h: number;
  horizon: number;
  spec: SceneSpec;
  style: StyleSpec;
  bible: StyleBible | null;
  seed: number;
}

const INDOOR: EnvType[] = ['bedroom', 'living_room', 'kitchen', 'office', 'classroom', 'hospital', 'store', 'warehouse', 'hallway', 'basement', 'apartment'];
export const isIndoor = (e: EnvType) => INDOOR.includes(e);

const ROOM_COLORS: Partial<Record<EnvType, { wall: string; floor: string }>> = {
  bedroom: { wall: '#d8ccdd', floor: '#9b7b64' },
  living_room: { wall: '#e6d9c6', floor: '#9c6f43' },
  kitchen: { wall: '#e8efe6', floor: '#b9bec4' },
  office: { wall: '#cfd8e3', floor: '#8c99a8' },
  classroom: { wall: '#e3ddc8', floor: '#9e8f74' },
  hospital: { wall: '#dbe7ef', floor: '#c3d3dd' },
  store: { wall: '#f1e4cf', floor: '#b98f63' },
  warehouse: { wall: '#4a4f57', floor: '#3a3f46' },
  hallway: { wall: '#cbc7bd', floor: '#8a8279' },
  basement: { wall: '#4e4a45', floor: '#3a3733' },
  apartment: { wall: '#ded3c4', floor: '#a07a52' },
};

function skyGradient(ctx: Ctx, w: number, h: number, time: TimeOfDay, st: StyleSpec, bible: StyleBible | null) {
  const [a, b] = TIME_SKY[time];
  const g = ctx.createLinearGradient(0, -h * 0.4, 0, h);
  g.addColorStop(0, styled(bible ? mix(a, bible.palette.sky, 0.35) : a, st));
  g.addColorStop(1, styled(b, st));
  ctx.fillStyle = g;
  ctx.fillRect(-w * 0.7, -h * 0.5, w * 2.4, h * 2);
}

function stars(ctx: Ctx, w: number, h: number, seed: number, n: number) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.25) * w * 1.6;
    const y = r() * h * 0.62;
    ctx.globalAlpha = 0.2 + r() * 0.75;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, r() * 1.8 + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** FAR layer — sky, celestial bodies, distant silhouettes. */
export function drawFar(ctx: Ctx, e: EnvCtx) {
  const { w, h, horizon, spec, style: st, bible } = e;
  const env = spec.environment.type;
  const time = spec.environment.time;
  const night = time === 'night';

  if (env === 'space') {
    ctx.fillStyle = styled('#05060f', st);
    ctx.fillRect(-w * 0.7, -h * 0.5, w * 2.4, h * 2);
    stars(ctx, w, h, e.seed, Math.round(160 * st.detail));
    const neb = ctx.createRadialGradient(w * 0.7, h * 0.3, 0, w * 0.7, h * 0.3, w * 0.8);
    neb.addColorStop(0, alpha(bible?.palette.primary ?? '#4c6ef5', 0.32));
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(-w * 0.7, -h * 0.5, w * 2.4, h * 2);
    const pg = ctx.createRadialGradient(w * 0.2, h * 0.7, w * 0.03, w * 0.22, h * 0.68, w * 0.32);
    pg.addColorStop(0, styled(bible?.palette.secondary ?? '#15aabf', st));
    pg.addColorStop(1, '#0b1020');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(w * 0.22, h * 0.68, w * 0.26, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (env === 'abstract') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, styled(bible?.palette.sky ?? '#1c2333', st));
    g.addColorStop(1, styled(bible?.palette.primary ?? '#4c6ef5', st));
    ctx.fillStyle = g;
    ctx.fillRect(-w * 0.7, -h * 0.5, w * 2.4, h * 2);
    const r = rng(e.seed);
    for (let i = 0; i < Math.round(14 * st.detail); i++) {
      const x = r() * w, y = r() * h, rad = (0.08 + r() * 0.3) * w;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, alpha(i % 2 ? bible?.palette.accent ?? '#f59f00' : bible?.palette.secondary ?? '#15aabf', 0.22));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (isIndoor(env) || env === 'cave') {
    const c = ROOM_COLORS[env] ?? { wall: '#cbc7bd', floor: '#8a8279' };
    const base = env === 'cave' ? '#161210' : night ? shade(c.wall, -0.5) : c.wall;
    ctx.fillStyle = styled(base, st);
    ctx.fillRect(-w * 0.7, -h * 0.5, w * 2.4, h * 2);
    return;
  }

  // outdoor sky
  skyGradient(ctx, w, h, time, st, bible);
  if (night) stars(ctx, w, h, e.seed, Math.round(80 * st.detail));
  if (night || time === 'dawn') {
    ctx.beginPath();
    ctx.arc(w * 0.76, h * 0.16, w * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = alpha('#f2f6ff', 0.95);
    ctx.fill();
  } else if (time === 'sunset') {
    const sg = ctx.createRadialGradient(w * 0.3, horizon - h * 0.06, 0, w * 0.3, horizon - h * 0.06, w * 0.4);
    sg.addColorStop(0, 'rgba(255,190,110,0.85)');
    sg.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(-w * 0.3, 0, w * 1.6, horizon);
  }

  // distant hills / skyline silhouette
  const r = rng(e.seed + 3);
  if (env === 'forest' || env === 'park' || env === 'beach' || env === 'house') {
    ctx.fillStyle = alpha(night ? '#0d1a2b' : '#7e9bb5', 0.55);
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, horizon);
    for (let x = -w * 0.5; x <= w * 1.6; x += w * 0.18) ctx.quadraticCurveTo(x + w * 0.09, horizon - h * (0.05 + r() * 0.07), x + w * 0.18, horizon - h * 0.02);
    ctx.lineTo(w * 1.6, horizon);
    ctx.closePath();
    ctx.fill();
  } else if (env === 'city' || env === 'street' || env === 'rooftop') {
    ctx.fillStyle = styled(night ? '#101627' : '#6d7f99', st);
    let x = -w * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, horizon);
    while (x < w * 1.6) {
      const bw = w * (0.05 + r() * 0.08);
      const bh = h * (0.1 + r() * 0.26);
      ctx.lineTo(x, horizon - bh);
      ctx.lineTo(x + bw, horizon - bh);
      x += bw;
    }
    ctx.lineTo(x, horizon);
    ctx.closePath();
    ctx.fill();
    if (night) {
      const r2 = rng(e.seed + 7);
      for (let i = 0; i < Math.round(130 * st.detail); i++) {
        if (r2() > 0.5) continue;
        ctx.fillStyle = alpha(r2() > 0.3 ? '#ffd483' : '#8fd4ff', 0.7);
        ctx.fillRect(-w * 0.4 + r2() * w * 1.9, horizon - r2() * h * 0.34, w * 0.007, h * 0.008);
      }
    }
  }
}

/** BACK layer — the room shell, buildings, trees, ground plane. */
export function drawBack(ctx: Ctx, e: EnvCtx) {
  const { w, h, horizon, spec, style: st } = e;
  const env = spec.environment.type;
  const night = spec.environment.time === 'night';
  const r = rng(e.seed + 11);
  const detail = st.detail;

  if (isIndoor(env)) {
    const c = ROOM_COLORS[env] ?? { wall: '#cbc7bd', floor: '#8a8279' };
    const wall = styled(night ? shade(c.wall, -0.45) : c.wall, st);
    const floor = styled(night ? shade(c.floor, -0.45) : c.floor, st);
    // back wall with subtle vertical shading
    const wg = ctx.createLinearGradient(0, 0, 0, horizon);
    wg.addColorStop(0, shade(wall, -0.12));
    wg.addColorStop(1, shade(wall, 0.06));
    ctx.fillStyle = wg;
    ctx.fillRect(-w * 0.7, -h * 0.5, w * 2.4, horizon + h * 0.5);
    // side walls (perspective wedges) give the room real depth
    if (env === 'hallway') {
      ctx.fillStyle = shade(wall, -0.28);
      ctx.beginPath();
      ctx.moveTo(-w * 0.7, -h * 0.5);
      ctx.lineTo(w * 0.22, horizon - h * 0.3);
      ctx.lineTo(w * 0.22, horizon + h * 0.1);
      ctx.lineTo(-w * 0.7, h * 1.4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w * 1.7, -h * 0.5);
      ctx.lineTo(w * 0.78, horizon - h * 0.3);
      ctx.lineTo(w * 0.78, horizon + h * 0.1);
      ctx.lineTo(w * 1.7, h * 1.4);
      ctx.closePath();
      ctx.fill();
      // ceiling lights receding
      for (let i = 0; i < 4; i++) {
        const t2 = i / 4;
        const lx = w * 0.5;
        const ly = h * (0.08 + t2 * 0.16);
        const lw2 = w * (0.18 - t2 * 0.1);
        ctx.fillStyle = alpha('#fff4d0', night ? 0.5 : 0.75);
        roundRect(ctx, lx - lw2 / 2, ly, lw2, h * 0.012, h * 0.006);
        ctx.fill();
      }
    }
    // floor
    const fg = ctx.createLinearGradient(0, horizon, 0, h * 1.3);
    fg.addColorStop(0, shade(floor, -0.18));
    fg.addColorStop(1, shade(floor, 0.1));
    ctx.fillStyle = fg;
    ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
    // skirting + boards
    ctx.fillStyle = shade(wall, -0.34);
    ctx.fillRect(-w * 0.7, horizon - h * 0.016, w * 2.4, h * 0.016);
    if (detail > 0.5) {
      ctx.strokeStyle = alpha('#000', 0.08);
      ctx.lineWidth = Math.max(1, w * 0.0014);
      for (let i = 1; i < 9; i++) {
        const y = horizon + (h - horizon) * (i / 9) ** 1.6;
        ctx.beginPath();
        ctx.moveTo(-w * 0.7, y);
        ctx.lineTo(w * 1.7, y);
        ctx.stroke();
      }
    }
    // wall texture for grittier rooms
    if ((env === 'basement' || env === 'warehouse') && detail > 0.6) {
      ctx.strokeStyle = alpha('#000', 0.14);
      ctx.lineWidth = Math.max(1, w * 0.0012);
      for (let i = 0; i < 10; i++) {
        const y = horizon * (0.15 + i * 0.085);
        ctx.beginPath();
        ctx.moveTo(-w * 0.6, y);
        ctx.lineTo(w * 1.6, y);
        ctx.stroke();
      }
    }
    return;
  }

  switch (env) {
    case 'street': {
      ctx.fillStyle = styled('#2f3237', st);
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
      // sidewalk
      ctx.fillStyle = styled('#5c6168', st);
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h * 0.05);
      // closer buildings
      let x = -w * 0.35;
      while (x < w * 1.45) {
        const bw = w * (0.15 + r() * 0.12);
        const bh = h * (0.22 + r() * 0.26);
        ctx.fillStyle = styled(night ? '#1d2436' : '#7d8899', st);
        roundRect(ctx, x, horizon - bh, bw, bh, w * 0.004);
        ctx.fill();
        stroked(ctx, st, 1);
        if (detail > 0.5) {
          for (let i = 0; i < 8; i++) {
            ctx.fillStyle = night ? alpha('#ffd483', r() > 0.45 ? 0.85 : 0.08) : alpha('#cfe4ff', 0.5);
            ctx.fillRect(x + bw * (0.12 + (i % 3) * 0.3), horizon - bh + h * (0.03 + Math.floor(i / 3) * 0.07), bw * 0.17, h * 0.038);
          }
        }
        x += bw + w * 0.02;
      }
      ctx.strokeStyle = alpha('#f8f0c0', 0.7);
      ctx.lineWidth = Math.max(2, h * 0.006);
      ctx.setLineDash([w * 0.05, w * 0.045]);
      ctx.beginPath();
      ctx.moveTo(-w * 0.7, horizon + h * 0.16);
      ctx.lineTo(w * 1.7, horizon + h * 0.16);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'city': {
      let x = -w * 0.4;
      while (x < w * 1.5) {
        const bw = w * (0.1 + r() * 0.1);
        const bh = h * (0.26 + r() * 0.34);
        ctx.fillStyle = styled(night ? '#161d2e' : '#6c7a92', st);
        ctx.fillRect(x, horizon - bh, bw, bh);
        stroked(ctx, st, 1);
        x += bw + w * 0.014;
      }
      ctx.fillStyle = styled('#2f3237', st);
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
      break;
    }
    case 'rooftop': {
      ctx.fillStyle = styled(night ? '#2a2e36' : '#6e7681', st);
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
      ctx.fillStyle = styled(night ? '#1d2129' : '#5a626c', st);
      ctx.fillRect(-w * 0.7, horizon - h * 0.04, w * 2.4, h * 0.045);
      break;
    }
    case 'forest': {
      const n = Math.round(9 * st.detail) + 3;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w * 1.7 - w * 0.3 + r() * w * 0.05;
        const th = h * (0.3 + r() * 0.26);
        ctx.fillStyle = styled(night ? '#132a1b' : '#27603a', st);
        ctx.fillRect(x, horizon - th, w * 0.022, th);
        ctx.beginPath();
        ctx.ellipse(x + w * 0.011, horizon - th, w * (0.07 + r() * 0.04), th * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = styled(night ? '#14301d' : '#2d6a3f', st);
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
      break;
    }
    case 'park': {
      ctx.fillStyle = styled(night ? '#1d4529' : '#3f8f4f', st);
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
      ctx.strokeStyle = alpha('#d9c89a', 0.5);
      ctx.lineWidth = h * 0.03;
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, h * 1.1);
      ctx.quadraticCurveTo(w * 0.5, horizon + h * 0.12, w * 1.2, horizon + h * 0.02);
      ctx.stroke();
      break;
    }
    case 'beach': {
      const sg = ctx.createLinearGradient(0, horizon - h * 0.22, 0, horizon + h * 0.05);
      sg.addColorStop(0, styled('#1b6ca8', st));
      sg.addColorStop(1, styled('#2a9d8f', st));
      ctx.fillStyle = sg;
      ctx.fillRect(-w * 0.7, horizon - h * 0.22, w * 2.4, h * 0.27);
      ctx.strokeStyle = alpha('#ffffff', 0.4);
      ctx.lineWidth = Math.max(1, h * 0.0025);
      for (let i = 0; i < Math.round(16 * detail); i++) {
        const y = horizon - h * 0.2 + r() * h * 0.22;
        ctx.beginPath();
        ctx.moveTo(r() * w, y);
        ctx.lineTo(r() * w + w * 0.08, y);
        ctx.stroke();
      }
      const sand = ctx.createLinearGradient(0, horizon, 0, h);
      sand.addColorStop(0, styled('#e8d2a0', st));
      sand.addColorStop(1, styled('#c9ad79', st));
      ctx.fillStyle = sand;
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
      break;
    }
    case 'cave': {
      ctx.fillStyle = styled('#1a1512', st);
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
      ctx.fillStyle = styled('#241c18', st);
      ctx.beginPath();
      ctx.moveTo(-w * 0.7, -h * 0.5);
      for (let x = -w * 0.7; x <= w * 1.7; x += w * 0.1) ctx.lineTo(x, h * (0.05 + r() * 0.18));
      ctx.lineTo(w * 1.7, -h * 0.5);
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < Math.round(7 * detail); i++) {
        const x = -w * 0.2 + i * w * 0.22;
        ctx.fillStyle = styled('#2b221c', st);
        ctx.beginPath();
        ctx.moveTo(x, -h * 0.1);
        ctx.lineTo(x + w * 0.035, h * (0.16 + r() * 0.16));
        ctx.lineTo(x + w * 0.07, -h * 0.1);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'house': {
      ctx.fillStyle = styled(night ? '#1d4529' : '#4e9b55', st);
      ctx.fillRect(-w * 0.7, horizon, w * 2.4, h);
      // house facade
      ctx.fillStyle = styled(night ? '#2e2a33' : '#d8c8ad', st);
      roundRect(ctx, w * 0.22, horizon - h * 0.34, w * 0.56, h * 0.34, w * 0.005);
      ctx.fill();
      stroked(ctx, st, 1);
      ctx.beginPath();
      ctx.moveTo(w * 0.17, horizon - h * 0.34);
      ctx.lineTo(w * 0.5, horizon - h * 0.52);
      ctx.lineTo(w * 0.83, horizon - h * 0.34);
      ctx.closePath();
      ctx.fillStyle = styled(night ? '#1f1c24' : '#9a5f43', st);
      ctx.fill();
      stroked(ctx, st, 1);
      break;
    }
    case 'space':
    case 'abstract':
    default:
      break;
  }
}

/** MID layer — ground contact shadows and depth haze that sit just behind the props. */
export function drawMid(ctx: Ctx, e: EnvCtx) {
  const { w, h, horizon, spec, style: st } = e;
  void mix;
  const night = spec.environment.time === 'night';
  // distance haze above the horizon line
  const haze = ctx.createLinearGradient(0, horizon - h * 0.25, 0, horizon + h * 0.05);
  haze.addColorStop(0, 'rgba(0,0,0,0)');
  haze.addColorStop(1, alpha(night ? '#0a1020' : '#cfd9e6', night ? 0.35 : 0.22));
  ctx.fillStyle = haze;
  ctx.fillRect(-w * 0.7, horizon - h * 0.25, w * 2.4, h * 0.3);
  if (st.detail > 0.7 && !isIndoor(spec.environment.type)) {
    ctx.fillStyle = alpha('#000', 0.08);
    ctx.fillRect(-w * 0.7, horizon, w * 2.4, h * 0.02);
  }
}

/** FOREGROUND band — framing elements closest to the lens (strongest parallax). */
export function drawForeground(ctx: Ctx, e: EnvCtx) {
  const { w, h, spec, style: st } = e;
  const env = spec.environment.type;
  const night = spec.environment.time === 'night';
  if (st.detail < 0.5) return;

  if (env === 'forest' || env === 'park') {
    ctx.fillStyle = alpha('#06140c', 0.88);
    ctx.fillRect(-w * 0.12, -h * 0.1, w * 0.09, h * 1.3);
    ctx.fillRect(w * 1.03, -h * 0.1, w * 0.09, h * 1.3);
    // a few hanging leaves
    const r = rng(e.seed + 19);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(w * (r() * 1.1 - 0.05), -h * 0.02 + r() * h * 0.12, w * 0.05, h * 0.03, r(), 0, Math.PI * 2);
      ctx.fillStyle = alpha('#07160d', 0.8);
      ctx.fill();
    }
  } else if (env === 'street' || env === 'city' || env === 'rooftop') {
    ctx.fillStyle = alpha('#05070c', 0.5);
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, h * 1.12);
    ctx.lineTo(-w * 0.1, h * 0.88);
    ctx.lineTo(w * 1.1, h * 0.94);
    ctx.lineTo(w * 1.1, h * 1.12);
    ctx.closePath();
    ctx.fill();
  } else if (isIndoor(env)) {
    ctx.fillStyle = alpha('#000', night ? 0.3 : 0.16);
    ctx.fillRect(-h * 0.02, -h * 0.1, w * 0.05, h * 1.3);
    ctx.fillRect(w * 0.95, -h * 0.1, w * 0.06, h * 1.3);
  } else if (env === 'cave') {
    ctx.fillStyle = alpha('#05040a', 0.9);
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, -h * 0.1);
    ctx.lineTo(w * 0.1, -h * 0.1);
    ctx.quadraticCurveTo(w * 0.04, h * 0.4, w * 0.16, h * 1.2);
    ctx.lineTo(-w * 0.1, h * 1.2);
    ctx.closePath();
    ctx.fill();
  }
}

export function envSeed(spec: SceneSpec, projectSeed: number) {
  return (hash(spec.environment.type + spec.environment.time + spec.environment.weather) ^ projectSeed) >>> 0;
}
