import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { RESOLUTIONS, QUALITY_DETAIL, resolveQuality } from '../types';
import { buildTimeline, Compositor, type Timeline } from '../video/compositor';
import { blobStore } from '../storage/projectStore';
import { formatTime, saveBlobToDisk } from '../utils/fileUtils';
import { SHOT_LABELS, MOVE_LABELS } from '../scene/types';
import { Badge, Btn } from './common';
import { renderOnly } from '../core/pipeline';
import { cn } from '../utils/cn';

const PREVIEW_SCALE = 0.38;

export function Preview({ className }: { className?: string }) {
  const { project, audioUrls, exportUrl, busy, selectedSceneId, hardware } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showExport, setShowExport] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playStartRef = useRef<{ wall: number; t: number } | null>(null);
  const nodesRef = useRef<AudioBufferSourceNode[]>([]);

  const { width, height } = RESOLUTIONS[project.settings.aspectRatio];
  const pw = Math.round(width * PREVIEW_SCALE);
  const ph = Math.round(height * PREVIEW_SCALE);

  const compositor = useMemo(
    () =>
      new Compositor({
        width: pw,
        height: ph,
        aspect: project.settings.aspectRatio,
        captionsEnabled: project.settings.captionsEnabled,
        captionStyle: project.settings.captionStyle,
        quality: resolveQuality(project.settings.quality, hardware),
        styleBible: project.styleBible,
        masterSeed: project.settings.masterSeed,
        engine: {
          animation: project.settings.animationEnabled !== false,
          effects: project.settings.effectsEnabled !== false,
          lighting: project.settings.lightingEnabled !== false,
          parallax: project.settings.parallaxEnabled !== false,
          cameraMotion: project.settings.cameraMotionEnabled !== false,
          sceneDetail: (project.settings.sceneDetail ?? 1) * QUALITY_DETAIL[resolveQuality(project.settings.quality, hardware)],
        },
      }),
    [pw, ph, project.settings.aspectRatio, project.settings.captionsEnabled, project.settings.captionStyle, project.settings.quality, project.styleBible, project.settings.masterSeed],
  );

  const sceneSig = JSON.stringify(project.script?.scenes.map((s) => [s.sceneId, s.ttsStatus, s.actualDuration, s.spec.camera.movement, s.spec.environment.type, s.wordTimings.length]) ?? []);
  useEffect(() => {
    if (!project.script) {
      setTimeline(null);
      return;
    }
    setTimeline(buildTimeline(project.script.scenes, project.settings.captionMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneSig, project.settings.captionMode]);

  useEffect(() => {
    if (!timeline || selectedSceneId == null) return;
    const ts = timeline.scenes.find((s) => s.scene.sceneId === selectedSceneId);
    if (ts) {
      stop();
      setT(ts.start + 0.7);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSceneId]);

  // draw current frame
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    if (!timeline || !timeline.scenes.length) {
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, pw, ph);
      return;
    }
    compositor.render(ctx, timeline, Math.min(t, timeline.totalDuration - 0.001));
  }, [t, timeline, compositor, pw, ph]);

  // playback loop (rAF, never blocks the UI thread with heavy work)
  useEffect(() => {
    if (!playing || !timeline) return;
    let raf = 0;
    const loop = () => {
      const ps = playStartRef.current;
      if (!ps) return;
      const nt = ps.t + (performance.now() - ps.wall) / 1000;
      if (nt >= timeline.totalDuration) {
        stop();
        setT(0);
        return;
      }
      setT(nt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline]);

  async function play() {
    if (!timeline) return;
    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;
    await ctx.resume();
    const from = t >= timeline.totalDuration - 0.1 ? 0 : t;
    nodesRef.current.forEach((n) => {
      try {
        n.stop();
      } catch {
        /* ignore */
      }
    });
    nodesRef.current = [];
    for (const ts of timeline.scenes) {
      const url = audioUrls[ts.scene.sceneId];
      if (!url || ts.end < from) continue;
      const buf = await fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const at = ts.start - from;
      if (at >= 0) src.start(ctx.currentTime + at);
      else if (-at < buf.duration) src.start(ctx.currentTime, -at);
      nodesRef.current.push(src);
    }
    playStartRef.current = { wall: performance.now(), t: from };
    setT(from);
    setPlaying(true);
  }
  function stop() {
    nodesRef.current.forEach((n) => {
      try {
        n.stop();
      } catch {
        /* ignore */
      }
    });
    nodesRef.current = [];
    playStartRef.current = null;
    setPlaying(false);
  }

  const total = timeline?.totalDuration ?? 0;
  const cur = timeline?.scenes.find((s) => t >= s.start && t < s.end);
  const hasExport = !!exportUrl;

  return (
    <section className={cn('flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-zinc-900/40 p-4 overflow-y-auto', className)}>
      <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="blue">{project.settings.aspectRatio} · {width}×{height}</Badge>
          {timeline && <Badge>{timeline.scenes.length} scenes · {formatTime(total)}</Badge>}
          {cur && <Badge tone="zinc">{cur.scene.spec.environment.type} · {SHOT_LABELS[cur.scene.spec.camera.shot]} · {MOVE_LABELS[cur.scene.spec.camera.movement]}</Badge>}
        </div>
        {hasExport && (
          <Btn size="sm" onClick={() => setShowExport(!showExport)}>{showExport ? 'Live engine' : 'Final video'}</Btn>
        )}
      </div>

      <div className="relative flex max-h-[58vh] items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-black shadow-2xl" style={{ aspectRatio: `${width}/${height}`, maxWidth: '100%' }}>
        {hasExport && showExport ? (
          <video key={exportUrl!} src={exportUrl!} controls className="max-h-[58vh]" style={{ aspectRatio: `${width}/${height}` }} />
        ) : (
          <canvas ref={canvasRef} width={pw} height={ph} className="max-h-[58vh] w-auto" style={{ aspectRatio: `${width}/${height}` }} onClick={() => (playing ? stop() : play())} />
        )}
        {!project.script && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-zinc-500">
            <div className="text-3xl">🎬</div>
            <p className="mt-2 text-sm">Enter a topic and press <span className="text-emerald-400">GENERATE</span>.</p>
            <p className="mt-1 text-[11px]">Procedural 2D engine · no AI image generation · nothing is uploaded.</p>
          </div>
        )}
      </div>

      {(!hasExport || !showExport) && timeline && (
        <div className="flex w-full max-w-3xl items-center gap-3">
          <Btn onClick={() => (playing ? stop() : play())}>{playing ? '❚❚' : '▶'}</Btn>
          <input
            type="range"
            min={0}
            max={Math.max(0.01, total)}
            step={0.01}
            value={Math.min(t, total)}
            onChange={(e) => {
              stop();
              setT(+e.target.value);
            }}
            className="flex-1 accent-emerald-500"
          />
          <span className="w-24 text-right font-mono text-xs text-zinc-400">{formatTime(t)} / {formatTime(total)}</span>
        </div>
      )}

      <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-zinc-500">Live preview uses the exact renderer that encodes the file — what you see is what gets exported.</p>
        <div className="flex gap-1.5">
          <Btn size="sm" disabled={busy || !project.script} onClick={() => void renderOnly()}>Render / Re-export</Btn>
          {hasExport && (
            <Btn
              size="sm"
              variant="primary"
              onClick={async () => {
                const b = await blobStore.get(blobStore.key(project.id, 'export', 'final'));
                if (b) await saveBlobToDisk(b, project.exportFileName ?? 'video.mp4', project.exportMime ?? 'video/mp4');
              }}
            >
              ⬇ Save {project.exportFileName?.split('.').pop()?.toUpperCase()}
            </Btn>
          )}
        </div>
      </div>
    </section>
  );
}
