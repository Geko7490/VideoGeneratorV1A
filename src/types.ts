import type { CharacterMode, SceneSpec, SceneTransition, StyleBible, VisualStyle } from './scene/types';

export type { SceneSpec, StyleBible, VisualStyle, SceneTransition, CharacterMode };

// ---------- Core domain types ----------

export type AspectRatio = '9:16' | '16:9' | '1:1';
export type Language = 'en' | 'tr';
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'auto';
/** Quality actually used by the renderer after 'auto' is resolved against the device. */
export type ResolvedQuality = 'low' | 'medium' | 'high' | 'ultra';
export type HardwareTier = 'low' | 'medium' | 'high';
export type Locality = 'LOCAL' | 'REMOTE';

export type CaptionStyle = 'clean' | 'bold' | 'shorts' | 'tiktok' | 'minimal' | 'cinematic';
export type CaptionMode = 'word' | 'phrase' | 'standard';

export interface WordTiming {
  word: string;
  start: number; // seconds relative to scene start
  end: number;
}

export interface Scene {
  sceneId: number;
  voiceover: string;
  durationEstimate: number;
  actualDuration: number | null; // measured from real TTS audio
  /** Structured visual plan produced by the LLM and rendered procedurally. */
  spec: SceneSpec;
  captionText: string;
  seed: number;
  /** PENDING → GENERATING → READY(done) · RECOVERING (retry/fallback) · FAILED · INVALID · SKIPPED */
  ttsStatus: 'pending' | 'generating' | 'done' | 'failed' | 'skipped' | 'recovering' | 'invalid';
  ttsError?: string;
  ttsSource?: string;
  wordTimings: WordTiming[];
  chunkIndex: number;
}

export interface Script {
  title: string;
  hook: string;
  musicMood: string;
  styleNotes: string;
  scenes: Scene[];
}

export interface MusicSettings {
  enabled: boolean;
  fileName: string | null;
  volume: number;
  trimStart: number;
  trimEnd: number | null;
  loop: boolean;
  fadeIn: number;
  fadeOut: number;
  ducking: boolean;
  duckLevel: number;
}

export interface SfxAsset {
  id: string;
  name: string;
  fileName: string;
  volume: number;
  startTime: number;
  trimStart: number;
  trimEnd: number | null;
  fade: number;
  sceneId: number | null;
}

export interface PronunciationRule {
  id: string;
  word: string;
  speakAs: string;
  language: Language | 'any';
}

export interface TtsCleanResult {
  clean: string;
  sentences: string[];
  removed: string[];
  pronunciationApplied: string[];
}

export interface ProjectSettings {
  topic: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  language: Language;
  /** Locks ONE visual identity (style + character bible) for the whole video. */
  styleLockEnabled: boolean;
  llmModelId: string;
  ttsModelId: string;
  voice: string;
  ttsSpeed: number;
  ttsPitch: number;
  ttsVolume: number;
  /** Render quality: LOW / MEDIUM / HIGH / ULTRA / AUTO (resolution scale, particles, detail). */
  quality: QualityPreset;
  visualStyle: VisualStyle;
  /** Global character policy: Auto / No Character / Optional / Required. */
  characterMode: CharacterMode;
  /** Advanced scene-engine switches. */
  sceneDetail: number;        // 0.4 .. 1.4
  animationEnabled: boolean;
  effectsEnabled: boolean;
  lightingEnabled: boolean;
  cameraMotionEnabled: boolean;
  parallaxEnabled: boolean;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
  captionMode: CaptionMode;
  masterSeed: number;
  lockSeed: boolean;
  fps: number;
  music: MusicSettings;
  sfx: SfxAsset[];
  chunkSeconds: number;
  pronunciation: PronunciationRule[];
}

export interface ChunkRecord {
  index: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'rendering' | 'done' | 'failed';
  frameCount: number;
  codec?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  styleBible: StyleBible | null;
  script: Script | null;
  stage: PipelineStage;
  chunks: ChunkRecord[];
  exportFileName: string | null;
  exportMime: string | null;
  modelsUsed: { llm?: string; ttsModel?: string; visualEngine?: string };
}

export type PipelineStage = 'idle' | 'script' | 'style' | 'tts' | 'sync' | 'render' | 'export' | 'done' | 'failed';

// ---------- Queue ----------

export type TaskStatus = 'waiting' | 'generating' | 'completed' | 'failed' | 'skipped';

export interface QueueTask {
  id: string;
  label: string;
  kind: 'script' | 'style' | 'tts' | 'render' | 'export' | 'load' | 'unload';
  status: TaskStatus;
  locality: Locality;
  sceneId?: number;
  error?: string;
  progress?: number;
  startedAt?: number;
  finishedAt?: number;
}

// ---------- Models (LLM + TTS only — there is NO image generation model) ----------

export type ModelCategory = 'llm' | 'tts' | 'visual';
export type ModelBackend = 'webgpu' | 'wasm' | 'browser';

export interface ModelInfo {
  id: string;
  name: string;
  category: ModelCategory;
  backend: ModelBackend;
  sizeBytes: number | null;
  vramBytes: number | null;
  installed: boolean;
  loaded: boolean;
  downloadable: boolean;
  description: string;
  languages: Language[];
  quant?: string;
  family?: string;
}

export interface GenerateSpeechOptions {
  text: string;
  voice: string;
  speed: number;
  pitch: number;
  volume: number;
  language: Language;
  modelId: string;
}

export interface SpeechResult {
  audio: Blob;
  durationSec: number;
  wordTimings: WordTiming[];
  sampleRate: number;
}

export interface LLMAdapter {
  id: string;
  locality: Locality;
  load(modelId: string, onProgress?: (p: number, text: string) => void): Promise<void>;
  unload(): Promise<void>;
  isLoaded(): boolean;
  complete(system: string, user: string, opts?: { json?: boolean; maxTokens?: number; temperature?: number; onToken?: (t: string) => void }): Promise<string>;
}

export interface TTSAdapter {
  id: string;
  locality: Locality;
  load(modelId: string, onProgress?: (p: number, text: string) => void): Promise<void>;
  unload(): Promise<void>;
  isLoaded(): boolean;
  listVoices(modelId: string): Promise<{ id: string; name: string; language: Language }[]>;
  generateSpeech(opts: GenerateSpeechOptions): Promise<SpeechResult>;
}

export interface HardwareInfo {
  webgpu: boolean;
  webgpuAdapter: string | null;
  deviceMemoryGB: number | null;
  cpuCores: number | null;
  storageQuotaGB: number | null;
  storageUsedGB: number | null;
  webcodecs: boolean;
  h264: boolean;
  aac: boolean;
  fsAccess: boolean;
  tier: HardwareTier;
  maxBufferMB: number | null;
}

export const RESOLUTIONS: Record<AspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

/** Render scale per quality tier — LOW renders smaller then upscales on encode (mobile friendly). */
export const RENDER_SCALE: Record<ResolvedQuality, number> = { low: 0.45, medium: 0.68, high: 1, ultra: 1 };
export const QUALITY_FPS: Record<ResolvedQuality, number> = { low: 24, medium: 30, high: 30, ultra: 30 };
export const QUALITY_DETAIL: Record<ResolvedQuality, number> = { low: 0.5, medium: 0.8, high: 1, ultra: 1.35 };

/** Resolves AUTO against the detected device capabilities. */
export function resolveQuality(q: QualityPreset, hw: HardwareInfo | null): ResolvedQuality {
  if (q !== 'auto') return q;
  if (!hw) return 'medium';
  const cores = hw.cpuCores ?? 4;
  const mem = hw.deviceMemoryGB ?? 4;
  if (hw.tier === 'high' && cores >= 8 && mem >= 8) return 'high';
  if (hw.tier === 'low' || cores <= 4 || mem <= 4) return 'low';
  return 'medium';
}


