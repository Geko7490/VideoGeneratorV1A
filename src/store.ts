import { create } from 'zustand';
import type { HardwareInfo, ModelInfo, Project, ProjectSettings, QueueTask, Scene, StyleBible } from './types';
import type { MemoryState } from './utils/memoryManager';
import { projectStore } from './storage/projectStore';
import { uid } from './utils/fileUtils';

export interface LogEntry {
  t: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export function defaultSettings(): ProjectSettings {
  return {
    topic: '',
    durationSec: 60,
    aspectRatio: '9:16',
    language: 'en',
    styleLockEnabled: true,
    llmModelId: '',
    ttsModelId: '',
    voice: 'af_heart',
    ttsSpeed: 1,
    ttsPitch: 0,
    ttsVolume: 1,
    quality: 'auto',
    visualStyle: 'cinematic_2d',
    characterMode: 'auto',
    sceneDetail: 1,
    animationEnabled: true,
    effectsEnabled: true,
    lightingEnabled: true,
    cameraMotionEnabled: true,
    parallaxEnabled: true,
    captionsEnabled: true,
    captionStyle: 'bold',
    captionMode: 'phrase',
    masterSeed: Math.floor(Math.random() * 1_000_000),
    lockSeed: true,
    fps: 30,
    music: { enabled: false, fileName: null, volume: 0.25, trimStart: 0, trimEnd: null, loop: true, fadeIn: 1.5, fadeOut: 2.5, ducking: true, duckLevel: 0.35 },
    sfx: [],
    chunkSeconds: 30,
    pronunciation: [],
  };
}

export function newProject(name = 'Untitled project'): Project {
  return {
    id: uid('p_'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: defaultSettings(),
    styleBible: null,
    script: null,
    stage: 'idle',
    chunks: [],
    exportFileName: null,
    exportMime: null,
    modelsUsed: {},
  };
}

interface State {
  project: Project;
  projects: Project[];
  hardware: HardwareInfo | null;
  models: ModelInfo[];
  tasks: QueueTask[];
  memory: MemoryState | null;
  logs: LogEntry[];
  busy: boolean;
  statusText: string;
  streamText: string;
  selectedSceneId: number | null;
  modal: null | 'models' | 'projects' | 'style' | 'audio';
  exportUrl: string | null;
  audioUrls: Record<number, string>;

  setProject: (p: Project | ((p: Project) => Project), persist?: boolean) => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;
  updateScene: (sceneId: number, patch: Partial<Scene>) => void;
  setStyleBible: (b: StyleBible | null) => void;
  setProjects: (ps: Project[]) => void;
  setHardware: (h: HardwareInfo) => void;
  setModels: (m: ModelInfo[]) => void;
  setTasks: (t: QueueTask[]) => void;
  setMemory: (m: MemoryState) => void;
  log: (msg: string, level?: LogEntry['level']) => void;
  setBusy: (b: boolean) => void;
  setStatus: (s: string, stream?: string) => void;
  selectScene: (id: number | null) => void;
  setModal: (m: State['modal']) => void;
  setExportUrl: (u: string | null) => void;
  setAudioUrl: (sceneId: number, url: string | null) => void;
  resetMedia: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(p: Project) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void projectStore.save(p).catch((e) => console.error('save failed', e)), 300);
}

export const useStore = create<State>((set, get) => ({
  project: newProject(),
  projects: [],
  hardware: null,
  models: [],
  tasks: [],
  memory: null,
  logs: [],
  busy: false,
  statusText: 'Ready',
  streamText: '',
  selectedSceneId: null,
  modal: null,
  exportUrl: null,
  audioUrls: {},

  setProject: (p, persist = true) => {
    const next = typeof p === 'function' ? p(get().project) : p;
    set({ project: next });
    if (persist) schedulePersist(next);
  },
  updateSettings: (patch) => get().setProject((p) => ({ ...p, settings: { ...p.settings, ...patch } })),
  updateScene: (sceneId, patch) =>
    get().setProject((p) => (p.script ? { ...p, script: { ...p.script, scenes: p.script.scenes.map((s) => (s.sceneId === sceneId ? { ...s, ...patch } : s)) } } : p)),
  setStyleBible: (styleBible) => get().setProject((p) => ({ ...p, styleBible })),
  setProjects: (projects) => set({ projects }),
  setHardware: (hardware) => set({ hardware }),
  setModels: (models) => set({ models }),
  setTasks: (tasks) => set({ tasks }),
  setMemory: (memory) => set({ memory }),
  log: (msg, level = 'info') => set((s) => ({ logs: [...s.logs.slice(-299), { t: Date.now(), level, msg }] })),
  setBusy: (busy) => set({ busy }),
  setStatus: (statusText, streamText) => set({ statusText, ...(streamText !== undefined ? { streamText } : {}) }),
  selectScene: (selectedSceneId) => set({ selectedSceneId }),
  setModal: (modal) => set({ modal }),
  setExportUrl: (exportUrl) => {
    const old = get().exportUrl;
    if (old && old !== exportUrl) URL.revokeObjectURL(old);
    set({ exportUrl });
  },
  setAudioUrl: (sceneId, url) =>
    set((s) => {
      const old = s.audioUrls[sceneId];
      if (old && old !== url) URL.revokeObjectURL(old);
      const audioUrls = { ...s.audioUrls };
      if (url) audioUrls[sceneId] = url;
      else delete audioUrls[sceneId];
      return { audioUrls };
    }),
  resetMedia: () => {
    const s = get();
    Object.values(s.audioUrls).forEach((u) => URL.revokeObjectURL(u));
    if (s.exportUrl) URL.revokeObjectURL(s.exportUrl);
    set({ audioUrls: {}, exportUrl: null, selectedSceneId: null, streamText: '' });
  },
}));
