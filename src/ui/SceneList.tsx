import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { cn } from '../utils/cn';
import { Badge, Btn } from './common';
import { regenerateScenePlan, regenerateTTS } from '../core/pipeline';
import { renderScene } from '../scene/renderer';
import type { Scene, StyleBible } from '../types';

function dot(status: string) {
  return status === 'done'
    ? 'bg-emerald-400'
    : status === 'generating'
    ? 'bg-sky-400 animate-pulse'
    : status === 'recovering'
    ? 'bg-amber-400 animate-pulse'
    : status === 'failed' || status === 'invalid'
    ? 'bg-red-500'
    : status === 'skipped'
    ? 'bg-zinc-600'
    : 'bg-zinc-700';
}

/** Tiny static thumbnail rendered by the procedural engine (cheap: one frame, low quality). */
function Thumb({ scene, bible, seed, w, h }: { scene: Scene; bible: StyleBible | null; seed: number; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sig = JSON.stringify(scene.spec);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    try {
      renderScene(ctx, { spec: scene.spec, bible, t: 0.6, progress: 0.3, W: w, H: h, quality: 'low', projectSeed: seed });
    } catch {
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, w, h);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, bible, seed, w, h]);
  return <canvas ref={ref} width={w} height={h} className="h-full w-full object-cover" />;
}

export function SceneList({ className }: { className?: string }) {
  const { project, selectedSceneId, selectScene, busy } = useStore();
  const scenes = project.script?.scenes ?? [];
  const ttsDone = scenes.filter((s) => s.ttsStatus === 'done').length;
  const pendingTts = scenes.filter((s) => s.ttsStatus !== 'done' && s.ttsStatus !== 'skipped').map((s) => s.sceneId);
  const ar = project.settings.aspectRatio;
  const tw = ar === '16:9' ? 72 : ar === '1:1' ? 48 : 40;
  const th = ar === '16:9' ? 40 : ar === '1:1' ? 48 : 56;

  return (
    <aside className={cn('flex h-full w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950', className)}>
      <div className="border-b border-zinc-800 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Scenes</h3>
          {scenes.length > 0 && <span className="text-[10px] text-zinc-500">tts {ttsDone}/{scenes.length}</span>}
        </div>
        {project.script && (
          <div className="mt-1 truncate text-xs font-semibold text-zinc-200" title={project.script.title}>
            {project.script.title}
          </div>
        )}
        {scenes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <Btn size="sm" disabled={busy} onClick={() => void regenerateScenePlan()} title="Ask the LLM for a new scene plan (same topic, same locked style)">
              Re-direct scenes
            </Btn>
            {pendingTts.length > 0 && (
              <Btn size="sm" disabled={busy} onClick={() => void regenerateTTS(pendingTts)}>Retry {pendingTts.length} TTS</Btn>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {scenes.length === 0 && <p className="p-3 text-center text-[11px] text-zinc-600">The scene plan appears here after the local LLM directs the story.</p>}
        {scenes.map((s) => (
          <button
            key={s.sceneId}
            onClick={() => selectScene(s.sceneId)}
            className={cn('mb-1.5 flex w-full gap-2 rounded-md border p-2 text-left transition', selectedSceneId === s.sceneId ? 'border-emerald-600 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80')}
          >
            <div className="shrink-0 overflow-hidden rounded bg-zinc-800" style={{ width: tw, height: th }}>
              <Thumb scene={s} bible={project.styleBible} seed={project.settings.masterSeed} w={tw} h={th} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-200">Scene {String(s.sceneId).padStart(2, '0')}</span>
                <span className="font-mono text-[10px] text-zinc-500">{s.actualDuration != null ? `${s.actualDuration.toFixed(1)}s` : `~${s.durationEstimate.toFixed(1)}s`}</span>
              </div>
              <p className="line-clamp-2 text-[10px] leading-snug text-zinc-400">{s.voiceover}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-zinc-500">
                <span className="flex items-center gap-1">
                  <i className={cn('inline-block h-1.5 w-1.5 rounded-full', dot(s.ttsStatus))} /> tts
                </span>
                <span className="truncate">{s.spec.environment.type}</span>
                <span className="truncate">{s.spec.camera.shot}</span>
                {s.spec.characters[0] && <span className="truncate text-emerald-500/80">{s.spec.characters[0].emotion}</span>}
              </div>
              {s.ttsStatus === 'recovering' && <Badge tone="amber">recovering</Badge>}
              {s.ttsStatus === 'failed' && <Badge tone="red">failed</Badge>}
              {s.ttsStatus === 'invalid' && <Badge tone="red">invalid</Badge>}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
