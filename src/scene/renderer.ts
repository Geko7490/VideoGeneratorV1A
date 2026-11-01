import { drawCharacter } from './character';
import { drawBack, drawFar, drawForeground, drawMid, envSeed, isIndoor, type EnvCtx } from './environment';
import { drawProp, objectX, BIG_PROPS, WALL_PROPS, type PropCtx } from './props';
import { drawEffect, drawGrain, type Quality } from './effects';
import { alpha, type Ctx, hash, LIGHT_SPECS, lightOrigin, rng, STYLE_SPECS } from './palette';
import { defaultCharacter, type ObjectInScene, type SceneSpec, type ShotType, type StyleBible } from './types';

/**
 * PROCEDURAL 2D SCENE ENGINE — frame renderer.
 *
 * Layer stack (each drawn with its own parallax depth):
 *   FAR BACKGROUND 0.22 → BACKGROUND 0.5 → MIDGROUND 0.78 → OBJECTS 0.95
 *   → CHARACTERS 1.0 → FOREGROUND 1.4 → LIGHTING → ATMOSPHERE → PARTICLES → CAMERA FX
 *
 * The three static bands are rasterised once per (look, size) and reused for every frame
 * (asset cache); only camera, animated props, characters, light and particles change per frame.
 */

export interface CameraState { zoom: number; x: number; y: number; rot: number }

const SHOT_BASE: Record<ShotType, { zoom: number; y: number }> = {
  establishing: { zoom: 0.92, y: 0 },
  wide: { zoom: 1.0, y: 0 },
  medium: { zoom: 1.45, y: -0.1 },
  close_up: { zoom: 2.5, y: -0.22 },
  extreme_close_up: { zoom: 4.0, y: -0.28 },
  pov: { zoom: 1.9, y: -0.05 },
  low_angle: { zoom: 1.5, y: 0.16 },
  high_angle: { zoom: 1.35, y: -0.2 },
  top_down: { zoom: 1.2, y: 0.14 },
  over_shoulder: { zoom: 1.75, y: -0.14 },
  side_view: { zoom: 1.3, y: -0.06 },
};

const ease = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
const POS_X: Record<string, number> = { far_left: 0.12, left: 0.28, center: 0.5, right: 0.72, far_right: 0.88 };

/** Resolves the screen-space anchor (0..1) of the camera target id. */
function targetAnchor(spec: SceneSpec): number | null {
  const id = spec.camera.target;
  if (!id) return null;
  const c = spec.characters.find((x) => x.id === id);
  if (c) return POS_X[c.position] ?? 0.5;
  const o = spec.objects.find((x) => x.id === id);
  if (o) return POS_X[o.position] ?? 0.5;
  return null;
}

export function computeCamera(spec: SceneSpec, p: number, t: number, seed: number): CameraState {
  const base = SHOT_BASE[spec.camera.shot] ?? SHOT_BASE.medium;
  const e = ease(Math.min(1, Math.max(0, p)));
  const cam: CameraState = { zoom: base.zoom, x: 0, y: base.y, rot: 0 };
  const n = (f: number, o: number) => Math.sin(t * f + o) * 0.5 + Math.sin(t * f * 2.3 + o * 1.7) * 0.3;

  switch (spec.camera.movement) {
    case 'slow_zoom_in': cam.zoom = base.zoom * (1 + 0.16 * e); break;
    case 'slow_zoom_out': cam.zoom = base.zoom * (1.16 - 0.16 * e); break;
    case 'pan_left': cam.x = (0.5 - e) * 0.42; break;
    case 'pan_right': cam.x = (e - 0.5) * 0.42; break;
    case 'tilt_up': cam.y = base.y + (0.5 - e) * 0.3; break;
    case 'tilt_down': cam.y = base.y + (e - 0.5) * 0.3; break;
    case 'tracking': cam.x = (e - 0.5) * 0.55; cam.zoom = base.zoom * 1.05; break;
    case 'orbit':
      // arc around the subject: lateral sweep + slight counter-rotation + breathing zoom
      cam.x = Math.sin(e * Math.PI - Math.PI / 2) * 0.3;
      cam.rot = Math.sin(e * Math.PI - Math.PI / 2) * -0.025;
      cam.zoom = base.zoom * (1.04 + Math.sin(e * Math.PI) * 0.08);
      break;
    case 'shake':
      cam.x = n(9.1, seed % 7) * 0.035;
      cam.y = base.y + n(11.3, seed % 11) * 0.03;
      cam.rot = n(7.7, seed % 5) * 0.012;
      cam.zoom = base.zoom * 1.06;
      break;
    case 'handheld':
      cam.x = n(1.1, seed % 3) * 0.02;
      cam.y = base.y + n(0.9, seed % 13) * 0.018;
      cam.rot = n(0.7, seed % 9) * 0.006;
      cam.zoom = base.zoom * (1.02 + 0.02 * e);
      break;
    case 'static':
    default:
      cam.zoom = base.zoom * (1 + 0.012 * e);
      break;
  }

  // keep the camera target framed: smoothly bias the centre toward it as we zoom in
  const anchor = targetAnchor(spec);
  if (anchor !== null && cam.zoom > 1.1) {
    const pull = Math.min(1, (cam.zoom - 1) / 1.6) * 0.75;
    cam.x += (anchor - 0.5) * pull;
  }
  if (spec.camera.shot === 'low_angle') cam.rot += 0.015;
  if (spec.camera.shot === 'high_angle') cam.rot -= 0.012;
  if (spec.camera.shot === 'side_view') cam.rot += 0.008;
  return cam;
}

function applyCamera(ctx: Ctx, cam: CameraState, depth: number, W: number, H: number) {
  const z = 1 + (cam.zoom - 1) * (0.5 + depth * 0.7);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(cam.rot * depth);
  ctx.scale(z, z);
  ctx.translate(-W / 2 - cam.x * W * depth, -H / 2 - cam.y * H * depth);
}

// ---------------------------------------------------------------- static layer cache

interface Cached { far: OffscreenCanvas | HTMLCanvasElement; back: OffscreenCanvas | HTMLCanvasElement; mid: OffscreenCanvas | HTMLCanvasElement }
const layerCache = new Map<string, Cached>();
const MAX_CACHE = 10;
const PAD = 0.35;

function makeCanvas(w: number, h: number): { c: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    return { c, ctx: c.getContext('2d') as OffscreenCanvasRenderingContext2D };
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d') as CanvasRenderingContext2D };
}

export function clearSceneCache() {
  layerCache.clear();
}

function staticLayers(e: EnvCtx, W: number, H: number): Cached {
  const key = [e.spec.environment.type, e.spec.environment.time, e.spec.environment.weather, e.bible?.style ?? '', e.bible?.palette.sky ?? '', e.bible?.palette.primary ?? '', W, H].join('|');
  const hit = layerCache.get(key);
  if (hit) return hit;

  const cw = Math.round(W * (1 + PAD * 2));
  const ch = Math.round(H * (1 + PAD * 2));
  const far = makeCanvas(cw, ch);
  const back = makeCanvas(cw, ch);
  const mid = makeCanvas(cw, ch);
  for (const l of [far, back, mid]) l.ctx.translate(W * PAD, H * PAD);
  try {
    drawFar(far.ctx, e);
    drawBack(back.ctx, e);
    drawMid(mid.ctx, e);
  } catch {
    /* a broken environment still yields usable (empty) layers */
  }

  const entry: Cached = { far: far.c, back: back.c, mid: mid.c };
  if (layerCache.size >= MAX_CACHE) layerCache.delete(layerCache.keys().next().value as string);
  layerCache.set(key, entry);
  return entry;
}

// ---------------------------------------------------------------- lighting

interface Emitter { x: number; y: number; r: number; color: string; strength: number }

function applyLighting(ctx: Ctx, spec: SceneSpec, W: number, H: number, t: number, emitters: Emitter[], quality: Quality) {
  const L = LIGHT_SPECS[spec.lighting.style];
  const inten = spec.lighting.intensity;
  const o = lightOrigin(spec.lighting.direction, W, H);
  const fl = L.flicker > 0 ? 1 - L.flicker * (0.5 + 0.5 * Math.sin(t * 23) * Math.sin(t * 7.1)) : 1;

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = alpha(L.ambient, L.ambientAlpha * (1.25 - inten * 0.5));
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, Math.max(W, H) * (L.beam ? 0.85 : 1.15));
  g.addColorStop(0, alpha(L.key, L.keyAlpha * inten * fl));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // emissive props (screens, lamps, headlights) bleed light into the scene
  if (quality !== 'low') {
    for (const em of emitters.slice(0, 8)) {
      const eg = ctx.createRadialGradient(em.x, em.y, 0, em.x, em.y, em.r);
      eg.addColorStop(0, alpha(em.color, Math.min(0.5, em.strength * 0.45)));
      eg.addColorStop(1, alpha(em.color, 0));
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(em.x, em.y, em.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  if (L.beam) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bg = ctx.createLinearGradient(o.x, o.y, W * 0.4, H);
    bg.addColorStop(0, alpha(L.key, 0.22 * inten * fl));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(o.x - W * 0.55, H * 1.1);
    ctx.lineTo(o.x + W * 0.3, H * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${L.vignette})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- public API

export interface RenderOpts {
  spec: SceneSpec;
  bible: StyleBible | null;
  t: number;
  progress: number;
  W: number;
  H: number;
  quality: Quality;
  projectSeed: number;
  /** Feature switches from Advanced settings. */
  opts?: { animation?: boolean; effects?: boolean; lighting?: boolean; parallax?: boolean; cameraMotion?: boolean; sceneDetail?: number };
}

export function renderScene(ctx: Ctx, o: RenderOpts) {
  const { spec, bible, W, H, quality } = o;
  const feat = { animation: true, effects: true, lighting: true, parallax: true, cameraMotion: true, sceneDetail: 1, ...(o.opts ?? {}) };
  const t = feat.animation ? o.t : 0;
  const baseStyle = STYLE_SPECS[bible?.style ?? 'cinematic_2d'];
  const style = { ...baseStyle, detail: baseStyle.detail * feat.sceneDetail };
  const L = LIGHT_SPECS[spec.lighting.style];
  const seed = (hash(`s${spec.scene}`) ^ o.projectSeed) >>> 0;
  const cam = feat.cameraMotion ? computeCamera(spec, o.progress, t, seed) : { zoom: SHOT_BASE[spec.camera.shot].zoom, x: 0, y: SHOT_BASE[spec.camera.shot].y, rot: 0 };
  const horizon = H * (isIndoor(spec.environment.type) ? 0.72 : 0.68);
  const emitters: Emitter[] = [];
  const envCtx: EnvCtx = { w: W, h: H, horizon, spec, style, bible, seed: envSeed(spec, o.projectSeed) };
  const pal = bible?.palette ?? { primary: '#4c6ef5', secondary: '#15aabf', accent: '#f59f00', shadow: '#0b0d12', sky: '#1c2333' };
  const propCtx: PropCtx = { style, palette: pal, night: spec.environment.time === 'night', t, seed, emitters };

  ctx.save();
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, W, H);

  try {
    const layers = staticLayers(envCtx, W, H);
    const px = feat.parallax ? 1 : 0;

    // ---- FAR BACKGROUND (0.22) ----
    ctx.save();
    applyCamera(ctx, cam, feat.parallax ? 0.22 : 1, W, H);
    ctx.drawImage(layers.far as CanvasImageSource, -W * PAD, -H * PAD);
    ctx.restore();

    // ---- BACKGROUND (0.5) ----
    ctx.save();
    applyCamera(ctx, cam, feat.parallax ? 0.5 : 1, W, H);
    ctx.drawImage(layers.back as CanvasImageSource, -W * PAD, -H * PAD);
    ctx.restore();

    // ---- MIDGROUND (0.78) ----
    ctx.save();
    applyCamera(ctx, cam, feat.parallax ? 0.78 : 1, W, H);
    ctx.drawImage(layers.mid as CanvasImageSource, -W * PAD, -H * PAD);
    ctx.restore();

    // ---- OBJECTS (0.95) — animated, drawn live so states can change ----
    ctx.save();
    applyCamera(ctx, cam, feat.parallax ? 0.95 : 1, W, H);
    const held: ObjectInScene[] = [];
    const sorted = [...spec.objects].sort((a, b) => Number(BIG_PROPS.includes(b.type)) - Number(BIG_PROPS.includes(a.type)));
    for (const ob of sorted) {
      if (ob.position === 'character_hand') {
        held.push(ob);
        continue;
      }
      const wall = WALL_PROPS.includes(ob.type);
      const x = objectX(ob.position, W);
      const depthScale = ob.position === 'foreground' ? 1.7 : ob.position === 'background' ? 0.6 : 1;
      const baseY =
        ob.position === 'foreground' ? H * 1.0
        : ob.position === 'background' ? horizon - H * 0.05
        : wall ? horizon - H * (ob.type === 'window' ? 0.36 : ob.type === 'clock' ? 0.3 : 0.26)
        : horizon;
      const size = W * 0.15 * ob.scale * depthScale;
      try {
        drawProp(ctx, ob.type, x, baseY, size, ob.state, propCtx);
      } catch {
        /* one bad prop must never kill the frame */
      }
    }
    ctx.restore();

    // ---- CHARACTERS (1.0) ----
    ctx.save();
    applyCamera(ctx, cam, 1, W, H);
    const chars = spec.characters.slice(0, 3);
    const ordered = [...chars].sort((a, b) => Math.abs(0.5 - (POS_X[a.position] ?? 0.5)) - Math.abs(0.5 - (POS_X[b.position] ?? 0.5)));
    for (let i = ordered.length - 1; i >= 0; i--) {
      const c = ordered[i];
      const def = bible?.characters.find((d) => d.id === c.id) ?? defaultCharacter(c.id, i);
      const baseH = H * 0.46 * c.scale;
      try {
        const res = drawCharacter(ctx, {
          def,
          inScene: c,
          t,
          duration: spec.duration,
          x: W * (POS_X[c.position] ?? 0.5),
          groundY: horizon + H * 0.02 * (1 - c.scale),
          height: baseH,
          style,
          shadowAlpha: L.shadowAlpha * 0.5,
          rim: feat.lighting ? L.rim : null,
          rimAlpha: L.rimAlpha,
          seed: seed + i * 977,
          quality,
        });
        if (i === 0) {
          for (const hob of held) {
            try {
              drawProp(ctx, hob.type, res.handR.x, res.handR.y + baseH * 0.02, baseH * 0.16 * hob.scale, hob.state, propCtx);
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* a bad character never kills the frame */
      }
    }
    ctx.restore();

    // ---- FOREGROUND (1.4) ----
    ctx.save();
    applyCamera(ctx, cam, feat.parallax ? 1.4 : 1, W, H);
    drawForeground(ctx, envCtx);
    ctx.restore();
    void px;
  } catch {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#141b2d');
    g.addColorStop(1, '#05070c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- LIGHTING ----
  if (feat.lighting) applyLighting(ctx, spec, W, H, t, emitters, quality);

  // ---- ATMOSPHERE / PARTICLES ----
  if (feat.effects) {
    const budget = quality === 'low' ? 2 : quality === 'medium' ? 3 : 5;
    for (const fx of spec.effects.slice(0, budget)) {
      try {
        drawEffect(ctx, fx, { w: W, h: H, t, seed, quality, intensity: spec.lighting.intensity });
      } catch {
        /* ignore a single failing effect */
      }
    }
  }

  // ---- CAMERA FX / STYLE FINISH ----
  if (style.bloom > 0 && quality !== 'low') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = style.bloom * 0.25;
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, W * 0.7);
    bg.addColorStop(0, alpha(pal.primary, 0.5));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (style.hatch && quality !== 'low') {
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    const r = rng(seed);
    for (let i = 0; i < 80; i++) {
      const x = r() * W, y = r() * H, len = 20 + r() * 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len * 0.7, y + len * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (style.monochrome > 0.5) {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(128,128,128,${style.monochrome})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  drawGrain(ctx, W, H, style.grain, t, quality);
  ctx.restore();
}
