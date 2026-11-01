import { useEffect, useState } from 'react';
import { defaultSettings, newProject, useStore } from '../store';
import type { Project } from '../types';
import { blobStore, chunkStore, projectStore } from '../storage/projectStore';
import { formatTime } from '../utils/fileUtils';
import { Badge, Btn, Modal } from './common';
import { resumeProject } from '../core/pipeline';

/** Loads a project from IndexedDB and rehydrates object URLs for images, audio and export. */
export async function openProject(p: Project) {
  const st = useStore.getState();
  st.resetMedia();
  const settings = { ...defaultSettings(), ...p.settings };
  // scenes that were mid-flight when the app closed must not look "in progress"
  const script = p.script
    ? { ...p.script, scenes: p.script.scenes.map((s) => (s.ttsStatus === 'generating' || s.ttsStatus === 'recovering' ? { ...s, ttsStatus: 'pending' as const } : s)) }
    : null;
  st.setProject({ ...p, settings, script }, false);
  for (const s of p.script?.scenes ?? []) {
    const id = String(s.sceneId).padStart(3, '0');
    const wav = await blobStore.get(blobStore.key(p.id, 'tts', `scene_${id}.wav`));
    if (wav) st.setAudioUrl(s.sceneId, URL.createObjectURL(wav));
  }
  const exp = await blobStore.get(blobStore.key(p.id, 'export', 'final'));
  if (exp) st.setExportUrl(URL.createObjectURL(exp));
  // detect completed chunks for resume
  const done = await chunkStore.listIndexes(p.id);
  if (p.chunks.length) st.setProject((pp) => ({ ...pp, chunks: pp.chunks.map((c) => ({ ...c, status: done.includes(c.index) ? 'done' : c.status === 'done' ? 'pending' : c.status })) }), false);
  st.log(`Opened project "${p.name}" (${p.stage}). ${done.length} completed render chunk(s) found.`);
}

export function ProjectManager({ onClose }: { onClose: () => void }) {
  const { project, projects, setProjects, setProject, resetMedia, busy, log } = useStore();
  const [name, setName] = useState('');
  useEffect(() => {
    void projectStore.list().then(setProjects);
  }, [setProjects, project.updatedAt]);

  const create = async () => {
    const p = newProject(name.trim() || 'Untitled project');
    // keep model selections from the current project for convenience
    p.settings.llmModelId = project.settings.llmModelId;
    p.settings.visualStyle = project.settings.visualStyle;
    p.settings.ttsModelId = project.settings.ttsModelId;
    p.settings.voice = project.settings.voice;
    resetMedia();
    setProject(p);
    await projectStore.save(p);
    setProjects(await projectStore.list());
    setName('');
    onClose();
  };

  const resumable = (p: Project) => p.script && p.stage !== 'done' && p.stage !== 'idle';

  return (
    <Modal title="Projects" onClose={onClose}>
      <div className="mb-4 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500" />
        <Btn variant="primary" onClick={() => void create()} disabled={busy}>
          NEW PROJECT
        </Btn>
        <Btn onClick={() => void projectStore.save(project).then(() => log('Project saved.'))}>SAVE</Btn>
      </div>
      <div className="space-y-1.5">
        {projects.length === 0 && <p className="text-xs text-zinc-500">No saved projects yet. Everything is stored in this browser's IndexedDB.</p>}
        {projects.map((p) => (
          <div key={p.id} className={`flex items-center gap-2 rounded-md border px-3 py-2 ${p.id === project.id ? 'border-emerald-700 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/50'}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-semibold text-zinc-100">{p.name}</span>
                <Badge tone={p.stage === 'done' ? 'green' : p.stage === 'failed' ? 'red' : 'zinc'}>{p.stage}</Badge>
              </div>
              <div className="truncate text-[10px] text-zinc-500">
                {p.settings.topic || 'no topic'} · {formatTime(p.settings.durationSec)} · {p.settings.aspectRatio} · {p.script?.scenes.length ?? 0} scenes · {new Date(p.updatedAt).toLocaleString()}
              </div>
            </div>
            <Btn size="sm" disabled={busy} onClick={() => void openProject(p).then(onClose)}>
              OPEN
            </Btn>
            {resumable(p) && (
              <Btn
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  await openProject(p);
                  onClose();
                  void resumeProject();
                }}
              >
                RESUME
              </Btn>
            )}
            <Btn
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`Delete project "${p.name}" and all its local assets?`)) return;
                await projectStore.delete(p.id);
                if (p.id === project.id) {
                  resetMedia();
                  setProject(newProject());
                }
                setProjects(await projectStore.list());
              }}
            >
              DELETE
            </Btn>
          </div>
        ))}
      </div>
    </Modal>
  );
}
