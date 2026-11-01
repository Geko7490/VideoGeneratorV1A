/**
 * DEVICE PROFILE — mobile vs desktop behaviour.
 *
 * Mobile browsers (especially Android Chrome / WebView) die hard when several heavy GPU jobs run at
 * once, so the profile drives: concurrency, chunk size, TTS batching, cleanup aggressiveness and
 * whether we even attempt WebGPU for TTS.
 */

export type DeviceKind = 'mobile' | 'desktop';

export interface DeviceProfile {
  kind: DeviceKind;
  /** How many heavy jobs may overlap. Always 1 on mobile. */
  concurrency: number;
  /** Default render chunk length in seconds. */
  defaultChunkSeconds: number;
  /** Chunk lengths offered in the UI. */
  chunkOptions: number[];
  /** Run TTS strictly one scene at a time and release resources in between. */
  sequentialTts: boolean;
  /** Drop GPU/audio resources as soon as a scene finishes. */
  aggressiveCleanup: boolean;
  /** Re-create the TTS session between scenes to keep peak GPU memory low. */
  recycleTtsBetweenScenes: boolean;
  /** Prefer WASM for TTS instead of WebGPU (small phone GPUs have tiny buffer limits). */
  preferCpuTts: boolean;
  /** Max VideoEncoder queue depth before we wait. */
  encoderQueueLimit: number;
}

/**
 * This application is a PC-focused workstation tool: it always uses the desktop performance
 * profile (higher render quality, 30 s default chunks, desktop memory behaviour).
 */
export function detectDeviceKind(): DeviceKind {
  return 'desktop';
}

export const CHUNK_OPTIONS = [5, 10, 15, 30, 60];

export function profileFor(kind: DeviceKind): DeviceProfile {
  if (kind === 'mobile') {
    return {
      kind,
      concurrency: 1,
      defaultChunkSeconds: 10,
      chunkOptions: CHUNK_OPTIONS,
      sequentialTts: true,
      aggressiveCleanup: true,
      recycleTtsBetweenScenes: false, // only forced on after a GPU memory failure
      preferCpuTts: false,
      encoderQueueLimit: 3,
    };
  }
  return {
    kind,
    concurrency: 1, // the pipeline is sequential by design; kept explicit for clarity
    defaultChunkSeconds: 30,
    chunkOptions: CHUNK_OPTIONS,
    sequentialTts: true,
    aggressiveCleanup: false,
    recycleTtsBetweenScenes: false,
    preferCpuTts: false,
    encoderQueueLimit: 6,
  };
}

let override: Partial<DeviceProfile> | null = null;
let cached: DeviceProfile | null = null;

/** Current effective profile (auto-detected, with any user override applied). */
export function deviceProfile(): DeviceProfile {
  if (!cached) cached = profileFor(detectDeviceKind());
  return override ? { ...cached, ...override } : cached;
}

/** Lets the user force a profile from the UI ("Auto" = pass null). */
export function setProfileOverride(kind: DeviceKind | null, extra?: Partial<DeviceProfile>) {
  if (!kind) {
    override = extra ?? null;
    return;
  }
  override = { ...profileFor(kind), ...(extra ?? {}) };
}

/** Raises peak-memory protection after a GPU failure (used by the TTS fallback chain). */
export function enableLowMemoryTts() {
  override = { ...(override ?? {}), recycleTtsBetweenScenes: true, preferCpuTts: true, aggressiveCleanup: true };
}

export function isMobile() {
  return deviceProfile().kind === 'mobile';
}

/** Gives the browser a chance to run GC / release detached GPU objects between heavy steps. */
export async function yieldToBrowser(ms = 0) {
  await new Promise((r) => setTimeout(r, ms));
  if (typeof requestAnimationFrame !== 'undefined') {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
}
