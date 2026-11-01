import type { HardwareInfo, LLMAdapter, ModelInfo, TTSAdapter } from '../types';
import { memoryManager } from '../utils/memoryManager';
import { deviceProfile } from '../utils/deviceProfile';
import { deleteWebLLMModel, hasWebLLMInCache, webllmAdapter } from './llm/webllmAdapter';
import { deleteKokoroCache, KOKORO_MODEL_ID, kokoroAdapter } from './tts/kokoroAdapter';
import {
  entryById,
  formatSize,
  readInstalls,
  REGISTRY,
  removeInstall,
  requestPersistentStorage,
  verifyModel,
  writeInstall,
  type InstallRecord,
  type ModelState,
  type ModelStatus,
  type RegistryEntry,
} from './registry';

/**
 * LOCAL MODEL MANAGER
 *
 * Flow enforced for every model request:
 *   pipeline → getModel(id) → installed? → YES: load from local storage
 *                                        → NO : report NOT_INSTALLED (never auto-download)
 *
 * Downloads only ever start from an explicit user action. Verification runs before a model is
 * marked READY, and the result is persisted so the next app start skips the download entirely.
 */

export const VISUAL_ENGINE: ModelInfo = {
  id: 'engine:procedural-2d',
  name: 'Procedural 2D Scene Engine',
  category: 'visual',
  backend: 'browser',
  sizeBytes: 0,
  vramBytes: 0,
  installed: true,
  loaded: true,
  downloadable: false,
  description: 'Characters, environments, objects, lighting, effects and camera are drawn in real time from the LLM scene plan. NO AI IMAGE GENERATION.',
  languages: ['en', 'tr'],
  family: 'Built-in engine',
};

/** Logical registry id → the runtime id used by the existing adapters/settings. */
export function runtimeIdOf(entry: RegistryEntry): string {
  return entry.category === 'llm' ? `webllm:${entry.runtimeId}` : KOKORO_MODEL_ID;
}
/** Runtime/settings id → registry entry. */
export function entryForRuntime(id: string): RegistryEntry | undefined {
  if (!id) return undefined;
  if (id.startsWith('webllm:')) {
    const rt = id.slice('webllm:'.length);
    return REGISTRY.find((e) => e.runtimeId === rt);
  }
  if (id.startsWith('kokoro:') || id === KOKORO_MODEL_ID) return REGISTRY.find((e) => e.category === 'tts');
  return REGISTRY.find((e) => e.id === id);
}

export interface DownloadHandle {
  cancel: () => void;
  pause: () => void;
}

type Progress = (p: number, text: string) => void;

class ModelManager {
  models: ModelInfo[] = [];
  states = new Map<string, ModelState>();
  hardware: HardwareInfo | null = null;
  storage: { persisted: boolean; quotaGB: number | null; usedGB: number | null } = { persisted: false, quotaGB: null, usedGB: null };
  /** Set while a download is running so the UI can pause/cancel it. */
  activeDownload: { id: string; paused: boolean; cancelled: boolean } | null = null;

  private listeners = new Set<() => void>();
  private webgpu = false;
  /** Guarantees a single in-flight load per category (no duplicate initialisation). */
  private loadLocks = new Map<string, Promise<void>>();

  async init(webgpu: boolean, hardware: HardwareInfo | null = null) {
    this.webgpu = webgpu;
    this.hardware = hardware;
    this.storage = await requestPersistentStorage();
    await this.scanAll();
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ scanning

  /** Scans persistent storage once and rebuilds every model state. No network access. */
  async scanAll(): Promise<ModelState[]> {
    const installs = await readInstalls();
    const out: ModelState[] = [];
    for (const entry of REGISTRY) {
      const prev = installs[entry.id] ?? null;
      const state = await this.verifyOne(entry, prev, false);
      out.push(state);
    }
    this.rebuildModelInfos();
    this.emit();
    return out;
  }

  private async verifyOne(entry: RegistryEntry, prev: InstallRecord | null, persist = true): Promise<ModelState> {
    const extra = entry.category === 'llm' ? () => hasWebLLMInCache(entry.runtimeId) : undefined;
    const res = await verifyModel(entry, prev, extra);
    const loaded = entry.category === 'llm' ? webllmAdapter.currentModel === entry.runtimeId : kokoroAdapter.isLoaded();

    const state: ModelState = {
      ...entry,
      status: res.status,
      install: prev,
      bytesOnDisk: res.bytes,
      fileCount: res.fileCount,
      loaded,
      issue: res.issue,
    };
    this.states.set(entry.id, state);

    if (persist) {
      if (res.status === 'READY') {
        const rec: InstallRecord = {
          id: entry.id,
          version: entry.version,
          installedAt: prev?.installedAt ?? Date.now(),
          verifiedAt: Date.now(),
          sizeBytes: res.bytes || entry.sizeBytes,
          fileCount: res.fileCount,
          fingerprint: res.fingerprint,
          status: 'READY',
          partial: false,
        };
        await writeInstall(rec);
        state.install = rec;
      } else if (res.status === 'NOT_INSTALLED' && prev) {
        await removeInstall(entry.id);
        state.install = null;
      } else if (prev) {
        await writeInstall({ ...prev, status: res.status, verifiedAt: Date.now(), lastError: res.issue });
      }
    }
    return state;
  }

  /** Re-verifies one model on demand (used by the "Verify" button). */
  async verify(id: string): Promise<ModelState> {
    const entry = entryById(id);
    if (!entry) throw new Error('Unknown model: ' + id);
    this.patch(id, { status: 'VERIFYING' });
    const installs = await readInstalls();
    const state = await this.verifyOne(entry, installs[id] ?? null, true);
    this.rebuildModelInfos();
    this.emit();
    return state;
  }

  private patch(id: string, p: Partial<ModelState>) {
    const s = this.states.get(id);
    if (s) {
      this.states.set(id, { ...s, ...p });
      this.rebuildModelInfos();
      this.emit();
    }
  }

  /** Keeps the legacy ModelInfo[] (used across the existing UI) in sync with registry states. */
  private rebuildModelInfos() {
    const infos: ModelInfo[] = [];
    for (const entry of REGISTRY) {
      const st = this.states.get(entry.id);
      if (entry.category === 'llm' && !this.webgpu) continue;
      infos.push({
        id: runtimeIdOf(entry),
        name: entry.name,
        category: entry.category,
        backend: entry.backend === 'webgpu' && (entry.category !== 'tts' || !deviceProfile().preferCpuTts) ? 'webgpu' : 'wasm',
        sizeBytes: st?.bytesOnDisk || entry.sizeBytes,
        vramBytes: entry.vramBytes,
        installed: st?.status === 'READY' || st?.status === 'UPDATING',
        loaded: !!st?.loaded,
        downloadable: entry.downloadable,
        description: entry.description,
        languages: entry.languages,
        quant: entry.format === 'mlc-webgpu' ? 'q4f16_1' : 'fp32/q8',
        family: entry.family,
      });
    }
    infos.push({ ...VISUAL_ENGINE });
    this.models = infos;
  }

  // ------------------------------------------------------------ queries

  byCategory(cat: ModelInfo['category']) {
    return this.models.filter((m) => m.category === cat);
  }
  get(id: string) {
    return this.models.find((m) => m.id === id);
  }
  stateList(): ModelState[] {
    return REGISTRY.map((e) => this.states.get(e.id)).filter(Boolean) as ModelState[];
  }

  /**
   * THE pipeline entry point. Returns the model state for a logical or runtime id.
   * Never downloads, never throws for a missing model — the caller decides what to show.
   */
  getModel(id: string): ModelState | { status: 'NOT_INSTALLED'; id: string; missing: true } {
    const entry = entryById(id) ?? entryForRuntime(id);
    if (!entry) return { status: 'NOT_INSTALLED', id, missing: true };
    return this.states.get(entry.id) ?? { status: 'NOT_INSTALLED', id: entry.id, missing: true };
  }

  /** True only when the model is verified and usable right now. */
  isReady(id: string): boolean {
    const s = this.getModel(id);
    return 'status' in s && (s.status === 'READY' || s.status === 'UPDATING');
  }

  requirementFor(id: string): { entry: RegistryEntry; state: ModelState | null } | null {
    const entry = entryById(id) ?? entryForRuntime(id);
    if (!entry) return null;
    return { entry, state: this.states.get(entry.id) ?? null };
  }

  llmAdapterFor(id: string): LLMAdapter {
    if (id.startsWith('webllm:')) return webllmAdapter;
    const e = entryById(id);
    if (e?.category === 'llm') return webllmAdapter;
    throw new Error('No local LLM selected. Download one in Local Models.');
  }
  ttsAdapterFor(id: string): TTSAdapter {
    if (id.startsWith('kokoro:') || id === KOKORO_MODEL_ID) return kokoroAdapter;
    const e = entryById(id);
    if (e?.category === 'tts') return kokoroAdapter;
    throw new Error('No local TTS selected. Download Kokoro in Local Models.');
  }

  // ------------------------------------------------------------ download

  pauseDownload() {
    if (this.activeDownload) {
      this.activeDownload.paused = true;
      this.patch(this.activeDownload.id, { status: 'PAUSED', progressText: 'Paused — already downloaded parts are kept' });
    }
  }
  cancelDownload() {
    if (this.activeDownload) {
      this.activeDownload.cancelled = true;
      this.patch(this.activeDownload.id, { status: 'NOT_INSTALLED', progressText: 'Cancelled' });
    }
  }

  /**
   * Explicit, user-confirmed download.
   * Weight shards already in Cache Storage are skipped by the runtimes, so an interrupted
   * download genuinely resumes instead of restarting.
   */
  async download(idOrRuntime: string, onProgress?: Progress): Promise<ModelState> {
    const entry = entryById(idOrRuntime) ?? entryForRuntime(idOrRuntime);
    if (!entry) throw new Error('This item has nothing to download — it is built into the app.');
    if (this.activeDownload) throw new Error('Another model is already downloading. Wait for it to finish or cancel it.');

    this.activeDownload = { id: entry.id, paused: false, cancelled: false };
    const started = Date.now();
    let lastBytes = 0;
    const report: Progress = (p, text) => {
      const pct = Math.max(0, Math.min(1, p));
      const bytes = pct * entry.sizeBytes;
      const elapsed = (Date.now() - started) / 1000;
      const speed = elapsed > 1 ? bytes / elapsed : 0;
      const eta = speed > 0 && pct > 0.01 ? (entry.sizeBytes - bytes) / speed : 0;
      lastBytes = bytes;
      const detail = speed > 0 ? `${formatSize(bytes)} / ${formatSize(entry.sizeBytes)} · ${formatSize(speed)}/s · ETA ${Math.max(0, Math.round(eta))}s` : text;
      this.patch(entry.id, { status: 'DOWNLOADING', progress: pct, progressText: detail });
      onProgress?.(pct, detail);
    };

    try {
      this.patch(entry.id, { status: 'DOWNLOADING', progress: 0, progressText: 'Starting…' });
      await writeInstall({
        id: entry.id,
        version: entry.version,
        installedAt: Date.now(),
        verifiedAt: 0,
        sizeBytes: 0,
        fileCount: 0,
        fingerprint: '',
        status: 'DOWNLOADING',
        partial: true,
      });

      if (entry.category === 'llm') {
        await webllmAdapter.load(runtimeIdOf(entry), report);
        await webllmAdapter.unload();
        await memoryManager.release('llm');
      } else {
        await kokoroAdapter.load(KOKORO_MODEL_ID, report);
        await kokoroAdapter.unload();
        await memoryManager.release('tts');
      }

      if (this.activeDownload?.cancelled) {
        this.patch(entry.id, { status: 'NOT_INSTALLED', progressText: 'Cancelled' });
        await writeInstall({ id: entry.id, version: entry.version, installedAt: Date.now(), verifiedAt: 0, sizeBytes: lastBytes, fileCount: 0, fingerprint: '', status: 'PAUSED', partial: true });
        return this.states.get(entry.id)!;
      }

      // ---- verify before claiming READY ----
      this.patch(entry.id, { status: 'VERIFYING', progressText: 'Verifying downloaded files…' });
      onProgress?.(0.99, 'Verifying…');
      const installs = await readInstalls();
      const state = await this.verifyOne(entry, { ...(installs[entry.id] as InstallRecord), partial: false }, true);
      if (state.status !== 'READY') {
        this.patch(entry.id, { status: state.status, progressText: state.issue ?? 'Verification failed' });
      } else {
        this.patch(entry.id, { status: 'READY', progress: 1, progressText: 'Installed' });
      }
      this.rebuildModelInfos();
      this.emit();
      return this.states.get(entry.id)!;
    } catch (e) {
      const msg = (e as Error).message;
      const paused = this.activeDownload?.paused;
      await writeInstall({
        id: entry.id,
        version: entry.version,
        installedAt: Date.now(),
        verifiedAt: 0,
        sizeBytes: lastBytes,
        fileCount: 0,
        fingerprint: '',
        status: paused ? 'PAUSED' : 'FAILED',
        partial: true,
        lastError: msg,
      });
      this.patch(entry.id, { status: paused ? 'PAUSED' : 'FAILED', progressText: paused ? 'Paused — resume to continue' : msg });
      throw e;
    } finally {
      this.activeDownload = null;
      await this.scanAll();
    }
  }

  // ------------------------------------------------------------ load / unload

  /**
   * Loads a verified model. If the same model is already resident it is reused instead of
   * being initialised again (single-instance lock, important on mobile).
   */
  async load(id: string, onProgress?: Progress) {
    const entry = entryById(id) ?? entryForRuntime(id);
    if (!entry) throw new Error('Unknown model: ' + id);
    const state = this.states.get(entry.id);
    if (state && state.status !== 'READY' && state.status !== 'UPDATING') {
      throw new Error(`"${entry.name}" is not installed on this device (${state.status}). Open Local Models to download it.`);
    }
    const runtimeId = runtimeIdOf(entry);

    // already resident → reuse
    if (entry.category === 'llm' && webllmAdapter.currentModel === entry.runtimeId) return;
    if (entry.category === 'tts' && kokoroAdapter.isLoaded()) return;

    const key = entry.category;
    const existing = this.loadLocks.get(key);
    if (existing) await existing.catch(() => undefined);

    const task = (async () => {
      if (entry.category === 'llm') await webllmAdapter.load(runtimeId, onProgress);
      else await kokoroAdapter.load(runtimeId, onProgress);
    })();
    this.loadLocks.set(key, task);
    try {
      await task;
    } finally {
      this.loadLocks.delete(key);
      await this.scanAll();
    }
  }

  async unload(id: string) {
    const m = this.get(id);
    const entry = entryById(id) ?? entryForRuntime(id);
    const cat = entry?.category ?? m?.category;
    if (!cat || cat === 'visual') return;
    await memoryManager.release(cat);
    await this.scanAll();
  }

  async unloadAll() {
    await memoryManager.releaseAll();
    await this.scanAll();
  }

  /** Removes the weights from persistent storage and forgets the install record. */
  async delete(id: string) {
    const entry = entryById(id) ?? entryForRuntime(id);
    if (!entry) throw new Error('The Procedural 2D Scene Engine is part of the app and cannot be removed.');
    if (entry.category === 'llm') {
      if (webllmAdapter.currentModel === entry.runtimeId) await memoryManager.release('llm');
      await deleteWebLLMModel(`webllm:${entry.runtimeId}`);
    } else {
      if (kokoroAdapter.isLoaded()) await memoryManager.release('tts');
      await deleteKokoroCache();
    }
    await removeInstall(entry.id);
    await this.scanAll();
  }

  /** Legacy alias kept so existing callers keep working. */
  async refresh() {
    return this.scanAll().then(() => this.models);
  }
}

export const modelManager = new ModelManager();
export type { ModelState, ModelStatus, RegistryEntry };
