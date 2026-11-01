import type { AspectRatio, CaptionMode, CaptionStyle, ResolvedQuality, Scene, StyleBible } from '../types';
import { buildCues, drawCaptions, type CaptionCue } from './captionEngine';
import { renderScene } from '../scene/renderer';
import type { Quality } from '../scene/effects';

/**
 * COMPOSITOR — turns the scene plan + measured audio into finished frames.
 * Scene visuals come from the Procedural 2D Scene Engine (no images, no AI image model).
 * Transitions blend two procedurally rendered scenes through an offscreen buffer.
 */

export interface TimedScene {
  scene: Scene;
  start: number;
  end: number;
  duration: number;
  cues: CaptionCue[];
}

export interface Timeline {
  scenes: TimedScene[];
  totalDuration: number;
}

export const SCENE_PADDING = 0.35;
export const TRANSITION_DURATION = 0.6;

/** Timeline built from ACTUAL measured TTS durations (estimates only when audio is missing). */
export function buildTimeline(scenes: Scene[], captionMode: CaptionMode): Timeline {
  let t = 0;
  const out: TimedScene[] = [];
  for (const s of scenes) {
    if (s.ttsStatus === 'skipped') continue;
    const dur = Math.max(1.5, (s.actualDuration ?? s.durationEstimate) + SCENE_PADDING);
    out.push({ scene: s, start: t, end: t + dur, duration: dur, cues: buildCues(s.wordTimings, captionMode) });
    t += dur;
  }
  return { scenes: out, totalDuration: t };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

function transitionAt(kind: string, local: number): { mix: number; blur: number; black: number } {
  if (kind === 'cut') return { mix: 1, blur: 0, black: 0 };
  const p = Math.min(1, Math.max(0, local / TRANSITION_DURATION));
  const e = ease(p);
  switch (kind) {
    case 'blur': return { mix: e, blur: Math.sin(p * Math.PI) * 16, black: 0 };
    case 'fade_black': return { mix: p < 0.5 ? 0 : 1, blur: 0, black: 1 - Math.abs(p - 0.5) * 2 };
    case 'fade': return { mix: p, blur: 0, black: 0 };
    case 'crossfade':
    default: return { mix: e, blur: 0, black: 0 };
  }
}

export interface CompositorOptions {
  width: number;
  height: number;
  aspect: AspectRatio;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
  quality: ResolvedQuality;
  styleBible: StyleBible | null;
  masterSeed: number;
  /** Advanced scene-engine switches (animation / effects / lighting / parallax / camera / detail). */
  engine?: { animation?: boolean; effects?: boolean; lighting?: boolean; parallax?: boolean; cameraMotion?: boolean; sceneDetail?: number };
}

export class Compositor {
  private buf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private bctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  constructor(private opts: CompositorOptions) {}

  /** Drops the offscreen transition buffer so its GPU/CPU memory can be reclaimed between chunks. */
  releaseBuffers() {
    if (this.buf && 'width' in this.buf) {
      this.buf.width = 1;
      this.buf.height = 1;
    }
    this.buf = null;
    this.bctx = null;
  }

  private buffer() {
    if (!this.buf) {
      const { width: w, height: h } = this.opts;
      if (typeof OffscreenCanvas !== 'undefined') {
        this.buf = new OffscreenCanvas(w, h);
        this.bctx = this.buf.getContext('2d') as OffscreenCanvasRenderingContext2D;
      } else {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        this.buf = c;
        this.bctx = c.getContext('2d') as CanvasRenderingContext2D;
      }
    }
    return { canvas: this.buf!, ctx: this.bctx! };
  }

  private drawOne(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, ts: TimedScene, t: number) {
    const local = Math.max(0, t - ts.start);
    renderScene(ctx, {
      spec: ts.scene.spec,
      bible: this.opts.styleBible,
      t: local,
      progress: Math.min(1, local / Math.max(0.1, ts.duration)),
      W: this.opts.width,
      H: this.opts.height,
      quality: this.opts.quality as Quality,
      projectSeed: this.opts.masterSeed,
      opts: this.opts.engine,
    });
  }

  render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, timeline: Timeline, t: number) {
    const { width: W, height: H } = this.opts;
    ctx.save();
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const idx = timeline.scenes.findIndex((s) => t >= s.start && t < s.end);
    const cur = idx >= 0 ? timeline.scenes[idx] : timeline.scenes[timeline.scenes.length - 1];
    if (!cur) {
      ctx.restore();
      return;
    }
    const prev = idx > 0 ? timeline.scenes[idx - 1] : null;
    const local = t - cur.start;
    const tr = prev && local < TRANSITION_DURATION ? transitionAt(cur.scene.spec.transition, local) : { mix: 1, blur: 0, black: 0 };

    if (prev && tr.mix < 1) {
      // previous scene keeps animating into the overlap
      const { canvas, ctx: bctx } = this.buffer();
      this.drawOne(bctx, prev, Math.min(prev.end - 0.001, t));
      ctx.save();
      if (tr.blur > 0) ctx.filter = `blur(${tr.blur}px)`;
      ctx.drawImage(canvas as CanvasImageSource, 0, 0);
      ctx.restore();
    }

    if (tr.mix > 0) {
      if (tr.mix < 1 || tr.blur > 0) {
        const { canvas, ctx: bctx } = this.buffer();
        this.drawOne(bctx, cur, t);
        ctx.save();
        ctx.globalAlpha = tr.mix;
        if (tr.blur > 0) ctx.filter = `blur(${tr.blur}px)`;
        ctx.drawImage(canvas as CanvasImageSource, 0, 0);
        ctx.restore();
      } else {
        this.drawOne(ctx, cur, t);
      }
    }

    if (tr.black > 0) {
      ctx.fillStyle = `rgba(0,0,0,${tr.black})`;
      ctx.fillRect(0, 0, W, H);
    }

    // global fade in / out
    const fade = Math.min(Math.min(1, t / 0.8), Math.min(1, Math.max(0, (timeline.totalDuration - t) / 1.0)));
    if (fade < 1) {
      ctx.fillStyle = `rgba(0,0,0,${1 - fade})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (this.opts.captionsEnabled) {
      drawCaptions(ctx as CanvasRenderingContext2D, W, H, this.opts.aspect, this.opts.captionStyle, cur.cues, local);
    }
    ctx.restore();
  }
}
