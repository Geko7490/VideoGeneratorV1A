import { useEffect, useState } from 'react';
import { Dashboard } from './ui/Dashboard';
import { useStore } from './store';
import { detectHardware } from './utils/hardware';
import { modelManager } from './models/modelManager';
import { queueManager } from './core/queueManager';
import { memoryManager } from './utils/memoryManager';
import { kvStore, projectStore } from './storage/projectStore';
import { openProject } from './ui/ProjectManager';
import { KOKORO_MODEL_ID } from './models/tts/kokoroAdapter';

export default function App() {
  const [booted, setBooted] = useState(false);
  const [bootMsg, setBootMsg] = useState('Detecting hardware…');

  useEffect(() => {
    const st = useStore.getState();
    const unsubs = [
      queueManager.subscribe((t) => useStore.getState().setTasks(t)),
      memoryManager.subscribe((m) => useStore.getState().setMemory(m)),
      modelManager.subscribe(() => useStore.getState().setModels([...modelManager.models])),
    ];
    (async () => {
      const hw = await detectHardware();
      st.setHardware(hw);
      const { setCachedHardware } = await import('./utils/hardware');
      setCachedHardware(hw);
      memoryManager.setVram(null, hw.tier === 'high' ? 10 * 1024 ** 3 : hw.tier === 'medium' ? 8 * 1024 ** 3 : 4 * 1024 ** 3);
      st.log(`Hardware: WebGPU ${hw.webgpu ? 'available' : 'unavailable'}${hw.webgpuAdapter ? ` (${hw.webgpuAdapter})` : ''}, RAM≥${hw.deviceMemoryGB ?? '?'}GB, ${hw.cpuCores ?? '?'} cores, H.264 ${hw.h264 ? 'yes' : 'no'}, AAC ${hw.aac ? 'yes' : 'no'} → ${hw.tier.toUpperCase()} tier`);
      setBootMsg('Scanning local models on this device…');
      // Startup scan: detect models already installed in persistent storage and verify them.
      // Nothing is downloaded here — installed models are marked READY and reused directly.
      await modelManager.init(hw.webgpu, hw);
      const ready = modelManager.stateList().filter((m) => m.status === 'READY');
      const attention = modelManager.stateList().filter((m) => m.status === 'CORRUPTED' || m.status === 'PAUSED' || m.status === 'FAILED');
      st.log(
        `Local models: ${ready.length} ready${ready.length ? ` (${ready.map((m) => m.name).join(', ')})` : ''}` +
          `${attention.length ? ` · ${attention.length} need attention` : ''} · persistent storage ${modelManager.storage.persisted ? 'granted' : 'best-effort'}`,
      );
      // restore last project
      const lastId = await kvStore.get<string>('lastProjectId');
      const last = lastId ? await projectStore.get(lastId) : undefined;
      if (last) await openProject(last);
      else {
        const list = await projectStore.list();
        if (list[0]) await openProject(list[0]);
      }
      // sensible defaults for model selection if none chosen
      const p = useStore.getState().project;
      const models = modelManager.models;
      const patch: Partial<typeof p.settings> = {};
      if (!p.settings.llmModelId || !models.some((m) => m.id === p.settings.llmModelId)) {
        const llm = models.filter((m) => m.category === 'llm').sort((a, b) => Number(b.installed) - Number(a.installed))[0];
        if (llm) patch.llmModelId = llm.id;
      }
      if (!p.settings.ttsModelId || !models.some((m) => m.id === p.settings.ttsModelId)) {
        const tts = models.find((m) => m.id === KOKORO_MODEL_ID) ?? models.find((m) => m.category === 'tts');
        if (tts) patch.ttsModelId = tts.id;
      }
      if (hw.tier === 'low') {
        patch.quality = 'low';
        patch.fps = 24;
      }
      if (Object.keys(patch).length) useStore.getState().updateSettings(patch);
      setBooted(true);
    })().catch((e) => {
      useStore.getState().log('Startup problem (continuing): ' + (e as Error).message, 'warn');
      setBooted(true);
    });
    return () => unsubs.forEach((u) => u());
  }, []);

  // remember last project id
  const projectId = useStore((s) => s.project.id);
  useEffect(() => {
    void kvStore.set('lastProjectId', projectId);
  }, [projectId]);

  // warn before closing while busy (project state is persisted after every stage anyway)
  const busy = useStore((s) => s.busy);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (busy) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [busy]);

  if (!booted)
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-300">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400" />
          <p className="text-sm">{bootMsg}</p>
          <p className="mt-1 text-[11px] text-zinc-500">Local / offline AI video generator · no cloud APIs</p>
        </div>
      </div>
    );
  return <Dashboard />;
}
