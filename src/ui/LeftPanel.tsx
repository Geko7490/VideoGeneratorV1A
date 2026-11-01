import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { AspectRatio, CaptionMode, CaptionStyle, Language, QualityPreset } from '../types';
import { resolveQuality } from '../types';
import { CHARACTER_MODES, MODE_LABELS, STYLE_LABELS, VISUAL_STYLES, type CharacterMode, type VisualStyle } from '../scene/types';
import { formatTime, parseDuration } from '../utils/fileUtils';
import { Badge, Btn, Field, inputCls, Select, Toggle } from './common';
import { modelManager } from '../models/modelManager';
import { KOKORO_VOICES } from '../models/tts/kokoroAdapter';
import { clearSceneCache } from '../scene/renderer';
import { CHUNK_OPTIONS } from '../utils/deviceProfile';
import { cn } from '../utils/cn';

const PRESETS = [
  { label: '30s', v: 30 },
  { label: '60s', v: 60 },
  { label: '5 min', v: 300 },
  { label: '10 min', v: 600 },
];

function PronunciationForm({ onAdd }: { onAdd: (word: string, speakAs: string) => void }) {
  const [word, setWord] = useState('');
  const [as, setAs] = useState('');
  return (
    <div className="flex gap-1">
      <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="word" className={inputCls} />
      <input value={as} onChange={(e) => setAs(e.target.value)} placeholder="speak as" className={inputCls} />
      <Btn size="sm" disabled={!word.trim() || !as.trim()} onClick={() => { onAdd(word.trim(), as.trim()); setWord(''); setAs(''); }}>Add</Btn>
    </div>
  );
}

export function LeftPanel({ className }: { className?: string }) {
  const { project, updateSettings, models, busy, setModal, setStyleBible, hardware } = useStore();
  const [advanced, setAdvanced] = useState(false);
  const s = project.settings;
  const [custom, setCustom] = useState(formatTime(s.durationSec));
  const [customErr, setCustomErr] = useState(false);
  const [voices, setVoices] = useState<{ id: string; name: string; language: Language }[]>(KOKORO_VOICES);
  const lock = busy || !!project.script;

  useEffect(() => setCustom(formatTime(s.durationSec)), [s.durationSec]);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!s.ttsModelId) return;
      try {
        const v = await modelManager.ttsAdapterFor(s.ttsModelId).listVoices(s.ttsModelId);
        if (alive && v.length) setVoices(v);
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      alive = false;
    };
  }, [s.ttsModelId]);

  const llms = useMemo(() => models.filter((m) => m.category === 'llm'), [models]);
  const ttss = useMemo(() => models.filter((m) => m.category === 'tts'), [models]);
  const modelOpts = (list: typeof models, empty: string) => [
    { value: '', label: empty, disabled: true },
    ...list.map((m) => ({ value: m.id, label: `${m.installed ? '' : '⬇ '}${m.name}` })),
  ];
  const voiceOpts = voices.filter((v) => v.language === s.language || voices.every((x) => x.language !== s.language));

  return (
    <aside className={cn('flex h-full w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-4 text-zinc-200', className)}>
      <Field label="Topic">
        <textarea rows={3} value={s.topic} disabled={lock} onChange={(e) => updateSettings({ topic: e.target.value })} placeholder="Why do we dream?" className={cn(inputCls, 'resize-none')} />
      </Field>

      <Field label="Duration" hint={formatTime(s.durationSec)}>
        <div className="mb-1.5 grid grid-cols-4 gap-1">
          {PRESETS.map((p) => (
            <button key={p.v} disabled={lock} onClick={() => updateSettings({ durationSec: p.v })} className={cn('rounded border px-1 py-1 text-[11px]', s.durationSec === p.v ? 'border-emerald-500 bg-emerald-950 text-emerald-300' : 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800', lock && 'opacity-50')}>
              {p.label}
            </button>
          ))}
        </div>
        <input
          value={custom}
          disabled={lock}
          onChange={(e) => {
            setCustom(e.target.value);
            const d = parseDuration(e.target.value);
            if (d && d >= 5 && d <= 3600) {
              setCustomErr(false);
              updateSettings({ durationSec: d });
            } else setCustomErr(true);
          }}
          placeholder="Custom mm:ss (e.g. 02:45)"
          className={cn(inputCls, customErr && 'border-red-500')}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Aspect ratio">
          <Select value={s.aspectRatio} disabled={busy} onChange={(v) => updateSettings({ aspectRatio: v as AspectRatio })} options={[{ value: '9:16', label: '9:16 · 1080×1920' }, { value: '16:9', label: '16:9 · 1920×1080' }, { value: '1:1', label: '1:1 · 1080×1080' }]} />
        </Field>
        <Field label="Language">
          <Select value={s.language} disabled={lock} onChange={(v) => updateSettings({ language: v as Language })} options={[{ value: 'en', label: 'English' }, { value: 'tr', label: 'Türkçe' }]} />
        </Field>
      </div>

      {/* ---- VISUAL ENGINE ---- */}
      <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-emerald-300">PROCEDURAL 2D SCENE ENGINE</span>
          <Badge tone="green">LOCAL</Badge>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
          Characters, environments, lighting, effects and camera are drawn in the browser from the LLM scene plan. <b className="text-emerald-400">No AI image generation.</b>
        </p>
        <div className="mt-2 space-y-2">
          <Field label="Character">
            <Select
              value={s.characterMode ?? 'auto'}
              disabled={lock}
              onChange={(v) => updateSettings({ characterMode: v as CharacterMode })}
              options={CHARACTER_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
            />
            <p className="mt-1 text-[10px] text-zinc-500">
              {s.characterMode === 'none'
                ? 'Scenes are built from places, objects, light and motion only.'
                : s.characterMode === 'required'
                ? 'Every scene gets at least one character.'
                : s.characterMode === 'optional'
                ? 'A character appears only when the narration needs one.'
                : 'The director decides per scene — empty rooms are allowed.'}
            </p>
          </Field>
          <Field label="Visual style">
            <Select
              value={s.visualStyle}
              disabled={busy}
              onChange={(v) => {
                updateSettings({ visualStyle: v as VisualStyle });
                if (project.styleBible) setStyleBible({ ...project.styleBible, style: v as VisualStyle });
                clearSceneCache();
              }}
              options={VISUAL_STYLES.map((v) => ({ value: v, label: STYLE_LABELS[v] }))}
            />
          </Field>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Toggle label="Lock style & cast" on={s.styleLockEnabled} onChange={(v) => updateSettings({ styleLockEnabled: v })} />
          <Btn size="sm" onClick={() => setModal('style')} disabled={!project.styleBible}>
            Edit cast
          </Btn>
        </div>
        <p className="mt-1 text-[10px] text-zinc-500">{s.styleLockEnabled ? 'One style + character bible is reused for every scene (continuity).' : 'The director may restyle each generation.'}</p>
      </div>

      {/* ---- MODELS ---- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Local models</span>
          <Btn size="sm" variant="ghost" onClick={() => setModal('models')}>
            Model Manager →
          </Btn>
        </div>
        <Field label="LLM (story & scene director)">
          <Select value={s.llmModelId} disabled={busy} onChange={(v) => updateSettings({ llmModelId: v })} options={modelOpts(llms, llms.length ? 'Select LLM…' : 'WebGPU required')} />
        </Field>
        <Field label="TTS model">
          <Select value={s.ttsModelId} disabled={busy} onChange={(v) => updateSettings({ ttsModelId: v })} options={modelOpts(ttss, 'Select TTS…')} />
        </Field>
        <Field label="Voice">
          <Select value={s.voice} disabled={busy} onChange={(v) => updateSettings({ voice: v })} options={voiceOpts.length ? voiceOpts.map((v) => ({ value: v.id, label: v.name })) : [{ value: s.voice, label: s.voice }]} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Speed" hint={s.ttsSpeed.toFixed(2)}>
            <input type="range" min={0.6} max={1.5} step={0.05} value={s.ttsSpeed} onChange={(e) => updateSettings({ ttsSpeed: +e.target.value })} className="w-full accent-emerald-500" />
          </Field>
          <Field label="Pitch" hint={`${s.ttsPitch}`}>
            <input type="range" min={-5} max={5} step={1} value={s.ttsPitch} onChange={(e) => updateSettings({ ttsPitch: +e.target.value })} className="w-full accent-emerald-500" title="Only applied when the engine supports pitch" />
          </Field>
          <Field label="Volume" hint={`${Math.round(s.ttsVolume * 100)}%`}>
            <input type="range" min={0.2} max={1.5} step={0.05} value={s.ttsVolume} onChange={(e) => updateSettings({ ttsVolume: +e.target.value })} className="w-full accent-emerald-500" />
          </Field>
        </div>
      </div>

      <Field label="Quality" hint={s.quality === 'auto' ? `auto → ${resolveQuality('auto', hardware)}` : `${s.fps} fps`}>
        <div className="grid grid-cols-5 gap-1">
          {(['auto', 'low', 'medium', 'high', 'ultra'] as QualityPreset[]).map((q) => (
            <button
              key={q}
              disabled={busy}
              onClick={() => updateSettings({ quality: q, fps: q === 'low' ? 24 : 30 })}
              className={cn('rounded border px-0.5 py-1 text-[10px] uppercase', s.quality === q ? 'border-emerald-500 bg-emerald-950 text-emerald-300' : 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800')}
            >
              {q}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-zinc-500">AUTO picks a tier from this device. LOW halves the render resolution and particle count for phones.</p>
      </Field>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60">
        <button onClick={() => setAdvanced(!advanced)} className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-zinc-200">
          <span>Advanced scene engine</span>
          <span className="text-zinc-500">{advanced ? '▾' : '▸'}</span>
        </button>
        {advanced && (
          <div className="space-y-2 border-t border-zinc-800 p-3">
            <Field label="Scene detail" hint={`${Math.round((s.sceneDetail ?? 1) * 100)}%`}>
              <input type="range" min={0.4} max={1.4} step={0.05} value={s.sceneDetail ?? 1} onChange={(e) => { updateSettings({ sceneDetail: +e.target.value }); clearSceneCache(); }} className="w-full accent-emerald-500" />
            </Field>
            <Toggle label="Animation" on={s.animationEnabled !== false} onChange={(v) => updateSettings({ animationEnabled: v })} />
            <Toggle label="Effects / atmosphere" on={s.effectsEnabled !== false} onChange={(v) => updateSettings({ effectsEnabled: v })} />
            <Toggle label="Lighting" on={s.lightingEnabled !== false} onChange={(v) => updateSettings({ lightingEnabled: v })} />
            <Toggle label="Camera motion" on={s.cameraMotionEnabled !== false} onChange={(v) => updateSettings({ cameraMotionEnabled: v })} />
            <Toggle label="Parallax depth" on={s.parallaxEnabled !== false} onChange={(v) => updateSettings({ parallaxEnabled: v })} />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <Field label="MASTER SEED" hint={s.lockSeed ? 'locked' : 'random'}>
          <div className="flex gap-1">
            <input type="number" value={s.masterSeed} disabled={busy} onChange={(e) => updateSettings({ masterSeed: +e.target.value })} className={inputCls} />
            <Btn size="sm" onClick={() => { updateSettings({ masterSeed: Math.floor(Math.random() * 1_000_000) }); clearSceneCache(); }} title="Randomize">🎲</Btn>
            <Btn size="sm" onClick={() => void navigator.clipboard?.writeText(String(s.masterSeed))} title="Copy">⧉</Btn>
          </div>
        </Field>
        <div className="mt-2">
          <Toggle label="Lock seed (deterministic scenes)" on={s.lockSeed} onChange={(v) => updateSettings({ lockSeed: v })} />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
        <Toggle label="Captions" on={s.captionsEnabled} onChange={(v) => updateSettings({ captionsEnabled: v })} />
        {s.captionsEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <Select value={s.captionStyle} onChange={(v) => updateSettings({ captionStyle: v as CaptionStyle })} options={['clean', 'bold', 'shorts', 'tiktok', 'minimal', 'cinematic'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} />
            <Select value={s.captionMode} onChange={(v) => updateSettings({ captionMode: v as CaptionMode })} options={[{ value: 'word', label: 'Word-by-word' }, { value: 'phrase', label: 'Phrase' }, { value: 'standard', label: 'Subtitles' }]} />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Music &amp; SFX</span>
          <Btn size="sm" onClick={() => setModal('audio')}>Configure</Btn>
        </div>
        <p className="mt-1 text-[10px] text-zinc-500">Music: {s.music.enabled && s.music.fileName ? s.music.fileName : 'none'} · SFX: {s.sfx.length}</p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Pronunciation</span>
          <Badge>{s.pronunciation.length}</Badge>
        </div>
        <div className="mt-2 space-y-1">
          {s.pronunciation.map((r) => (
            <div key={r.id} className="flex items-center gap-1 text-[10px]">
              <span className="flex-1 truncate text-zinc-300">{r.word} → {r.speakAs}</span>
              <Btn size="sm" variant="danger" onClick={() => updateSettings({ pronunciation: s.pronunciation.filter((x) => x.id !== r.id) })}>×</Btn>
            </div>
          ))}
          <PronunciationForm onAdd={(word, speakAs) => updateSettings({ pronunciation: [...s.pronunciation, { id: 'pr_' + Date.now(), word, speakAs, language: s.language }] })} />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <Field label="Chunk size" hint={`${s.chunkSeconds}s`}>
          <Select
            value={String(s.chunkSeconds)}
            disabled={busy}
            onChange={(v) => updateSettings({ chunkSeconds: +v })}
            options={CHUNK_OPTIONS.map((c) => ({ value: String(c), label: `${c}s chunks${c === 30 ? ' · recommended' : ''}` }))}
          />
          <p className="mt-1 text-[10px] text-zinc-500">Smaller chunks use less memory but may increase processing time.</p>
        </Field>
      </div>
    </aside>
  );
}
