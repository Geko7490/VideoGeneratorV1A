import type { StoredEncodedChunk } from '../storage/projectStore';

/**
 * Local encoder built on WebCodecs. Frames are produced by the compositor and pushed one-by-one into
 * VideoEncoder (hardware accelerated when available). No screen capture, no MediaRecorder.
 * Preferred: H.264 + AAC in MP4. Fallback: VP9/VP8 + Opus in WebM.
 */

export interface EncoderChoice {
  container: 'mp4' | 'webm';
  videoCodec: string; // WebCodecs codec string
  audioCodec: string;
  mime: string;
  ext: string;
}

export async function pickEncoder(width: number, height: number, fps: number): Promise<EncoderChoice> {
  if (!('VideoEncoder' in window)) throw new Error('WebCodecs (VideoEncoder) is not available in this browser. Use Chrome/Edge 94+ for local encoding.');
  const bitrate = Math.round(width * height * fps * 0.12);
  const tryV = async (codec: string) => {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps, ...(codec.startsWith('avc1') ? { avc: { format: 'avc' } } : {}) });
      return !!r.supported;
    } catch {
      return false;
    }
  };
  const tryA = async (codec: string) => {
    try {
      if (!('AudioEncoder' in window)) return false;
      const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000 });
      return !!r.supported;
    } catch {
      return false;
    }
  };
  const aac = await tryA('mp4a.40.2');
  for (const c of ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a', 'avc1.640028']) {
    if (aac && (await tryV(c))) return { container: 'mp4', videoCodec: c, audioCodec: 'mp4a.40.2', mime: 'video/mp4', ext: 'mp4' };
  }
  const opus = await tryA('opus');
  if (!opus) throw new Error('No supported audio encoder (AAC or Opus) found.');
  for (const c of ['vp09.00.40.08', 'vp09.00.31.08', 'vp8']) {
    if (await tryV(c)) return { container: 'webm', videoCodec: c, audioCodec: 'opus', mime: 'video/webm', ext: 'webm' };
  }
  throw new Error('No supported video encoder (H.264 / VP9 / VP8) found.');
}

function copyDesc(desc: AllowSharedBufferSource | undefined): ArrayBuffer | null {
  if (!desc) return null;
  const view = desc instanceof ArrayBuffer || desc instanceof SharedArrayBuffer ? new Uint8Array(desc as ArrayBuffer) : new Uint8Array((desc as ArrayBufferView).buffer as ArrayBuffer, (desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteLength);
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

export interface ChunkEncodeParams {
  choice: EncoderChoice;
  width: number;
  height: number;
  fps: number;
  startTime: number; // absolute seconds
  endTime: number;
  projectId: string;
  chunkIndex: number;
  /** Called for every frame index; must draw the frame for absolute time t into the given canvas. */
  drawFrame: (t: number) => void;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  audio: AudioBuffer; // already windowed to [startTime,endTime)
  onProgress?: (p: number) => void;
  shouldCancel?: () => boolean;
  /**
   * GLOBAL CLOCK (keeps PTS/DTS monotonic across chunk boundaries).
   * startFrame: index of this chunk's first frame on the project-wide frame grid.
   * frameCount: exact number of frames this chunk owns (no overlap with the next chunk).
   * audioStartSample: project-wide sample offset of this chunk's first audio sample.
   */
  startFrame: number;
  frameCount: number;
  audioStartSample: number;
  /** Max encoder queue depth (lower on mobile to bound memory). */
  queueLimit?: number;
}

export async function encodeChunk(p: ChunkEncodeParams): Promise<StoredEncodedChunk> {
  const { choice, width, height, fps } = p;
  const video: StoredEncodedChunk['video'] = [];
  const audio: StoredEncodedChunk['audio'] = [];
  let videoDescription: ArrayBuffer | null = null;
  let audioDescription: ArrayBuffer | null = null;
  let vErr: Error | null = null;
  let aErr: Error | null = null;

  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      video.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? Math.round(1e6 / fps), type: chunk.type });
      if (!videoDescription) videoDescription = copyDesc(meta?.decoderConfig?.description);
    },
    error: (e) => {
      vErr = e as Error;
    },
  });
  const bitrate = Math.round(width * height * fps * 0.12);
  const vcfg: VideoEncoderConfig = {
    codec: choice.videoCodec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
    ...(choice.videoCodec.startsWith('avc1') ? { avc: { format: 'avc' as const } } : {}),
  };
  try {
    venc.configure({ ...vcfg, hardwareAcceleration: 'prefer-hardware' });
  } catch {
    venc.configure(vcfg);
  }

  // ---- video: timestamps come from the PROJECT-WIDE frame grid, never from float seconds ----
  // ts(frame) = round(frame * 1e6 / fps) is exactly reproducible and strictly increasing, so a
  // chunk boundary can never emit a timestamp behind the previous chunk's last frame.
  const totalFrames = Math.max(1, p.frameCount);
  const tsOfFrame = (globalFrame: number) => Math.round((globalFrame * 1e6) / fps);
  const queueLimit = Math.max(2, p.queueLimit ?? 6);
  let lastVideoTs = -1;

  for (let i = 0; i < totalFrames; i++) {
    if (p.shouldCancel?.()) {
      venc.close();
      throw new Error('Render cancelled');
    }
    if (vErr) throw vErr;
    const globalFrame = p.startFrame + i;
    const t = globalFrame / fps;
    p.drawFrame(t);

    let ts = tsOfFrame(globalFrame);
    // validation guard: never hand the encoder a non-increasing timestamp
    if (ts <= lastVideoTs) ts = lastVideoTs + 1;
    lastVideoTs = ts;
    const duration = Math.max(1, tsOfFrame(globalFrame + 1) - ts);

    const frame = new VideoFrame(p.canvas as CanvasImageSource, { timestamp: ts, duration });
    try {
      venc.encode(frame, { keyFrame: i === 0 || i % (fps * 2) === 0 });
    } finally {
      frame.close(); // always release the GPU-backed frame
    }
    // backpressure: keep the encoder queue (and its memory) bounded
    while (venc.encodeQueueSize > queueLimit) await new Promise((r) => setTimeout(r, 4));
    if (i % 3 === 0) {
      p.onProgress?.((i / totalFrames) * 0.9);
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }
  }
  await venc.flush();
  venc.close();
  if (vErr) throw vErr;

  // ---- audio ----
  const aenc = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      audio.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0, type: chunk.type });
      if (!audioDescription) audioDescription = copyDesc(meta?.decoderConfig?.description);
    },
    error: (e) => {
      aErr = e as Error;
    },
  });
  const sr = p.audio.sampleRate;
  const ch = p.audio.numberOfChannels;
  aenc.configure({ codec: choice.audioCodec, sampleRate: sr, numberOfChannels: ch, bitrate: 160_000 });
  // ---- audio: timestamps come from the PROJECT-WIDE sample counter ----
  // AAC pads to whole 1024-sample frames, so a chunk's encoded audio can run slightly past its
  // nominal window. Deriving every timestamp from a global sample offset (instead of startTime)
  // means the next chunk continues where this one really ended — no backwards DTS.
  const CHUNK_SAMPLES = Math.min(sr, 48000); // ≤1s per AudioData keeps peak memory low
  for (let off = 0; off < p.audio.length; off += CHUNK_SAMPLES) {
    if (p.shouldCancel?.()) {
      aenc.close();
      throw new Error('Render cancelled');
    }
    const n = Math.min(CHUNK_SAMPLES, p.audio.length - off);
    const planar = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) planar.set(p.audio.getChannelData(c).subarray(off, off + n), c * n);
    const globalSample = p.audioStartSample + off;
    const ad = new AudioData({
      format: 'f32-planar',
      sampleRate: sr,
      numberOfFrames: n,
      numberOfChannels: ch,
      timestamp: Math.round((globalSample * 1e6) / sr),
      data: planar,
    });
    try {
      aenc.encode(ad);
    } finally {
      ad.close();
    }
    if (aErr) throw aErr;
    if (off % (CHUNK_SAMPLES * 4) === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await aenc.flush();
  aenc.close();
  if (aErr) throw aErr;
  p.onProgress?.(1);

  return {
    key: `${p.projectId}/${p.chunkIndex}`,
    projectId: p.projectId,
    chunkIndex: p.chunkIndex,
    video,
    audio,
    videoDescription,
    audioDescription,
    videoCodec: choice.videoCodec,
    audioCodec: choice.audioCodec,
    width,
    height,
    sampleRate: sr,
    channels: ch,
    startTime: p.startTime,
    endTime: p.endTime,
  };
}

/**
 * Final safety net before the muxer: timestamps on a track must be strictly increasing.
 * The encoder already uses a global clock, but AAC padding / resumed chunks rendered in an older
 * session could still overlap, so each track is rebased by a whole-chunk offset (spacing inside a
 * chunk is preserved — we never scramble individual packets to hide a problem).
 */
class MonotonicTrack {
  private lastEnd = -1;
  /** Returns the offset (µs) to add to every packet of this chunk. */
  offsetFor(firstTs: number): number {
    if (this.lastEnd < 0 || firstTs >= this.lastEnd) return 0;
    return this.lastEnd - firstTs;
  }
  commit(ts: number, duration: number) {
    this.lastEnd = Math.max(this.lastEnd, ts + Math.max(1, duration));
  }
  /** Guarantees a strictly increasing value even inside a chunk. */
  clampInside(ts: number): number {
    return this.lastEnd >= 0 && ts < this.lastEnd ? this.lastEnd : ts;
  }
}

/** Concatenates all stored chunks into one file (chunk 1 + chunk 2 + … → final video). */
export async function muxChunks(chunks: StoredEncodedChunk[], fps: number): Promise<{ blob: Blob; mime: string; ext: string }> {
  if (!chunks.length) throw new Error('No rendered chunks to mux.');
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  chunks = ordered;
  const first = chunks[0];
  const isMp4 = first.videoCodec.startsWith('avc1');
  if (isMp4) {
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: first.width, height: first.height, frameRate: fps },
      audio: { codec: 'aac', numberOfChannels: first.channels, sampleRate: first.sampleRate },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let vMetaSent = false;
    let aMetaSent = false;
    const vTrack = new MonotonicTrack();
    const aTrack = new MonotonicTrack();
    for (const c of chunks) {
      const vOff = c.video.length ? vTrack.offsetFor(c.video[0].timestamp) : 0;
      for (const v of c.video) {
        const meta = !vMetaSent && c.videoDescription ? { decoderConfig: { codec: c.videoCodec, description: c.videoDescription } } : undefined;
        if (meta) vMetaSent = true;
        const ts = vTrack.clampInside(v.timestamp + vOff);
        muxer.addVideoChunkRaw(new Uint8Array(v.data), v.type, ts, v.duration, meta);
        vTrack.commit(ts, v.duration);
      }
      const aOff = c.audio.length ? aTrack.offsetFor(c.audio[0].timestamp) : 0;
      for (const a of c.audio) {
        const meta = !aMetaSent && c.audioDescription ? { decoderConfig: { codec: c.audioCodec, description: c.audioDescription, sampleRate: c.sampleRate, numberOfChannels: c.channels } } : undefined;
        if (meta) aMetaSent = true;
        const ts = aTrack.clampInside(a.timestamp + aOff);
        muxer.addAudioChunkRaw(new Uint8Array(a.data), a.type, ts, a.duration, meta);
        aTrack.commit(ts, a.duration);
      }
    }
    muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4' };
  }
  const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
  const vcodec = first.videoCodec.startsWith('vp09') ? 'V_VP9' : 'V_VP8';
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: vcodec, width: first.width, height: first.height, frameRate: fps },
    audio: { codec: 'A_OPUS', numberOfChannels: first.channels, sampleRate: first.sampleRate },
    firstTimestampBehavior: 'offset',
  });
  let aMetaSent = false;
  const vTrack = new MonotonicTrack();
  const aTrack = new MonotonicTrack();
  for (const c of chunks) {
    const vOff = c.video.length ? vTrack.offsetFor(c.video[0].timestamp) : 0;
    for (const v of c.video) {
      const ts = vTrack.clampInside(v.timestamp + vOff);
      muxer.addVideoChunkRaw(new Uint8Array(v.data), v.type, ts);
      vTrack.commit(ts, v.duration);
    }
    const aOff = c.audio.length ? aTrack.offsetFor(c.audio[0].timestamp) : 0;
    for (const a of c.audio) {
      const meta = !aMetaSent && c.audioDescription ? { decoderConfig: { codec: c.audioCodec, description: c.audioDescription, sampleRate: c.sampleRate, numberOfChannels: c.channels } } : undefined;
      if (meta) aMetaSent = true;
      const ts = aTrack.clampInside(a.timestamp + aOff);
      muxer.addAudioChunkRaw(new Uint8Array(a.data), a.type, ts, meta);
      aTrack.commit(ts, a.duration);
    }
  }
  muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/webm' }), mime: 'video/webm', ext: 'webm' };
}
