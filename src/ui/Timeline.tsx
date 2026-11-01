import { useState } from 'react';
import { useStore } from '../store';
import { cn } from '../utils/cn';
import { LocalityBadge } from './common';

const STATUS_COLORS: Record<string, string> = {
  waiting: 'border-zinc-700 bg-zinc-900 text-zinc-400',
  generating: 'border-sky-500 bg-sky-950/60 text-sky-200',
  completed: 'border-emerald-700 bg-emerald-950/50 text-emerald-200',
  failed: 'border-red-700 bg-red-950/50 text-red-200',
  skipped: 'border-zinc-800 bg-zinc-950 text-zinc-600 line-through',
};

const STAGES = ['script', 'master_prompt', 'images', 'tts', 'sync', 'render', 'export', 'done'] as const;

export function Timeline({ className, isMobileView }: { className?: string; isMobileView?: boolean }) {
  const { tasks, project, logs, statusText, streamText, memory, hardware } = useStore();
  const [tab, setTab] = useState<'queue' | 'log' | 'chunks'>('queue');
  const stageIdx = STAGES.indexOf(project.stage as (typeof STAGES)[number]);
  const counts = { waiting: 0, generating: 0, completed: 0, failed: 0, skipped: 0 } as Record<string, number>;
  tasks.forEach((t) => counts[t.status]++);

  return (
    <footer className={cn('flex shrink-0 flex-col border-t border-zinc-800 bg-zinc-950', isMobileView ? 'h-full w-full border-t-0 pb-24' : 'h-56', className)}>
      {isMobileView && (
        <div className="border-b border-zinc-800 p-3 bg-zinc-900/60">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
              <span className="text-[10px] text-zinc-500 uppercase block">VRAM / Bellek</span>
              <span className="font-semibold text-zinc-200">
                {memory?.currentModel ? memory.currentModel.name : 'Boşta'}
              </span>
              <span className="block text-[10px] text-zinc-400">
                {memory?.vramUsedBytes ? `${(memory.vramUsedBytes / 1e9).toFixed(1)} GB` : '0 GB'}
              </span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
              <span className="text-[10px] text-zinc-500 uppercase block">Donanım</span>
              <span className="font-semibold text-zinc-200">
                WebGPU: {hardware?.webgpu ? 'Aktif' : 'Yok'}
              </span>
              <span className="block text-[10px] text-zinc-400">
                {hardware?.tier.toUpperCase()} Seviye
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 sm:px-4 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto max-w-[280px] sm:max-w-none">
          {STAGES.filter((s) => s !== 'done').map((s, i) => (
            <div key={s} className="flex items-center gap-1 shrink-0">
              <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider', i < stageIdx || project.stage === 'done' ? 'bg-emerald-900/60 text-emerald-300' : i === stageIdx ? 'bg-sky-900/70 text-sky-200 animate-pulse' : 'bg-zinc-900 text-zinc-600')}>
                {s.replace('_', ' ')}
              </span>
              {i < STAGES.length - 2 && <span className="text-zinc-700">›</span>}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] text-zinc-500">
            <span>bekleyen {counts.waiting}</span>
            <span className="text-sky-400">üretilen {counts.generating}</span>
            <span className="text-emerald-400">tamam {counts.completed}</span>
            {counts.failed > 0 && <span className="text-red-400">hata {counts.failed}</span>}
          </div>
          <div className="flex gap-1">
            {(['queue', 'log', 'chunks'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn('rounded px-2 py-0.5 text-[10px] uppercase tracking-wider', tab === t ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-500 hover:text-zinc-300')}>
                {t === 'queue' ? 'Kuyruk' : t === 'log' ? 'Log' : 'Parçalar'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="truncate border-b border-zinc-900 px-3 sm:px-4 py-1 text-[11px] text-zinc-400 bg-zinc-950/80">
        <span className="text-zinc-500">Durum:</span> {statusText}
      </div>
      <div className="flex-1 overflow-auto p-2">
        {tab === 'queue' && (
          <div className="flex flex-wrap gap-1.5">
            {tasks.length === 0 && <p className="p-2 text-[11px] text-zinc-600">Generation queue is empty. Tasks run strictly one at a time (script → master prompt → scene images → TTS → render).</p>}
            {tasks.map((t, i) => (
              <div key={t.id} className={cn('relative flex min-w-[150px] max-w-[260px] flex-col gap-0.5 overflow-hidden rounded border px-2 py-1 text-[10px]', STATUS_COLORS[t.status])} title={t.error}>
                {t.status === 'generating' && t.progress != null && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-sky-400" style={{ width: `${Math.round(t.progress * 100)}%` }} />}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] opacity-60">{i + 1}</span>
                  <LocalityBadge locality={t.locality} />
                </div>
                <span className="truncate font-medium">{t.label}</span>
                <span className="uppercase tracking-wider opacity-70">
                  {t.status}
                  {t.status === 'generating' && t.progress != null && t.progress > 0 ? ` ${Math.round(t.progress * 100)}%` : ''}
                </span>
                {t.error && <span className="truncate text-red-300">{t.error}</span>}
              </div>
            ))}
          </div>
        )}
        {tab === 'log' && (
          <div className="font-mono text-[10px] leading-relaxed">
            {streamText && <pre className="mb-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-2 text-sky-200/80">{streamText.slice(-1500)}</pre>}
            {logs
              .slice()
              .reverse()
              .map((l, i) => (
                <div key={i} className={cn(l.level === 'error' ? 'text-red-300' : l.level === 'warn' ? 'text-amber-300' : 'text-zinc-400')}>
                  <span className="text-zinc-600">{new Date(l.t).toLocaleTimeString()} </span>
                  {l.msg}
                </div>
              ))}
          </div>
        )}
        {tab === 'chunks' && (
          <div className="flex flex-wrap gap-1.5">
            {project.chunks.length === 0 && <p className="p-2 text-[11px] text-zinc-600">Render chunks ({project.settings.chunkSeconds}s each) appear here. Completed chunks are persisted and reused when resuming.</p>}
            {project.chunks.map((c) => (
              <div key={c.index} className={cn('rounded border px-2 py-1 text-[10px]', c.status === 'done' ? STATUS_COLORS.completed : c.status === 'rendering' ? STATUS_COLORS.generating : c.status === 'failed' ? STATUS_COLORS.failed : STATUS_COLORS.waiting)}>
                <div className="font-medium">Chunk {c.index + 1}</div>
                <div className="font-mono opacity-70">
                  {fmt(c.startTime)}–{fmt(c.endTime)}
                </div>
                <div className="uppercase tracking-wider opacity-70">{c.status}{c.frameCount ? ` · ${c.frameCount}f` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
