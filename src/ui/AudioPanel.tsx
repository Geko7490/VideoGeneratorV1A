import { useState } from 'react';
import { useStore } from '../store';
import type { SfxAsset } from '../types';
import { blobStore } from '../storage/projectStore';
import { decodeAudioBlob, uid } from '../utils/fileUtils';
import { Btn, Field, inputCls, Modal, Select, Toggle } from './common';

const ACCEPT = 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.wav,.m4a';

function Num({ label, value, onChange, step = 0.1, min = 0, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <Field label={label}>
      <input type="number" step={step} min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} className={inputCls} />
    </Field>
  );
}

export function AudioPanel({ onClose }: { onClose: () => void }) {
  const { project, updateSettings, log } = useStore();
  const m = project.settings.music;
  const [musicDur, setMusicDur] = useState<number | null>(null);
  const scenes = project.script?.scenes ?? [];

  const importMusic = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a)$/i.test(file.name)) return log('Only audio files are accepted.', 'warn');
    try {
      const buf = await decodeAudioBlob(file); // validates that it is decodable media
      await blobStore.put(blobStore.key(project.id, 'music', file.name), file);
      setMusicDur(buf.duration);
      updateSettings({ music: { ...m, enabled: true, fileName: file.name } });
      log(`Imported music ${file.name} (${buf.duration.toFixed(1)}s). Stored locally.`);
    } catch {
      log('Could not decode this audio file in the browser (M4A/AAC support varies).', 'error');
    }
  };

  const importSfx = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg)$/i.test(file.name)) return log('Only audio files are accepted.', 'warn');
    try {
      await decodeAudioBlob(file);
      await blobStore.put(blobStore.key(project.id, 'sfx', file.name), file);
      const asset: SfxAsset = { id: uid('sfx_'), name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, volume: 0.8, startTime: 0, trimStart: 0, trimEnd: null, fade: 0.05, sceneId: null };
      updateSettings({ sfx: [...project.settings.sfx, asset] });
      log(`Imported SFX ${file.name}.`);
    } catch {
      log('Could not decode this SFX file.', 'error');
    }
  };

  const patchSfx = (id: string, patch: Partial<SfxAsset>) => updateSettings({ sfx: project.settings.sfx.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  // scene start times from measured durations (same logic as the compositor)
  const sceneStarts: Record<number, number> = {};
  let t = 0;
  for (const s of scenes) {
    sceneStarts[s.sceneId] = t;
    t += Math.max(1.5, (s.actualDuration ?? s.durationEstimate) + 0.35);
  }

  return (
    <Modal title="Music & SFX" onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-100">Background music</h3>
            <Toggle on={m.enabled} onChange={(v) => updateSettings({ music: { ...m, enabled: v } })} />
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Import local file (MP3 / WAV / M4A)</span>
            <input type="file" accept={ACCEPT} onChange={(e) => void importMusic(e.target.files?.[0] ?? null)} className="block w-full text-xs text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-200" />
          </label>
          <p className="text-[10px] text-zinc-500">
            {m.fileName ? `Current: ${m.fileName}${musicDur ? ` · ${musicDur.toFixed(1)}s` : ''}` : 'No music imported. The app never downloads music automatically.'}
            {project.script?.musicMood && <span className="block">LLM suggested mood: <i>{project.script.musicMood}</i></span>}
          </p>
          <Field label={`Volume ${Math.round(m.volume * 100)}%`}>
            <input type="range" min={0} max={1} step={0.01} value={m.volume} onChange={(e) => updateSettings({ music: { ...m, volume: +e.target.value } })} className="w-full accent-emerald-500" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Trim start (s)" value={m.trimStart} onChange={(v) => updateSettings({ music: { ...m, trimStart: v } })} />
            <Num label="Trim end (s, 0 = full)" value={m.trimEnd ?? 0} onChange={(v) => updateSettings({ music: { ...m, trimEnd: v > 0 ? v : null } })} />
            <Num label="Fade in (s)" value={m.fadeIn} onChange={(v) => updateSettings({ music: { ...m, fadeIn: v } })} />
            <Num label="Fade out (s)" value={m.fadeOut} onChange={(v) => updateSettings({ music: { ...m, fadeOut: v } })} />
          </div>
          <Toggle label="Loop to fill video" on={m.loop} onChange={(v) => updateSettings({ music: { ...m, loop: v } })} />
          <Toggle label="Voice ducking (lower music under narration)" on={m.ducking} onChange={(v) => updateSettings({ music: { ...m, ducking: v } })} />
          {m.ducking && (
            <Field label={`Duck level ${Math.round(m.duckLevel * 100)}%`}>
              <input type="range" min={0} max={1} step={0.01} value={m.duckLevel} onChange={(e) => updateSettings({ music: { ...m, duckLevel: +e.target.value } })} className="w-full accent-emerald-500" />
            </Field>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 p-3">
          <h3 className="text-xs font-semibold text-zinc-100">Sound effects</h3>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Import SFX (whoosh.wav, impact.wav, heartbeat.wav …)</span>
            <input type="file" accept={ACCEPT + ',.ogg'} onChange={(e) => void importSfx(e.target.files?.[0] ?? null)} className="block w-full text-xs text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-200" />
          </label>
          {scenes.some((s) => s.spec.effects.length > 0) && (
            <p className="text-[10px] text-zinc-500">
              Scene effects that usually want a sound: {scenes.filter((s) => s.spec.effects.length).slice(0, 8).map((s) => `S${s.sceneId}: ${s.spec.effects.join('/')}`).join(' · ')}
            </p>
          )}
          {project.settings.sfx.length === 0 && <p className="text-[10px] text-zinc-500">No SFX imported. Files are treated strictly as media and stored locally.</p>}
          {project.settings.sfx.map((a) => (
            <div key={a.id} className="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">{a.name}</span>
                <Btn size="sm" variant="danger" onClick={() => updateSettings({ sfx: project.settings.sfx.filter((x) => x.id !== a.id) })}>
                  Remove
                </Btn>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Attach to scene start">
                  <Select
                    value={a.sceneId != null ? String(a.sceneId) : ''}
                    onChange={(v) => {
                      const id = v ? +v : null;
                      patchSfx(a.id, { sceneId: id, startTime: id != null ? sceneStarts[id] ?? 0 : a.startTime });
                    }}
                    options={[{ value: '', label: 'Manual time' }, ...scenes.map((s) => ({ value: String(s.sceneId), label: `Scene ${s.sceneId}${s.spec.effects.length ? ` (${s.spec.effects[0]})` : ''}` }))]}
                  />
                </Field>
                <Num label="Start time (s)" value={+a.startTime.toFixed(2)} onChange={(v) => patchSfx(a.id, { startTime: v, sceneId: null })} step={0.05} />
                <Num label="Volume" value={a.volume} onChange={(v) => patchSfx(a.id, { volume: v })} step={0.05} max={2} />
                <Num label="Fade (s)" value={a.fade} onChange={(v) => patchSfx(a.id, { fade: v })} step={0.05} />
                <Num label="Trim start (s)" value={a.trimStart} onChange={(v) => patchSfx(a.id, { trimStart: v })} />
                <Num label="Trim end (s, 0 = full)" value={a.trimEnd ?? 0} onChange={(v) => patchSfx(a.id, { trimEnd: v > 0 ? v : null })} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-[10px] text-zinc-500">Audio is mixed offline with Web Audio (OfflineAudioContext) and encoded together with the frames. Changing audio settings requires Render / Re-export.</p>
    </Modal>
  );
}
