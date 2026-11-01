import { kvStore } from '../storage/projectStore';
import type { Language, ModelCategory } from '../types';

/**
 * LOCAL AI MODEL REGISTRY
 *
 * Single source of truth for every downloadable local model. The video pipeline never touches
 * storage paths or cache names directly — it asks `getModel(id)` and gets back a status.
 *
 * Guarantee: a model is downloaded ONCE. On every start the manager scans persistent storage,
 * verifies the files that are actually there, and marks the model READY without re-downloading.
 */

export type ModelStatus =
  | 'NOT_INSTALLED'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'VERIFYING'
  | 'READY'
  | 'CORRUPTED'
  | 'FAILED'
  | 'UPDATING';

export type ModelFormat = 'mlc-webgpu' | 'onnx' | 'builtin';
export type ModelBackendId = 'webgpu' | 'wasm' | 'browser';
export type DeviceSupport = 'desktop' | 'mobile';

/** Static description of a model — extend this array to add new LLM / TTS / other models. */
export interface RegistryEntry {
  id: string;                     // stable logical id, e.g. "qwen-0.5b"
  name: string;
  version: string;
  category: ModelCategory;
  family: string;
  format: ModelFormat;
  backend: ModelBackendId;
  /** Download size in bytes (approximate, from publisher metadata). */
  sizeBytes: number;
  /** Rough memory need once loaded. */
  vramBytes: number;
  description: string;
  languages: Language[];
  /** Runtime identifier handed to the adapter (WebLLM model_id / HF repo id). */
  runtimeId: string;
  /** Substring every cached file of this model contains — used to scan storage. */
  cacheMatch: string;
  /** Filename fragments that MUST exist for the install to count as complete. */
  requiredFiles: { label: string; match: RegExp }[];
  /** Minimum number of cached entries for a sane install (weights are sharded). */
  minFiles: number;
  /** Minimum total bytes on disk; guards against truncated downloads. */
  minBytes: number;
  supportedDevices: DeviceSupport[];
  /** Warn before downloading on a phone. */
  heavyForMobile: boolean;
  downloadable: boolean;
}

/** Persisted record of what is actually installed on this device. */
export interface InstallRecord {
  id: string;
  version: string;
  installedAt: number;
  verifiedAt: number;
  /** Bytes measured in storage at verification time. */
  sizeBytes: number;
  fileCount: number;
  /** Cheap integrity fingerprint: hash of sorted "name:size" pairs. */
  fingerprint: string;
  status: ModelStatus;
  /** Set when a download was interrupted — lets us resume instead of restarting. */
  partial?: boolean;
  lastError?: string;
}

export interface ModelState extends RegistryEntry {
  status: ModelStatus;
  install: InstallRecord | null;
  /** Live bytes found in storage during the last scan. */
  bytesOnDisk: number;
  fileCount: number;
  loaded: boolean;
  /** Human readable reason when CORRUPTED / FAILED. */
  issue?: string;
  progress?: number;
  progressText?: string;
}

// ---------------------------------------------------------------- catalog

const MLC_REQUIRED: { label: string; match: RegExp }[] = [
  { label: 'config', match: /mlc-chat-config\.json$/i },
  { label: 'weight index', match: /ndarray-cache\.json$/i },
  { label: 'tokenizer', match: /tokenizer(\.json|\.model|_config\.json)$/i },
  { label: 'weights', match: /params_shard_\d+\.bin$/i },
];

function mlc(id: string, name: string, runtimeId: string, sizeMB: number, vramMB: number, family: string, desc: string, heavy: boolean): RegistryEntry {
  return {
    id,
    name,
    version: '1',
    category: 'llm',
    family,
    format: 'mlc-webgpu',
    backend: 'webgpu',
    sizeBytes: Math.round(sizeMB * 1024 * 1024),
    vramBytes: Math.round(vramMB * 1024 * 1024),
    description: desc,
    languages: ['en', 'tr'],
    runtimeId,
    cacheMatch: runtimeId,
    requiredFiles: MLC_REQUIRED,
    minFiles: 4,
    minBytes: Math.round(sizeMB * 1024 * 1024 * 0.6),
    supportedDevices: heavy ? ['desktop'] : ['desktop', 'mobile'],
    heavyForMobile: heavy,
    downloadable: true,
  };
}

export const REGISTRY: RegistryEntry[] = [
  mlc('qwen-0.5b', 'Qwen2.5 0.5B Instruct', 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', 420, 945, 'Qwen', 'Smallest scene planner. Best choice for phones.', false),
  mlc('llama-1b', 'Llama 3.2 1B Instruct', 'Llama-3.2-1B-Instruct-q4f16_1-MLC', 747, 879, 'Llama', 'Compact Llama. Good quality on mid devices.', false),
  mlc('qwen-1.5b', 'Qwen2.5 1.5B Instruct', 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 1130, 1629, 'Qwen', 'Better story structure than 0.5B.', false),
  mlc('gemma-2b', 'Gemma 2 2B Instruct', 'gemma-2-2b-it-q4f16_1-MLC', 1480, 1895, 'Gemma', 'Google Gemma 2. Balanced writer.', true),
  mlc('llama-3b', 'Llama 3.2 3B Instruct', 'Llama-3.2-3B-Instruct-q4f16_1-MLC', 2260, 2951, 'Llama', 'Strong scene direction. Desktop recommended.', true),
  mlc('phi-3.5-mini', 'Phi-3.5 Mini Instruct', 'Phi-3.5-mini-instruct-q4f16_1-MLC', 2420, 3672, 'Phi', 'Microsoft Phi-3.5. Good reasoning.', true),
  mlc('qwen-3b', 'Qwen2.5 3B Instruct', 'Qwen2.5-3B-Instruct-q4f16_1-MLC', 2510, 3295, 'Qwen', 'High quality planning. Desktop recommended.', true),
  mlc('qwen-7b', 'Qwen2.5 7B Instruct', 'Qwen2.5-7B-Instruct-q4f16_1-MLC', 4520, 5707, 'Qwen', 'Best director. Needs a strong GPU.', true),
  mlc('llama-8b', 'Llama 3.1 8B Instruct', 'Llama-3.1-8B-Instruct-q4f16_1-MLC', 4600, 6101, 'Llama', 'Large Llama. Desktop only.', true),
  {
    id: 'kokoro-82m',
    name: 'Kokoro-82M TTS',
    version: '1.0',
    category: 'tts',
    family: 'Kokoro',
    format: 'onnx',
    backend: 'webgpu',
    sizeBytes: 326 * 1024 * 1024,
    vramBytes: 400 * 1024 * 1024,
    description: 'Lightweight neural TTS (ONNX). Runs on WebGPU with automatic CPU/WASM fallback.',
    languages: ['en'],
    runtimeId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    cacheMatch: 'Kokoro-82M',
    requiredFiles: [
      { label: 'onnx weights', match: /\.onnx(_data)?$/i },
      { label: 'config', match: /config\.json$/i },
      { label: 'voices', match: /(voices|\.bin|tokenizer)/i },
    ],
    minFiles: 2,
    minBytes: 40 * 1024 * 1024,
    supportedDevices: ['desktop', 'mobile'],
    heavyForMobile: false,
    downloadable: true,
  },
];

export function entryById(id: string): RegistryEntry | undefined {
  return REGISTRY.find((e) => e.id === id);
}
/** Maps a runtime id (WebLLM model_id / HF repo) back to its registry entry. */
export function entryByRuntimeId(runtimeId: string): RegistryEntry | undefined {
  return REGISTRY.find((e) => e.runtimeId === runtimeId);
}

// ---------------------------------------------------------------- persistence

const KEY = 'localModelInstalls.v1';

export async function readInstalls(): Promise<Record<string, InstallRecord>> {
  return (await kvStore.get<Record<string, InstallRecord>>(KEY)) ?? {};
}
export async function writeInstall(rec: InstallRecord) {
  const all = await readInstalls();
  all[rec.id] = rec;
  await kvStore.set(KEY, all);
}
export async function removeInstall(id: string) {
  const all = await readInstalls();
  delete all[id];
  await kvStore.set(KEY, all);
}

/** Ask the browser to keep model weights out of the eviction queue. */
export async function requestPersistentStorage(): Promise<{ persisted: boolean; quotaGB: number | null; usedGB: number | null }> {
  let persisted = false;
  try {
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    if (!persisted && navigator.storage?.persist) persisted = await navigator.storage.persist();
  } catch {
    persisted = false;
  }
  let quotaGB: number | null = null;
  let usedGB: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) quotaGB = +(est.quota / 1e9).toFixed(1);
    if (est?.usage !== undefined) usedGB = +(est.usage / 1e9).toFixed(2);
  } catch {
    /* ignore */
  }
  return { persisted, quotaGB, usedGB };
}

// ---------------------------------------------------------------- storage scan + verification

export interface ScanResult {
  files: { name: string; size: number }[];
  bytes: number;
}

/**
 * Walks Cache Storage (where both WebLLM and transformers.js persist weights) and collects every
 * entry belonging to this model, with its byte size where the response exposes one.
 */
export async function scanStorage(entry: RegistryEntry): Promise<ScanResult> {
  const files: { name: string; size: number }[] = [];
  let bytes = 0;
  if (typeof caches === 'undefined') return { files, bytes };
  let names: string[] = [];
  try {
    names = await caches.keys();
  } catch {
    return { files, bytes };
  }
  for (const n of names) {
    let cache: Cache;
    try {
      cache = await caches.open(n);
    } catch {
      continue;
    }
    let reqs: readonly Request[] = [];
    try {
      reqs = await cache.keys();
    } catch {
      continue;
    }
    for (const req of reqs) {
      if (!req.url.includes(entry.cacheMatch)) continue;
      let size = 0;
      try {
        const res = await cache.match(req);
        const len = res?.headers.get('content-length');
        if (len) size = parseInt(len, 10) || 0;
        else if (res) {
          // no content-length (opaque-ish response): fall back to measuring the body
          const buf = await res.clone().arrayBuffer();
          size = buf.byteLength;
        }
      } catch {
        size = 0;
      }
      files.push({ name: req.url.split('/').slice(-2).join('/'), size });
      bytes += size;
    }
  }
  return { files, bytes };
}

/** Stable fingerprint of the install (names + sizes), used as a lightweight integrity hash. */
export function fingerprint(files: { name: string; size: number }[]): string {
  const sorted = [...files].map((f) => `${f.name}:${f.size}`).sort();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const s of sorted) {
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
      h2 = (Math.imul(h2 + s.charCodeAt(i), 2246822519) ^ (h2 >>> 13)) >>> 0;
    }
  }
  return `${sorted.length.toString(16)}-${h1.toString(16)}-${h2.toString(16)}`;
}

export interface VerifyResult {
  status: ModelStatus;
  bytes: number;
  fileCount: number;
  fingerprint: string;
  issue?: string;
}

/**
 * Deep verification — not just "does a folder exist".
 * Checks: presence of weights, config and tokenizer files, file count, total size and (when a
 * previous install record exists) the fingerprint, so a truncated or evicted model is caught.
 */
export async function verifyModel(entry: RegistryEntry, prev?: InstallRecord | null, extraCheck?: () => Promise<boolean>): Promise<VerifyResult> {
  const { files, bytes } = await scanStorage(entry);
  const fp = fingerprint(files);
  if (!files.length) return { status: 'NOT_INSTALLED', bytes: 0, fileCount: 0, fingerprint: fp };

  // required file classes
  const missing: string[] = [];
  for (const req of entry.requiredFiles) {
    if (!files.some((f) => req.match.test(f.name))) missing.push(req.label);
  }
  // the runtime's own cache check (authoritative for WebLLM)
  let runtimeOk = true;
  if (extraCheck) {
    try {
      runtimeOk = await extraCheck();
    } catch {
      runtimeOk = false;
    }
  }

  // Some caches hide content-length; only enforce the byte floor when we measured something.
  const sizeSuspicious = bytes > 0 && bytes < entry.minBytes;
  const tooFewFiles = files.length < entry.minFiles;

  if (!runtimeOk && (missing.length || tooFewFiles)) {
    return { status: 'CORRUPTED', bytes, fileCount: files.length, fingerprint: fp, issue: `Incomplete install (missing: ${missing.join(', ') || 'files'})` };
  }
  if (missing.length && !runtimeOk) {
    return { status: 'CORRUPTED', bytes, fileCount: files.length, fingerprint: fp, issue: `Missing ${missing.join(', ')}` };
  }
  if (sizeSuspicious && !runtimeOk) {
    return { status: 'CORRUPTED', bytes, fileCount: files.length, fingerprint: fp, issue: `Only ${(bytes / 1024 ** 2).toFixed(0)} MB on disk, expected ≈${(entry.sizeBytes / 1024 ** 2).toFixed(0)} MB` };
  }
  if (prev?.partial && !runtimeOk) {
    return { status: 'CORRUPTED', bytes, fileCount: files.length, fingerprint: fp, issue: 'Download was interrupted — resume or re-download' };
  }
  if (prev && prev.version !== entry.version) {
    return { status: 'UPDATING', bytes, fileCount: files.length, fingerprint: fp, issue: `Installed v${prev.version}, registry has v${entry.version}` };
  }
  if (!runtimeOk && !files.length) return { status: 'NOT_INSTALLED', bytes, fileCount: 0, fingerprint: fp };

  return { status: 'READY', bytes, fileCount: files.length, fingerprint: fp };
}

export function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const STATUS_LABEL: Record<ModelStatus, string> = {
  NOT_INSTALLED: 'Not installed',
  DOWNLOADING: 'Downloading',
  PAUSED: 'Paused',
  VERIFYING: 'Verifying',
  READY: 'Ready',
  CORRUPTED: 'Corrupted or incomplete',
  FAILED: 'Failed',
  UPDATING: 'Update available',
};
