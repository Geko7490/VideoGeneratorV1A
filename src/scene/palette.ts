import type { LightDir, LightStyle, StyleBible, TimeOfDay, VisualStyle } from './types';

/**
 * STYLE SYSTEM — a style is not just a palette swap. It changes line weight, shape detail,
 * shading, light response, atmosphere and animation feel.
 */
export interface StyleSpec {
  outline: string | null;
  outlineWidth: number;
  saturation: number;
  contrast: number;
  grain: number;
  hatch: boolean;
  flat: boolean;        // no gradients
  bloom: number;
  darkness: number;
  rounded: number;      // corner roundness multiplier
  detail: number;       // 0.4..1.4 — how many small props/details are drawn
  shadowSoftness: number;
  /** Animation feel: 1 = natural, >1 snappier/bouncier, <1 slower & heavier. */
  animSpeed: number;
  animJitter: number;   // extra noise on limbs (sketchy / handmade feel)
  monochrome: number;   // 0..1 desaturate toward grey (noir)
}

export const STYLE_SPECS: Record<VisualStyle, StyleSpec> = {
  cinematic_2d: { outline: '#0d1017', outlineWidth: 0.7, saturation: 0.95, contrast: 1.1, grain: 0.07, hatch: false, flat: false, bloom: 0.12, darkness: 0.14, rounded: 1, detail: 1.1, shadowSoftness: 1, animSpeed: 1, animJitter: 0, monochrome: 0 },
  cartoon: { outline: '#1b1f27', outlineWidth: 1.1, saturation: 1.2, contrast: 1, grain: 0.02, hatch: false, flat: false, bloom: 0, darkness: 0, rounded: 1.3, detail: 1, shadowSoftness: 0.7, animSpeed: 1.2, animJitter: 0.1, monochrome: 0 },
  dark_cartoon: { outline: '#08090d', outlineWidth: 1.25, saturation: 0.85, contrast: 1.18, grain: 0.06, hatch: false, flat: false, bloom: 0.1, darkness: 0.24, rounded: 1.05, detail: 1, shadowSoftness: 1.1, animSpeed: 1.05, animJitter: 0.05, monochrome: 0.08 },
  comic: { outline: '#0b0b0b', outlineWidth: 1.9, saturation: 1.3, contrast: 1.25, grain: 0.1, hatch: true, flat: true, bloom: 0, darkness: 0.04, rounded: 0.7, detail: 0.9, shadowSoftness: 0.4, animSpeed: 1.25, animJitter: 0.12, monochrome: 0 },
  minimal: { outline: null, outlineWidth: 0, saturation: 0.7, contrast: 0.9, grain: 0, hatch: false, flat: true, bloom: 0, darkness: 0, rounded: 1.5, detail: 0.45, shadowSoftness: 0.3, animSpeed: 0.9, animJitter: 0, monochrome: 0.1 },
  flat: { outline: null, outlineWidth: 0, saturation: 1.25, contrast: 1, grain: 0, hatch: false, flat: true, bloom: 0, darkness: 0, rounded: 1.15, detail: 0.8, shadowSoftness: 0.35, animSpeed: 1, animJitter: 0, monochrome: 0 },
  stylized: { outline: '#161b26', outlineWidth: 0.9, saturation: 1.15, contrast: 1.12, grain: 0.04, hatch: false, flat: false, bloom: 0.2, darkness: 0.08, rounded: 1.2, detail: 1.25, shadowSoftness: 0.9, animSpeed: 1.1, animJitter: 0.04, monochrome: 0 },
  horror: { outline: '#05070a', outlineWidth: 1.1, saturation: 0.4, contrast: 1.4, grain: 0.17, hatch: false, flat: false, bloom: 0.05, darkness: 0.44, rounded: 0.8, detail: 1, shadowSoftness: 1.5, animSpeed: 0.8, animJitter: 0.08, monochrome: 0.45 },
  noir: { outline: '#000000', outlineWidth: 1.3, saturation: 0.12, contrast: 1.5, grain: 0.14, hatch: false, flat: false, bloom: 0.06, darkness: 0.3, rounded: 0.85, detail: 0.95, shadowSoftness: 1.6, animSpeed: 0.92, animJitter: 0, monochrome: 0.92 },
  neon: { outline: '#06060f', outlineWidth: 0.9, saturation: 1.55, contrast: 1.2, grain: 0.05, hatch: false, flat: false, bloom: 0.6, darkness: 0.32, rounded: 1.1, detail: 1.1, shadowSoftness: 0.8, animSpeed: 1.08, animJitter: 0.03, monochrome: 0 },
  dreamlike: { outline: null, outlineWidth: 0, saturation: 1.05, contrast: 0.88, grain: 0.09, hatch: false, flat: false, bloom: 0.45, darkness: 0.05, rounded: 1.45, detail: 0.9, shadowSoftness: 1.8, animSpeed: 0.75, animJitter: 0.02, monochrome: 0 },
  documentary: { outline: '#2a2f38', outlineWidth: 0.8, saturation: 0.82, contrast: 1.02, grain: 0.12, hatch: true, flat: false, bloom: 0, darkness: 0.06, rounded: 0.95, detail: 1.15, shadowSoftness: 0.8, animSpeed: 0.95, animJitter: 0.06, monochrome: 0.2 },
};

export interface LightSpec {
  ambient: string;
  ambientAlpha: number;
  key: string;
  keyAlpha: number;
  vignette: number;
  shadowAlpha: number;
  warm: boolean;
  beam: boolean;
  rim: string | null;   // rim-light colour on subjects
  rimAlpha: number;
  flicker: number;      // 0..1 flicker amount
}

export const LIGHT_SPECS: Record<LightStyle, LightSpec> = {
  daylight: { ambient: '#fff6e0', ambientAlpha: 0.05, key: '#fff3cf', keyAlpha: 0.22, vignette: 0.18, shadowAlpha: 0.26, warm: true, beam: false, rim: '#ffffff', rimAlpha: 0.18, flicker: 0 },
  night: { ambient: '#0b1430', ambientAlpha: 0.5, key: '#8fb4ff', keyAlpha: 0.14, vignette: 0.5, shadowAlpha: 0.44, warm: false, beam: false, rim: '#9fc0ff', rimAlpha: 0.3, flicker: 0 },
  moonlight: { ambient: '#16254d', ambientAlpha: 0.44, key: '#cfe0ff', keyAlpha: 0.26, vignette: 0.46, shadowAlpha: 0.42, warm: false, beam: true, rim: '#dbe8ff', rimAlpha: 0.38, flicker: 0 },
  warm: { ambient: '#ffb366', ambientAlpha: 0.15, key: '#ffd9a0', keyAlpha: 0.24, vignette: 0.26, shadowAlpha: 0.28, warm: true, beam: false, rim: '#ffd9a0', rimAlpha: 0.2, flicker: 0 },
  cold: { ambient: '#b9d9ff', ambientAlpha: 0.14, key: '#ffffff', keyAlpha: 0.2, vignette: 0.26, shadowAlpha: 0.24, warm: false, beam: false, rim: '#e8f3ff', rimAlpha: 0.22, flicker: 0 },
  sunset: { ambient: '#ff8f4d', ambientAlpha: 0.22, key: '#ffd08a', keyAlpha: 0.32, vignette: 0.3, shadowAlpha: 0.34, warm: true, beam: true, rim: '#ffbb70', rimAlpha: 0.42, flicker: 0 },
  neon: { ambient: '#12042a', ambientAlpha: 0.4, key: '#ff3cac', keyAlpha: 0.32, vignette: 0.44, shadowAlpha: 0.38, warm: false, beam: false, rim: '#36e0ff', rimAlpha: 0.5, flicker: 0.12 },
  flashlight: { ambient: '#05070d', ambientAlpha: 0.66, key: '#ffeec2', keyAlpha: 0.52, vignette: 0.64, shadowAlpha: 0.5, warm: true, beam: true, rim: '#ffeec2', rimAlpha: 0.3, flicker: 0.18 },
  dark: { ambient: '#05060b', ambientAlpha: 0.58, key: '#5b6b9a', keyAlpha: 0.12, vignette: 0.58, shadowAlpha: 0.5, warm: false, beam: false, rim: '#6f82b8', rimAlpha: 0.25, flicker: 0 },
  horror: { ambient: '#060a08', ambientAlpha: 0.62, key: '#7fe3b0', keyAlpha: 0.15, vignette: 0.68, shadowAlpha: 0.56, warm: false, beam: false, rim: '#86ffc4', rimAlpha: 0.3, flicker: 0.25 },
  dramatic: { ambient: '#07090f', ambientAlpha: 0.46, key: '#ffffff', keyAlpha: 0.44, vignette: 0.56, shadowAlpha: 0.54, warm: false, beam: true, rim: '#ffffff', rimAlpha: 0.55, flicker: 0 },
};

export const TIME_SKY: Record<TimeOfDay, [string, string]> = {
  dawn: ['#2b3a67', '#f6a07a'],
  day: ['#4a90d9', '#bfe3ff'],
  sunset: ['#2a1b4a', '#ff8a52'],
  night: ['#060a1c', '#1b2a4d'],
};

export function lightOrigin(dir: LightDir, w: number, h: number): { x: number; y: number } {
  switch (dir) {
    case 'left': return { x: w * 0.05, y: h * 0.25 };
    case 'right': return { x: w * 0.95, y: h * 0.25 };
    case 'top': return { x: w * 0.5, y: -h * 0.1 };
    case 'window': return { x: w * 0.78, y: h * 0.3 };
    case 'front': return { x: w * 0.5, y: h * 0.45 };
    case 'back': return { x: w * 0.5, y: h * 1.05 };
  }
}

// ---------- colour helpers ----------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number) {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return amount >= 0 ? rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount) : rgbToHex(r * (1 + amount), g * (1 + amount), b * (1 + amount));
}
export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Applies the style's saturation / contrast / darkness / monochrome to any colour. */
export function styled(hex: string, s: StyleSpec): string {
  let [r, g, b] = hexToRgb(hex);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = s.saturation * (1 - s.monochrome);
  r = lum + (r - lum) * sat;
  g = lum + (g - lum) * sat;
  b = lum + (b - lum) * sat;
  const mid = 128;
  r = mid + (r - mid) * s.contrast;
  g = mid + (g - mid) * s.contrast;
  b = mid + (b - mid) * s.contrast;
  const d = 1 - s.darkness;
  return rgbToHex(r * d, g * d, b * d);
}

export function styleOf(bible: StyleBible | null): StyleSpec {
  return STYLE_SPECS[bible?.style ?? 'cinematic_2d'];
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function stroked(ctx: Ctx, s: StyleSpec, scale: number) {
  if (!s.outline) return;
  ctx.strokeStyle = s.outline;
  ctx.lineWidth = Math.max(0.6, s.outlineWidth * scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Fills the current path with either a flat colour or a soft vertical gradient (style aware). */
export function fillShape(ctx: Ctx, s: StyleSpec, color: string, x: number, y: number, w: number, h: number) {
  if (s.flat) {
    ctx.fillStyle = color;
  } else {
    const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
    g.addColorStop(0, shade(color, 0.1));
    g.addColorStop(1, shade(color, -0.2));
    ctx.fillStyle = g;
  }
  ctx.fill();
}
