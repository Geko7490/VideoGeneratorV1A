import type { ChunkRecord, Project } from '../types';
import { RESOLUTIONS, RENDER_SCALE, QUALITY_DETAIL, resolveQuality } from '../types';
import { detectHardwareSync } from '../utils/hardware';
import { deviceProfile, yieldToBrowser } from '../utils/deviceProfile';
import { blobStore, chunkStore } from '../storage/projectStore';
import { mixAudio } from './audioMixer';
import { buildTimeline, Compositor, type Timeline } from './compositor';
import { encodeChunk, muxChunks, pickEncoder } from './encoder';

export interface RenderCallbacks {
  onPlan?: (chunks: ChunkRecord[]) => void;
  onChunkStart: (index: number, total: number, rec: ChunkRecord) => void;
  onChunkProgress: (index: number, p: number) => void;
  onChunkDone: (rec: ChunkRecord) => void;
  onStatus: (s: string) => void;
  shouldCancel: () => boolean;
}

export async function loadNarration(project: Project): Promise<Map<number, Blob>> {
  const map = new Map<number, Blob>();
  for (const s of project.script?.scenes ?? []) {
    const blob = await blobStore.get(blobStore.key(project.id, 'tts', `scene_${String(s.sceneId).padStart(3, '0')}.wav`));
    if (blob) map.set(s.sceneId, blob);
  }
  return map;
}

/**
 * Chunk boundaries are snapped to the PROJECT-WIDE frame grid.
 * Every chunk owns an exact, non-overlapping range of frame indices, so frame timestamps are
 * reproducible integers and the boundary between two chunks can never go backwards.
 */
export function planChunks(totalDuration: number, chunkSeconds: number, fps = 30): ChunkRecord[] {
  const totalFrames = Math.max(1, Math.round(totalDuration * fps));
  const perChunk = Math.max(1, Math.round(chunkSeconds * fps));
  const n = Math.max(1, Math.ceil(totalFrames / perChunk));
  const out: ChunkRecord[] = [];
  for (let i = 0; i < n; i++) {
    const startFrame = i * perChunk;
    const endFrame = Math.min(totalFrames, startFrame + perChunk);
    out.push({ index: i, startTime: startFrame / fps, endTime: endFrame / fps, status: 'pending', frameCount: endFrame - startFrame });
  }
  return out;
}

/**
 * Chunked, resumable, frame-by-frame rendering.
 * Frames come from the Procedural 2D Scene Engine via the compositor — never from a screen recording.
 * LOW/MEDIUM quality render at a reduced internal resolution and are upscaled into the encoder canvas,
 * which is what makes long videos practical on phones.
 */
export async function renderProject(project: Project, timeline: Timeline, narration: Map<number, Blob>, cb: RenderCallbacks) {
  const { width, height } = RESOLUTIONS[project.settings.aspectRatio];
  const fps = project.settings.fps;
  const q = resolveQuality(project.settings.quality, detectHardwareSync());
  const profile = deviceProfile();
  const scale = RENDER_SCALE[q] ?? 1;
  const rw = Math.round((width * scale) / 2) * 2;
  const rh = Math.round((height * scale) / 2) * 2;

  const choice = await pickEncoder(width, height, fps);
  cb.onStatus(`Encoder: ${choice.container.toUpperCase()} · ${choice.videoCodec} + ${choice.audioCodec} · internal ${rw}×${rh} → ${width}×${height}`);

  let chunks = project.chunks.length ? project.chunks : planChunks(timeline.totalDuration, project.settings.chunkSeconds, fps);
  const planned = planChunks(timeline.totalDuration, project.settings.chunkSeconds, fps);
  const sameGrid =
    chunks.length === planned.length && chunks.every((c, i) => Math.abs(c.startTime - planned[i].startTime) < 1e-6 && Math.abs(c.endTime - planned[i].endTime) < 1e-6);
  if (!sameGrid) {
    // a different frame grid would break timestamp continuity — start the chunk set over
    await chunkStore.clear(project.id);
    chunks = planned;
  }
  const doneIdx = new Set(await chunkStore.listIndexes(project.id));
  for (const c of chunks) if (c.status === 'done' && !doneIdx.has(c.index)) c.status = 'pending';
  cb.onPlan?.(chunks.map((c) => ({ ...c })));
  const resumed = chunks.filter((c) => c.status === 'done').length;
  if (resumed) cb.onStatus(`Resuming: ${resumed}/${chunks.length} chunk(s) already rendered.`);

  // scene canvas (internal resolution) → output canvas (export resolution)
  const sceneCanvas = document.createElement('canvas');
  sceneCanvas.width = rw;
  sceneCanvas.height = rh;
  const sctx = sceneCanvas.getContext('2d', { alpha: false })!;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const octx = outCanvas.getContext('2d', { alpha: false })!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  const compositor = new Compositor({
    width: rw,
    height: rh,
    aspect: project.settings.aspectRatio,
    captionsEnabled: project.settings.captionsEnabled,
    captionStyle: project.settings.captionStyle,
    quality: q,
    styleBible: project.styleBible,
    masterSeed: project.settings.masterSeed,
    engine: {
      animation: project.settings.animationEnabled !== false,
      effects: project.settings.effectsEnabled !== false,
      lighting: project.settings.lightingEnabled !== false,
      parallax: project.settings.parallaxEnabled !== false,
      cameraMotion: project.settings.cameraMotionEnabled !== false,
      sceneDetail: (project.settings.sceneDetail ?? 1) * QUALITY_DETAIL[q],
    },
  });

  const musicBlob = project.settings.music.enabled && project.settings.music.fileName ? (await blobStore.get(blobStore.key(project.id, 'music', project.settings.music.fileName))) ?? null : null;
  const sfx: { asset: (typeof project.settings.sfx)[number]; blob: Blob }[] = [];
  for (const a of project.settings.sfx) {
    const b = await blobStore.get(blobStore.key(project.id, 'sfx', a.fileName));
    if (b) sfx.push({ asset: a, blob: b });
  }

  // ONE chunk at a time: render → encode → persist → free, so only a single chunk's frames and
  // audio ever live in memory. Critical on Android where several big buffers kill the tab.
  const mixSampleRate = 48000;
  for (const rec of chunks) {
    if (cb.shouldCancel()) throw new Error('Render cancelled');
    if (rec.status === 'done' && doneIdx.has(rec.index)) {
      cb.onChunkDone(rec);
      continue;
    }
    const startFrame = Math.round(rec.startTime * fps);
    const frameCount = Math.max(1, Math.round(rec.endTime * fps) - startFrame);
    const audioStartSample = Math.round(rec.startTime * mixSampleRate);

    rec.status = 'rendering';
    cb.onChunkStart(rec.index, chunks.length, rec);
    cb.onStatus(`Mixing audio for chunk ${rec.index + 1}/${chunks.length}`);
    let audio: AudioBuffer | null = await mixAudio({
      timeline,
      narration,
      music: { settings: project.settings.music, blob: musicBlob },
      sfx,
      window: { start: rec.startTime, end: rec.endTime },
    });
    cb.onStatus(`Drawing frames ${rec.index + 1}/${chunks.length} (${frameCount} frames)`);
    try {
      const stored = await encodeChunk({
        choice,
        width,
        height,
        fps,
        startTime: rec.startTime,
        endTime: rec.endTime,
        startFrame,
        frameCount,
        audioStartSample,
        queueLimit: profile.encoderQueueLimit,
        projectId: project.id,
        chunkIndex: rec.index,
        canvas: outCanvas,
        audio,
        drawFrame: (t) => {
          compositor.render(sctx, timeline, t);
          octx.drawImage(sceneCanvas, 0, 0, width, height);
        },
        onProgress: (p) => cb.onChunkProgress(rec.index, p),
        shouldCancel: cb.shouldCancel,
      });
      await chunkStore.put(stored);
      rec.status = 'done';
      rec.frameCount = stored.video.length;
      rec.codec = choice.videoCodec;
      cb.onChunkDone(rec);
      // drop the encoded packets we just persisted — they are safely in IndexedDB
      stored.video.length = 0;
      stored.audio.length = 0;
    } catch (e) {
      rec.status = 'failed';
      throw e;
    } finally {
      audio = null; // release the mixed AudioBuffer before the next chunk
      compositor.releaseBuffers();
      await yieldToBrowser(profile.aggressiveCleanup ? 60 : 0);
    }
  }

  cb.onStatus('Muxing chunks into the final file…');
  const all = [];
  for (const rec of chunks) {
    const c = await chunkStore.get(project.id, rec.index);
    if (!c) throw new Error(`Chunk ${rec.index} missing from storage.`);
    all.push(c);
  }
  const out = await muxChunks(all, fps);
  // free references to the loaded chunk packets as soon as the file exists
  all.length = 0;
  compositor.releaseBuffers();
  sceneCanvas.width = sceneCanvas.height = 1;
  outCanvas.width = outCanvas.height = 1;
  await yieldToBrowser(0);
  return { ...out, chunks };
}

export { buildTimeline };
