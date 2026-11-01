import type { AspectRatio, CaptionMode, CaptionStyle, WordTiming } from '../types';

export interface CaptionCue {
  start: number; // seconds, scene-relative
  end: number;
  words: WordTiming[]; // words in this cue
}

/** Builds caption cues from the measured word timings according to the caption mode. */
export function buildCues(words: WordTiming[], mode: CaptionMode): CaptionCue[] {
  if (!words.length) return [];
  if (mode === 'word') return words.map((w) => ({ start: w.start, end: w.end, words: [w] }));
  const maxWords = mode === 'phrase' ? 4 : 9;
  const cues: CaptionCue[] = [];
  let cur: WordTiming[] = [];
  for (const w of words) {
    cur.push(w);
    const punct = /[.!?,;:]$/.test(w.word);
    if (cur.length >= maxWords || (punct && cur.length >= 2)) {
      cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
      cur = [];
    }
  }
  if (cur.length) cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
  return cues;
}

interface StyleSpec {
  font: (h: number) => string;
  fill: string;
  stroke: string | null;
  strokeW: number;
  box: string | null;
  highlight: string | null;
  upper: boolean;
  shadow: boolean;
  yPos: (aspect: AspectRatio) => number; // fraction of height for baseline centre
}

const STYLES: Record<CaptionStyle, StyleSpec> = {
  clean: { font: (h) => `600 ${h}px Inter, system-ui, sans-serif`, fill: '#fff', stroke: null, strokeW: 0, box: 'rgba(0,0,0,0.45)', highlight: null, upper: false, shadow: true, yPos: (a) => (a === '9:16' ? 0.74 : 0.86) },
  bold: { font: (h) => `900 ${h * 1.15}px Inter, Arial Black, system-ui, sans-serif`, fill: '#fff', stroke: '#000', strokeW: 0.16, box: null, highlight: '#ffd400', upper: true, shadow: true, yPos: (a) => (a === '9:16' ? 0.68 : 0.84) },
  shorts: { font: (h) => `800 ${h * 1.2}px Inter, system-ui, sans-serif`, fill: '#fff', stroke: '#000', strokeW: 0.14, box: null, highlight: '#29ff9b', upper: true, shadow: true, yPos: (a) => (a === '9:16' ? 0.5 : 0.82) },
  tiktok: { font: (h) => `800 ${h * 1.1}px Inter, system-ui, sans-serif`, fill: '#fff', stroke: null, strokeW: 0, box: 'rgba(0,0,0,0.75)', highlight: '#fe2c55', upper: false, shadow: false, yPos: (a) => (a === '9:16' ? 0.62 : 0.84) },
  minimal: { font: (h) => `400 ${h * 0.9}px Inter, system-ui, sans-serif`, fill: 'rgba(255,255,255,0.92)', stroke: null, strokeW: 0, box: null, highlight: null, upper: false, shadow: true, yPos: (a) => (a === '9:16' ? 0.8 : 0.9) },
  cinematic: { font: (h) => `400 ${h * 0.85}px Georgia, 'Times New Roman', serif`, fill: '#f3ead7', stroke: null, strokeW: 0, box: null, highlight: null, upper: false, shadow: true, yPos: (a) => (a === '9:16' ? 0.82 : 0.9) },
};

function layoutLines(ctx: CanvasRenderingContext2D, words: string[], maxW: number): string[][] {
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    const test = [...cur, w].join(' ');
    if (ctx.measureText(test).width > maxW && cur.length) {
      lines.push(cur);
      cur = [w];
    } else cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * Draws the caption for scene-relative time t. Layout adapts to the aspect ratio (safe areas, font size, position).
 */
export function drawCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, aspect: AspectRatio, style: CaptionStyle, cues: CaptionCue[], t: number) {
  const cue = cues.find((c) => t >= c.start && t < c.end + 0.08);
  if (!cue) return;
  const spec = STYLES[style];
  const minSide = Math.min(W, H);
  const fontH = Math.round(minSide * (aspect === '9:16' ? 0.052 : 0.046));
  ctx.save();
  ctx.font = spec.font(fontH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = cue.words.map((w) => (spec.upper ? w.word.toUpperCase() : w.word));
  const maxW = W * (aspect === '9:16' ? 0.86 : 0.78);
  const lines = layoutLines(ctx, words, maxW);
  const lineH = fontH * 1.35;
  const totalH = lines.length * lineH;
  const cy = H * spec.yPos(aspect);
  let wi = 0;
  lines.forEach((line, li) => {
    const y = cy - totalH / 2 + lineH * (li + 0.5);
    const text = line.join(' ');
    const tw = ctx.measureText(text).width;
    if (spec.box) {
      ctx.fillStyle = spec.box;
      const pad = fontH * 0.45;
      roundRect(ctx, W / 2 - tw / 2 - pad, y - lineH / 2, tw + pad * 2, lineH, fontH * 0.25);
      ctx.fill();
    }
    // draw word by word to allow highlight of the active word
    let x = W / 2 - tw / 2;
    const space = ctx.measureText(' ').width;
    for (const w of line) {
      const ww = ctx.measureText(w).width;
      const timing = cue.words[wi++];
      const active = timing && t >= timing.start && t < timing.end;
      ctx.textAlign = 'left';
      if (spec.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = fontH * 0.25;
        ctx.shadowOffsetY = fontH * 0.06;
      }
      if (spec.stroke) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = fontH * spec.strokeW;
        ctx.strokeStyle = spec.stroke;
        ctx.strokeText(w, x, y);
      }
      ctx.fillStyle = active && spec.highlight ? spec.highlight : spec.fill;
      if (active && spec.highlight && style === 'shorts') {
        ctx.save();
        ctx.translate(x + ww / 2, y);
        ctx.scale(1.08, 1.08);
        ctx.fillText(w, -ww / 2, 0);
        ctx.restore();
      } else ctx.fillText(w, x, y);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      x += ww + space;
    }
  });
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
