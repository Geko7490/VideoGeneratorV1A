import type { MusicSettings, SfxAsset } from '../types';
import { decodeAudioBlob } from '../utils/fileUtils';
import type { Timeline } from './compositor';

export const MIX_SAMPLE_RATE = 48000;

export interface MixInputs {
  timeline: Timeline;
  narration: Map<number, Blob>; // sceneId -> wav
  music: { settings: MusicSettings; blob: Blob | null };
  sfx: { asset: SfxAsset; blob: Blob }[];
  /** Render only this absolute window (for chunked rendering). */
  window: { start: number; end: number };
}

/**
 * Mixes narration + music + SFX for a time window into a stereo AudioBuffer using OfflineAudioContext.
 * Voice ducking: music gain is automated down while any narration is playing.
 */
export async function mixAudio(inp: MixInputs): Promise<AudioBuffer> {
  const { start, end } = inp.window;
  const length = Math.max(1, Math.ceil((end - start) * MIX_SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, MIX_SAMPLE_RATE);
  const master = ctx.createGain();
  master.connect(ctx.destination);

  // ---- narration ----
  const voiceIntervals: { s: number; e: number }[] = [];
  for (const ts of inp.timeline.scenes) {
    const blob = inp.narration.get(ts.scene.sceneId);
    if (!blob) continue;
    if (ts.end < start || ts.start > end) continue;
    const buf = await decodeAudioBlob(blob, MIX_SAMPLE_RATE);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    const at = ts.start - start;
    if (at >= 0) src.start(at);
    else src.start(0, Math.min(buf.duration, -at));
    voiceIntervals.push({ s: ts.start, e: ts.start + buf.duration });
  }

  // ---- music ----
  const m = inp.music.settings;
  if (m.enabled && inp.music.blob) {
    const buf = await decodeAudioBlob(inp.music.blob, MIX_SAMPLE_RATE);
    const trimStart = Math.max(0, m.trimStart);
    const trimEnd = m.trimEnd && m.trimEnd > trimStart ? Math.min(buf.duration, m.trimEnd) : buf.duration;
    const segLen = trimEnd - trimStart;
    const gain = ctx.createGain();
    gain.connect(master);
    const total = inp.timeline.totalDuration;
    // schedule (looping) music covering the whole video, then we offset into the window
    const placements: { videoTime: number; offset: number; dur: number }[] = [];
    let vt = 0;
    do {
      const dur = Math.min(segLen, total - vt);
      placements.push({ videoTime: vt, offset: trimStart, dur });
      vt += segLen;
    } while (m.loop && vt < total && segLen > 0.5);
    for (const p of placements) {
      const pEnd = p.videoTime + p.dur;
      if (pEnd < start || p.videoTime > end) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      const at = p.videoTime - start;
      if (at >= 0) src.start(at, p.offset, p.dur);
      else src.start(0, p.offset - at, p.dur + at);
    }
    // gain automation: base volume, fades, ducking
    const base = m.volume;
    const duck = m.ducking ? base * m.duckLevel : base;
    const env: { t: number; v: number }[] = [];
    const fadeIn = Math.max(0, m.fadeIn);
    const fadeOut = Math.max(0, m.fadeOut);
    const volAt = (t: number) => {
      let v = base;
      if (fadeIn > 0 && t < fadeIn) v = base * (t / fadeIn);
      if (fadeOut > 0 && t > total - fadeOut) v = Math.min(v, base * Math.max(0, (total - t) / fadeOut));
      if (m.ducking && voiceIntervals.some((iv) => t >= iv.s - 0.15 && t <= iv.e + 0.25)) v = Math.min(v, duck);
      return Math.max(0, v);
    };
    const step = 0.05;
    for (let t = start; t <= end + step; t += step) env.push({ t: t - start, v: volAt(t) });
    gain.gain.setValueAtTime(env[0].v, 0);
    for (const e of env) gain.gain.linearRampToValueAtTime(e.v, Math.min(e.t, (length - 1) / MIX_SAMPLE_RATE));
  }

  // ---- sfx ----
  for (const { asset, blob } of inp.sfx) {
    const buf = await decodeAudioBlob(blob, MIX_SAMPLE_RATE);
    const ts = asset.trimStart ?? 0;
    const te = asset.trimEnd && asset.trimEnd > ts ? Math.min(buf.duration, asset.trimEnd) : buf.duration;
    const dur = te - ts;
    const at0 = asset.startTime;
    if (at0 + dur < start || at0 > end) continue;
    const g = ctx.createGain();
    g.connect(master);
    const at = at0 - start;
    const f = Math.max(0, asset.fade);
    const t0 = Math.max(0, at);
    g.gain.setValueAtTime(f > 0 ? 0 : asset.volume, t0);
    if (f > 0) g.gain.linearRampToValueAtTime(asset.volume, t0 + f);
    const endT = at + dur;
    if (f > 0 && endT - f > t0) {
      g.gain.setValueAtTime(asset.volume, Math.max(t0, endT - f));
      g.gain.linearRampToValueAtTime(0, endT);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    if (at >= 0) src.start(at, ts, dur);
    else src.start(0, ts - at, dur + at);
  }

  // soft limiter
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master.disconnect();
  master.connect(comp);
  comp.connect(ctx.destination);

  return ctx.startRendering();
}
