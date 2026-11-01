import type { GenerateSpeechOptions, Language, ModelInfo, SpeechResult, TTSAdapter, WordTiming } from '../../types';
import { float32ToWav } from '../../utils/fileUtils';
import { memoryManager } from '../../utils/memoryManager';
import { deviceProfile, enableLowMemoryTts, yieldToBrowser } from '../../utils/deviceProfile';

/**
 * MODE A — BROWSER LOCAL TTS: Kokoro-82M (ONNX) via kokoro-js.
 *
 * Stability rules enforced here:
 *  · Only ONE synthesis runs at a time (serial mutex) — never Promise.all over scenes.
 *  · WebGPU buffer / OOM / init failures fall back to WASM (CPU) once, then surface a clear error.
 *  · Retries are strictly bounded, never infinite.
 *  · On mobile (or after a GPU failure) the session can be recycled between scenes to keep peak
 *    GPU memory low, instead of re-initialising the model for every scene by default.
 */

export const KOKORO_MODEL_ID = 'kokoro:onnx-community/Kokoro-82M-v1.0-ONNX';
const HF_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export type TtsBackend = 'webgpu' | 'wasm';

export const KOKORO_VOICES: { id: string; name: string; language: Language }[] = [
  { id: 'af_heart', name: 'Heart (female, US)', language: 'en' },
  { id: 'af_bella', name: 'Bella (female, US)', language: 'en' },
  { id: 'af_nicole', name: 'Nicole (female, US, soft)', language: 'en' },
  { id: 'af_sarah', name: 'Sarah (female, US)', language: 'en' },
  { id: 'am_adam', name: 'Adam (male, US)', language: 'en' },
  { id: 'am_michael', name: 'Michael (male, US)', language: 'en' },
  { id: 'am_fenrir', name: 'Fenrir (male, US, deep)', language: 'en' },
  { id: 'bf_emma', name: 'Emma (female, UK)', language: 'en' },
  { id: 'bm_george', name: 'George (male, UK)', language: 'en' },
  { id: 'bm_lewis', name: 'Lewis (male, UK)', language: 'en' },
];

export async function kokoroInstalled(): Promise<boolean> {
  try {
    if (!('caches' in window)) return false;
    const names = await caches.keys();
    for (const n of names) {
      const c = await caches.open(n);
      const keys = await c.keys();
      if (keys.some((k) => k.url.includes('Kokoro-82M') && k.url.endsWith('.onnx'))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function deleteKokoroCache() {
  const names = await caches.keys();
  for (const n of names) {
    const c = await caches.open(n);
    for (const k of await c.keys()) if (k.url.includes('Kokoro-82M')) await c.delete(k);
  }
}

export async function kokoroModelInfo(webgpu: boolean): Promise<ModelInfo> {
  const gpu = webgpu && !deviceProfile().preferCpuTts;
  return {
    id: KOKORO_MODEL_ID,
    name: 'Kokoro-82M (ONNX, in-browser)',
    category: 'tts',
    backend: gpu ? 'webgpu' : 'wasm',
    sizeBytes: gpu ? 326 * 1024 * 1024 : 92 * 1024 * 1024,
    vramBytes: 400 * 1024 * 1024,
    installed: await kokoroInstalled(),
    loaded: kokoroAdapter.isLoaded(),
    downloadable: true,
    description: `Lightweight neural TTS running locally in the browser (${gpu ? 'WebGPU fp32' : 'WASM q8 / CPU'}). English voices.`,
    languages: ['en'],
    quant: gpu ? 'fp32' : 'q8',
    family: 'Kokoro',
  };
}

/** Distributes words across the measured duration proportionally to character length. */
export function estimateWordTimings(text: string, durationSec: number): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1.2 + (/[.,!?;:]$/.test(w) ? 1.5 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const usable = durationSec * 0.97;
  let t = 0;
  return words.map((w, i) => {
    const d = (weights[i] / total) * usable;
    const wt = { word: w, start: t, end: t + d };
    t += d;
    return wt;
  });
}

type KokoroTTSType = import('kokoro-js').KokoroTTS;
type KokoroLib = { KokoroTTS: typeof import('kokoro-js').KokoroTTS };

const KOKORO_LIB_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
let kokoroLibPromise: Promise<KokoroLib> | null = null;
export function loadKokoroLib(): Promise<KokoroLib> {
  if (!kokoroLibPromise) {
    kokoroLibPromise = import(/* @vite-ignore */ KOKORO_LIB_URL).catch((e) => {
      kokoroLibPromise = null;
      throw new Error('Could not load the Kokoro TTS library code (needs one-time network access to cache it): ' + (e as Error).message);
    }) as Promise<KokoroLib>;
  }
  return kokoroLibPromise;
}

/** Recognises transient GPU/WebGPU failures that justify a CPU fallback or a bounded retry. */
export function isGpuFailure(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return (
    m.includes('createbuffer') ||
    m.includes('gpubuffer') ||
    m.includes('mappedatcreation') ||
    m.includes('too large for the implementation') ||
    m.includes('webgpu') ||
    m.includes('gpudevice') ||
    m.includes('device lost') ||
    m.includes('out of memory') ||
    m.includes('oom') ||
    m.includes('allocation failed') ||
    m.includes('exceeds the limit') ||
    m.includes('adapter')
  );
}

export function isTransientFailure(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return isGpuFailure(e) || m.includes('429') || m.includes('timeout') || m.includes('timed out') || m.includes('network') || m.includes('fetch');
}

export interface TtsStatusEvent {
  level: 'info' | 'warn';
  message: string;
  backend: TtsBackend;
}

class KokoroAdapter implements TTSAdapter {
  id = 'kokoro';
  locality = 'LOCAL' as const;
  private tts: KokoroTTSType | null = null;
  private device: TtsBackend = 'wasm';
  /** Serial gate — guarantees one synthesis at a time across the whole app. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Set once WebGPU has proven unusable in this session; we stop trying it. */
  private gpuBlocked = false;
  private listeners = new Set<(e: TtsStatusEvent) => void>();

  onStatus(fn: (e: TtsStatusEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(level: 'info' | 'warn', message: string) {
    for (const l of this.listeners) l({ level, message, backend: this.device });
  }

  get backend(): TtsBackend {
    return this.device;
  }
  isLoaded() {
    return !!this.tts;
  }
  getCapabilities() {
    return { speed: true, pitch: false, previewVoice: true, languages: ['en' as const] };
  }

  async listVoices() {
    const runtime = this.tts as { voices?: Record<string, unknown> } | null;
    if (runtime?.voices && typeof runtime.voices === 'object') {
      const ids = Object.keys(runtime.voices);
      if (ids.length) return ids.map((id) => KOKORO_VOICES.find((v) => v.id === id) ?? { id, name: id, language: 'en' as const });
    }
    return KOKORO_VOICES;
  }

  /** Runs `fn` on the serial queue so two syntheses can never share the GPU. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    // keep the chain alive even when a task rejects
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async createSession(device: TtsBackend, onProgress?: (p: number, text: string) => void) {
    const { KokoroTTS } = await loadKokoroLib();
    return KokoroTTS.from_pretrained(HF_ID, {
      dtype: device === 'webgpu' ? 'fp32' : 'q8',
      device,
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') onProgress?.(p.progress / 100, `Downloading ${p.file ?? ''}`);
        else onProgress?.(0, p.status);
      },
    } as never);
  }

  async load(_modelId: string, onProgress?: (p: number, text: string) => void) {
    if (this.tts) return;
    return this.serial(async () => {
      if (this.tts) return;
      const prof = deviceProfile();
      const hasGpu = !!(navigator as Navigator & { gpu?: unknown }).gpu;
      const wantGpu = hasGpu && !prof.preferCpuTts && !this.gpuBlocked;
      await memoryManager.acquire('tts', KOKORO_MODEL_ID, 'Kokoro-82M', 400 * 1024 * 1024);
      memoryManager.setStatus('Loading Kokoro TTS');

      if (wantGpu) {
        try {
          this.device = 'webgpu';
          this.tts = await this.createSession('webgpu', onProgress);
          this.emit('info', 'TTS ready on WebGPU');
          return;
        } catch (e) {
          this.gpuBlocked = true;
          this.tts = null;
          enableLowMemoryTts();
          this.emit('warn', `GPU unavailable for TTS (${(e as Error).message.slice(0, 90)}) — switching to CPU fallback`);
          await yieldToBrowser(30);
        }
      }
      this.device = 'wasm';
      this.tts = await this.createSession('wasm', onProgress);
      this.emit('info', 'TTS ready on CPU (WASM)');
    });
  }

  /** Frees the session and lets the browser reclaim GPU/WASM memory. */
  async unload() {
    const sess = this.tts as unknown as { dispose?: () => void; session?: { release?: () => Promise<void> } } | null;
    this.tts = null;
    try {
      sess?.dispose?.();
      await sess?.session?.release?.();
    } catch {
      /* best effort */
    }
    await yieldToBrowser(0);
  }

  /** Drops and rebuilds the session — used between scenes in low-memory mode. */
  private async recycle(onProgress?: (p: number, text: string) => void) {
    await this.unload();
    await yieldToBrowser(16);
    this.tts = await this.createSession(this.device, onProgress);
  }

  private resolveVoice(o: GenerateSpeechOptions, available: { id: string; name: string; language: Language }[]) {
    const match = available.find((v) => v.id === o.voice);
    if (!match) throw new Error(`Selected voice "${o.voice}" is not available in this model. No silent substitution.`);
    if (match.language !== o.language) throw new Error(`Voice "${match.name}" does not support ${o.language.toUpperCase()}.`);
    return match;
  }

  private postProcess(samples: Float32Array, sr: number, volume: number, text: string): SpeechResult {
    let s = samples;
    if (volume !== 1) {
      s = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) s[i] = samples[i] * volume;
    }
    let end = s.length - 1;
    while (end > 0 && Math.abs(s[end]) < 0.003) end--;
    const cut = Math.min(s.length, end + Math.round(sr * 0.12));
    const trimmed = cut < s.length ? s.slice(0, cut) : s;
    const durationSec = trimmed.length / sr;
    return { audio: float32ToWav(trimmed, sr), durationSec, wordTimings: estimateWordTimings(text, durationSec), sampleRate: sr };
  }

  /**
   * Synthesises one utterance. Always queued, never parallel.
   * Fallback chain: WebGPU → (bounded retry) → WASM/CPU → controlled failure.
   */
  async generateSpeech(o: GenerateSpeechOptions): Promise<SpeechResult> {
    return this.serial(async () => {
      if (o.language !== 'en') throw new Error('Kokoro (browser) supports English only. Use a Piper tr_TR voice via a local runtime for Turkish.');
      if (!this.tts) await this.createOrThrow();

      const voices = await this.listVoices();
      const voice = this.resolveVoice(o, voices);
      const MAX_ATTEMPTS = 3;
      let lastErr: Error | null = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const audio = await this.tts!.generate(o.text, { voice: voice.id as never, speed: o.speed });
          const result = this.postProcess(audio.audio as Float32Array, audio.sampling_rate, o.volume, o.text);
          // release the raw tensor as soon as we have PCM
          (audio as unknown as { audio?: Float32Array | null }).audio = null;
          if (deviceProfile().recycleTtsBetweenScenes) {
            await this.recycle();
          } else if (deviceProfile().aggressiveCleanup) {
            await yieldToBrowser(0);
          }
          return result;
        } catch (e) {
          lastErr = e as Error;
          const gpu = isGpuFailure(e);
          const transient = isTransientFailure(e);

          if (gpu && this.device === 'webgpu') {
            // GPU buffer / init failure → permanently switch this session to CPU
            this.gpuBlocked = true;
            enableLowMemoryTts();
            this.emit('warn', 'GPU buffer error — retrying with CPU fallback…');
            await this.unload();
            await yieldToBrowser(40);
            this.device = 'wasm';
            try {
              this.tts = await this.createSession('wasm');
            } catch (e2) {
              throw new Error(`TTS failed on GPU and CPU: ${(e2 as Error).message}`);
            }
            continue;
          }
          if (gpu || transient) {
            // same backend, bounded retry after releasing what we can
            this.emit('warn', `TTS attempt ${attempt + 1}/${MAX_ATTEMPTS} failed (${lastErr.message.slice(0, 70)}) — retrying…`);
            try {
              await this.recycle();
            } catch {
              /* if recycle fails the next attempt will surface it */
            }
            await yieldToBrowser(120 * (attempt + 1));
            continue;
          }
          throw lastErr; // deterministic error (bad voice, empty text…) — do not loop
        }
      }
      throw new Error(`TTS failed after ${MAX_ATTEMPTS} attempts: ${lastErr?.message ?? 'unknown error'}`);
    });
  }

  private async createOrThrow() {
    const prof = deviceProfile();
    const hasGpu = !!(navigator as Navigator & { gpu?: unknown }).gpu;
    if (hasGpu && !prof.preferCpuTts && !this.gpuBlocked) {
      try {
        this.device = 'webgpu';
        this.tts = await this.createSession('webgpu');
        return;
      } catch {
        this.gpuBlocked = true;
        enableLowMemoryTts();
        this.emit('warn', 'GPU unavailable for TTS — switching to CPU fallback');
      }
    }
    this.device = 'wasm';
    this.tts = await this.createSession('wasm');
  }
}

export const kokoroAdapter = new KokoroAdapter();
