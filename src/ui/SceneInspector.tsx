import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { regenerateTTS, skipScene } from '../core/pipeline';
import {
  ACTIONS, CAMERA_MOVES, CHARACTER_KINDS, CHARACTER_MODES, EFFECTS, EMOTIONS, EMOTION_LABELS, ENVIRONMENTS,
  LIGHT_STYLES, MODE_LABELS, MOVE_LABELS, OBJECTS, OBJ_STATES, POSITIONS, SHOTS, SHOT_LABELS, TIMES, TRANSITIONS, WEATHERS,
  type ActionType, type CameraMove, type CharacterMode, type EffectType, type Emotion, type EnvType, type LightStyle,
  type ObjState, type ObjType, type SceneSpec, type SceneTransition, type ScreenPos, type ShotType, type TimeOfDay, type Weather,
} from '../scene/types';
import { renderScene } from '../scene/renderer';
import { resolveQuality } from '../types';
import { Badge, Btn, Field, Modal, Select, Textarea } from './common';

export function SceneInspector() {
  const { project, selectedSceneId, selectScene, updateScene, audioUrls, busy, hardware } = useStore();
  const scene = project.script?.scenes.find((s) => s.sceneId === selectedSceneId);
  const [edit, setEdit] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spec = scene?.spec;
  const specSig = JSON.stringify(spec ?? {});

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !spec) return;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      try {
        renderScene(ctx, {
          spec,
          bible: project.styleBible,
          t,
          progress: Math.min(1, (t % Math.max(2, spec.duration)) / Math.max(2, spec.duration)),
          W: c.width,
          H: c.height,
          quality: 'low',
          projectSeed: project.settings.masterSeed,
        });
      } catch {
        /* keep the loop alive */
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specSig, project.styleBible, project.settings.masterSeed]);

  if (!scene || !spec) return null;
  const patch = (p: Partial<SceneSpec>) => updateScene(scene.sceneId, { spec: { ...spec, ...p } });
  const close = () => {
    setEdit(false);
    selectScene(null);
  };
  const ratio = project.settings.aspectRatio === '16:9' ? [320, 180] : project.settings.aspectRatio === '1:1' ? [240, 240] : [202, 360];
  const targets = [...spec.characters.map((c) => c.id), ...spec.objects.map((o) => o.id)];

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="grid grid-cols-[112px_1fr] gap-2 border-b border-zinc-800/70 py-2 text-xs">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{k}</div>
      <div className="min-w-0 break-words text-zinc-200">{v}</div>
    </div>
  );

  return (
    <Modal title={`Scene ${String(scene.sceneId).padStart(2, '0')} inspector`} onClose={close} wide>
      <div className="grid gap-5 md:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black">
            <canvas ref={canvasRef} width={ratio[0]} height={ratio[1]} className="w-full" />
          </div>
          <p className="text-[10px] text-zinc-500">Live procedural render (animating) · quality {resolveQuality(project.settings.quality, hardware)}</p>
          {audioUrls[scene.sceneId] && <audio controls src={audioUrls[scene.sceneId]} className="w-full" />}
          <div className="flex flex-wrap gap-1.5">
            <Btn size="sm" disabled={busy} onClick={() => void regenerateTTS([scene.sceneId])}>Regenerate TTS</Btn>
            <Btn size="sm" onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit text'}</Btn>
            <Btn size="sm" variant="danger" disabled={busy} onClick={() => void skipScene(scene.sceneId)}>Skip</Btn>
          </div>
          {scene.ttsError && <div className="rounded border border-red-900 bg-red-950/40 p-2 text-[11px] text-red-300">TTS: {scene.ttsError}</div>}
        </div>

        <div>
          <Row
            k="Status"
            v={
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={scene.ttsStatus === 'done' ? 'green' : scene.ttsStatus === 'failed' ? 'red' : 'zinc'}>tts {scene.ttsStatus}</Badge>
                <Badge tone="green">PROCEDURAL 2D · NO AI IMAGE</Badge>
                <Badge tone="blue">{MODE_LABELS[spec.characterMode]}</Badge>
              </div>
            }
          />
          <Row
            k="Duration"
            v={
              <span>
                est <b>{scene.durationEstimate.toFixed(1)}s</b> → measured{' '}
                <b className={scene.actualDuration != null ? 'text-emerald-400' : 'text-zinc-500'}>{scene.actualDuration != null ? `${scene.actualDuration.toFixed(2)}s` : 'pending'}</b>
              </span>
            }
          />
          <Row k="Voiceover" v={edit ? <Textarea value={scene.voiceover} onChange={(v) => updateScene(scene.sceneId, { voiceover: v, captionText: v, ttsStatus: 'pending' })} /> : scene.voiceover} />
          <Row k="Visual note" v={spec.visualNote || <span className="text-zinc-500">—</span>} />
          <Row
            k="Character mode"
            v={<Select value={spec.characterMode} onChange={(v) => patch({ characterMode: v as CharacterMode, characters: v === 'none' ? [] : spec.characters })} options={CHARACTER_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))} />}
          />
          <Row
            k="Environment"
            v={
              <div className="grid grid-cols-3 gap-1">
                <Select value={spec.environment.type} onChange={(v) => patch({ environment: { ...spec.environment, type: v as EnvType } })} options={ENVIRONMENTS.map((e) => ({ value: e, label: e }))} />
                <Select value={spec.environment.time} onChange={(v) => patch({ environment: { ...spec.environment, time: v as TimeOfDay } })} options={TIMES.map((e) => ({ value: e, label: e }))} />
                <Select value={spec.environment.weather} onChange={(v) => patch({ environment: { ...spec.environment, weather: v as Weather } })} options={WEATHERS.map((e) => ({ value: e, label: e }))} />
              </div>
            }
          />
          <Row
            k="Lighting"
            v={
              <div className="grid grid-cols-2 gap-1">
                <Select value={spec.lighting.style} onChange={(v) => patch({ lighting: { ...spec.lighting, style: v as LightStyle } })} options={LIGHT_STYLES.map((e) => ({ value: e, label: e }))} />
                <input type="range" min={0.1} max={1} step={0.05} value={spec.lighting.intensity} onChange={(e) => patch({ lighting: { ...spec.lighting, intensity: +e.target.value } })} className="w-full accent-emerald-500" />
              </div>
            }
          />
          <Row
            k="Characters"
            v={
              spec.characters.length ? (
                <div className="space-y-2">
                  {spec.characters.map((c, i) => {
                    const def = project.styleBible?.characters.find((d) => d.id === c.id);
                    return (
                      <div key={i} className="rounded border border-zinc-800 bg-zinc-950 p-1.5">
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
                          <Badge>{c.id}</Badge>
                          {def && <Badge tone="blue">{def.kind}{def.variant ? ` · ${def.variant}` : ''}</Badge>}
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <Select value={c.emotion} onChange={(v) => patch({ characters: spec.characters.map((x, j) => (j === i ? { ...x, emotion: v as Emotion } : x)) })} options={EMOTIONS.map((e) => ({ value: e, label: EMOTION_LABELS[e] }))} />
                          <Select value={c.position} onChange={(v) => patch({ characters: spec.characters.map((x, j) => (j === i ? { ...x, position: v as ScreenPos } : x)) })} options={POSITIONS.map((e) => ({ value: e, label: e }))} />
                        </div>
                        <div className="mt-1">
                          <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-500">Action chain</div>
                          <div className="flex flex-wrap items-center gap-1">
                            {c.actions.map((a, k) => (
                              <span key={k} className="flex items-center gap-0.5 rounded border border-emerald-800 bg-emerald-950/40 px-1 py-0.5 text-[9px] text-emerald-300">
                                {a}
                                <button className="text-red-400" onClick={() => patch({ characters: spec.characters.map((x, j) => (j === i ? { ...x, actions: x.actions.filter((_, z) => z !== k) } : x)) })}>×</button>
                                {k < c.actions.length - 1 && <span className="text-zinc-600">→</span>}
                              </span>
                            ))}
                            <Select
                              value=""
                              onChange={(v) => v && patch({ characters: spec.characters.map((x, j) => (j === i ? { ...x, actions: [...x.actions, v as ActionType].slice(0, 5) } : x)) })}
                              options={[{ value: '', label: '+ action' }, ...ACTIONS.map((a) => ({ value: a, label: a }))]}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="text-zinc-500">No character — this is an environment / object shot.</span>
              )
            }
          />
          <Row
            k="Objects"
            v={
              <div className="space-y-1">
                {spec.objects.map((o, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-1 text-[10px]">
                    <span className="truncate text-zinc-300">{o.type} <span className="text-zinc-600">@{o.position}</span></span>
                    <Select value={o.state} onChange={(v) => patch({ objects: spec.objects.map((x, j) => (j === i ? { ...x, state: v as ObjState } : x)) })} options={OBJ_STATES.map((st2) => ({ value: st2, label: st2 }))} />
                    <button className="px-1 text-red-400" onClick={() => patch({ objects: spec.objects.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                <Select
                  value=""
                  onChange={(v) => v && patch({ objects: [...spec.objects, { id: `${v}_${spec.objects.length + 1}`, type: v as ObjType, position: 'center', state: 'default', scale: 1 }] })}
                  options={[{ value: '', label: '+ add object' }, ...OBJECTS.map((o) => ({ value: o, label: o }))]}
                />
              </div>
            }
          />
          <Row
            k="Interactions"
            v={
              spec.interactions.length ? (
                <div className="space-y-0.5 text-[10px] text-zinc-300">
                  {spec.interactions.map((it, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="text-emerald-400">{it.actor}</span>
                      <span className="text-zinc-500">{it.verb.replace('_', ' ')}</span>
                      <span className="text-sky-400">{it.target}</span>
                      <button className="ml-auto text-red-400" onClick={() => patch({ interactions: spec.interactions.filter((_, j) => j !== i) })}>×</button>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-zinc-500">—</span>
              )
            }
          />
          <Row
            k="Effects"
            v={
              <div className="flex flex-wrap gap-1">
                {EFFECTS.map((f) => (
                  <button
                    key={f}
                    onClick={() => patch({ effects: spec.effects.includes(f) ? spec.effects.filter((x) => x !== f) : [...spec.effects, f as EffectType] })}
                    className={`rounded-full border px-1.5 py-0.5 text-[9px] ${spec.effects.includes(f) ? 'border-emerald-500 bg-emerald-950 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            }
          />
          <Row
            k="Camera"
            v={
              <div className="grid grid-cols-3 gap-1">
                <Select value={spec.camera.shot} onChange={(v) => patch({ camera: { ...spec.camera, shot: v as ShotType } })} options={SHOTS.map((e) => ({ value: e, label: SHOT_LABELS[e] }))} />
                <Select value={spec.camera.movement} onChange={(v) => patch({ camera: { ...spec.camera, movement: v as CameraMove } })} options={CAMERA_MOVES.map((e) => ({ value: e, label: MOVE_LABELS[e] }))} />
                <Select value={spec.camera.target ?? ''} onChange={(v) => patch({ camera: { ...spec.camera, target: v || null } })} options={[{ value: '', label: 'no target' }, ...targets.map((t) => ({ value: t, label: t }))]} />
              </div>
            }
          />
          <Row k="Transition" v={<Select value={spec.transition} onChange={(v) => patch({ transition: v as SceneTransition })} options={TRANSITIONS.map((e) => ({ value: e, label: e }))} />} />
          <Row k="Caption" v={edit ? <Textarea rows={2} value={scene.captionText} onChange={(v) => updateScene(scene.sceneId, { captionText: v })} /> : scene.captionText} />
          <Row k="Scene JSON" v={<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[9px] leading-relaxed text-emerald-200/80">{JSON.stringify(spec, null, 1)}</pre>} />
        </div>
      </div>
    </Modal>
  );
}

/** Edits the locked style + cast (continuity across all scenes). */
export function StyleBibleEditor({ onClose }: { onClose: () => void }) {
  const { project, setStyleBible } = useStore();
  const b = project.styleBible;
  if (!b) return null;
  const setChar = (i: number, p: Partial<(typeof b.characters)[number]>) => setStyleBible({ ...b, characters: b.characters.map((c, j) => (j === i ? { ...c, ...p } : c)) });

  return (
    <Modal title="Style & cast bible" onClose={onClose} wide>
      <p className="mb-3 text-[11px] text-zinc-400">
        The renderer reuses these values in every scene — that is what keeps the look and the cast consistent. Characters are optional: a video can have none.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(['primary', 'secondary', 'accent', 'shadow', 'sky'] as const).map((k) => (
          <Field key={k} label={k}>
            <input type="color" value={b.palette[k]} onChange={(e) => setStyleBible({ ...b, palette: { ...b.palette, [k]: e.target.value } })} className="h-8 w-full rounded border border-zinc-700 bg-zinc-900" />
          </Field>
        ))}
      </div>
      {!b.characters.length && <p className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-[11px] text-zinc-400">This video has no cast. Scenes are built from environments, objects, light and motion.</p>}
      <div className="space-y-3">
        {b.characters.map((c, i) => (
          <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-zinc-100">{c.name || c.id}</span>
              <Badge>{c.id}</Badge>
              <Select value={c.kind} onChange={(v) => setChar(i, { kind: v as typeof c.kind })} options={CHARACTER_KINDS.map((k) => ({ value: k, label: k }))} />
              <input value={c.variant} onChange={(e) => setChar(i, { variant: e.target.value })} className="w-24 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-200" placeholder="variant" />
              <Btn size="sm" variant="danger" onClick={() => setStyleBible({ ...b, characters: b.characters.filter((_, j) => j !== i) })}>Remove</Btn>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['skin', 'hairColor', 'topColor', 'bottomColor', 'shoeColor', 'accessoryColor'] as const).map((k) => (
                <Field key={k} label={k === 'skin' ? 'body' : k}>
                  <input type="color" value={c[k]} onChange={(e) => setChar(i, { [k]: e.target.value } as never)} className="h-8 w-full rounded border border-zinc-700 bg-zinc-900" />
                </Field>
              ))}
              <Field label="hair">
                <Select value={c.hairStyle} onChange={(v) => setChar(i, { hairStyle: v as typeof c.hairStyle })} options={['short', 'long', 'messy', 'bun', 'bald', 'curly', 'ponytail', 'hat', 'hood'].map((x) => ({ value: x, label: x }))} />
              </Field>
              <Field label="accessory">
                <Select value={c.accessory} onChange={(v) => setChar(i, { accessory: v as typeof c.accessory })} options={['none', 'glasses', 'hood', 'cap', 'scarf', 'headphones', 'backpack'].map((x) => ({ value: x, label: x }))} />
              </Field>
              <Field label="build">
                <Select value={c.build} onChange={(v) => setChar(i, { build: v as typeof c.build })} options={['slim', 'average', 'heavy', 'tall'].map((x) => ({ value: x, label: x }))} />
              </Field>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Btn variant="primary" onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}
