import type { ModelCategory } from '../types';

/**
 * Tracks which heavy model currently occupies the GPU. Enforces sequential loading:
 * only one category of heavy model (LLM / image / TTS) may be resident at a time,
 * unless the runtime explicitly reports it is safe (not the default).
 */

export interface MemoryState {
  currentModel: { category: ModelCategory; id: string; name: string } | null;
  vramUsedBytes: number | null;
  vramTotalBytes: number | null;
  status: string;
  lowMemoryMode: boolean;
}

type Listener = (s: MemoryState) => void;

class MemoryManager {
  state: MemoryState = { currentModel: null, vramUsedBytes: null, vramTotalBytes: null, status: 'Idle', lowMemoryMode: false };
  private listeners = new Set<Listener>();
  private unloaders = new Map<ModelCategory, () => Promise<void>>();

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit() {
    for (const l of this.listeners) l({ ...this.state });
  }
  setStatus(status: string) {
    this.state.status = status;
    this.emit();
  }
  setLowMemoryMode(v: boolean) {
    this.state.lowMemoryMode = v;
    this.emit();
  }
  setVram(used: number | null, total: number | null) {
    this.state.vramUsedBytes = used;
    this.state.vramTotalBytes = total;
    this.emit();
  }

  /** Ensure only `category` is resident. Unloads whatever else is loaded first. */
  async acquire(category: ModelCategory, id: string, name: string, estVram: number | null) {
    const cur = this.state.currentModel;
    if (cur && (cur.category !== category || cur.id !== id)) {
      this.setStatus(`Unloading ${cur.name} to free VRAM`);
      const un = this.unloaders.get(cur.category);
      if (un) {
        try {
          await un();
        } catch (e) {
          console.warn('unload failed', e);
        }
      }
      this.state.currentModel = null;
    }
    this.state.currentModel = { category, id, name };
    this.state.vramUsedBytes = estVram;
    this.emit();
  }

  registerUnloader(category: ModelCategory, fn: () => Promise<void>) {
    this.unloaders.set(category, fn);
  }

  async release(category: ModelCategory) {
    if (this.state.currentModel?.category === category) {
      const un = this.unloaders.get(category);
      if (un) await un();
      this.state.currentModel = null;
      this.state.vramUsedBytes = null;
      this.setStatus('Idle');
    }
  }

  async releaseAll() {
    for (const [cat, un] of this.unloaders) {
      try {
        await un();
      } catch {
        /* ignore */
      }
      void cat;
    }
    this.state.currentModel = null;
    this.state.vramUsedBytes = null;
    this.setStatus('Idle');
  }
}

export const memoryManager = new MemoryManager();

export function isOutOfMemoryError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return (
    m.includes('out of memory') ||
    m.includes('outofmemory') ||
    m.includes('oom') ||
    m.includes('cuda error') ||
    m.includes('allocation failed') ||
    m.includes('device lost') ||
    m.includes('buffer size') ||
    m.includes('not enough memory')
  );
}
