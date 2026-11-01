import type { Project, Scene, SpeechResult } from '../types';
import { useStore } from '../store';
import { queueManager } from './queueManager';
import { generateScript } from './scriptEngine';
import { modelManager } from '../models/modelManager';
import { blobStore, chunkStore, projectStore } from '../storage/projectStore';
import { memoryManager } from '../utils/memoryManager';
import { cleanForTts } from '../models/tts/preprocessor';
import { estimateWordTimings } from '../models/tts/kokoroAdapter';
import { audioBufferToWav, decodeAudioBlob } from '../utils/fileUtils';
import { MIX_SAMPLE_RATE } from '../video/audioMixer';
import { buildTimeline, loadNarration, renderProject } from '../video/renderer';
import { clearSceneCache } from '../scene/renderer';
import { deviceProfile, yieldToBrowser } from '../utils/deviceProfile';
import { isTransientFailure, kokoroAdapter } from '../models/tts/kokoroAdapter';

/**
 * PIPELINE
 *   TOPIC → LLM (story + style bible + scene plan) → Kokoro TTS → real durations
 *         → procedural 2D rendering → frame-by-frame WebCodecs encode → MP4/WebM
 * There is NO image generation model anywhere in this pipeline.
 */

const S = () => useStore.getState();
const ttsKey = (p: Project, id: number) => blobStore.key(p.id, 'tts', `scene_${String(id).padStart(3, '0')}.wav`);

function setStage(stage: Project['stage']) {
  S().setProject((p) => ({ ...p, stage }));
}
async function persistNow() {
  await projectStore.save(S().project);
}
function cancelled() {
  return queueManager.isCancelled();
}

/** Concatenates per-sentence speech into one WAV and rebuilds word timings from the measured length. */
async function mergeSpeech(parts: SpeechResult[]): Promise<SpeechResult> {
  if (parts.length === 1) return parts[0];
  const PAUSE = 0.14;
  const total = parts.reduce((a, p) => a + p.durationSec + PAUSE, 0);
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(total * MIX_SAMPLE_RATE)), MIX_SAMPLE_RATE);
  let t = 0;
  const wordTimings: { word: string; start: number; end: number }[] = [];
  for (const part of parts) {
    const buf = await decodeAudioBlob(part.audio, MIX_SAMPLE_RATE);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(t);
    for (const w of part.wordTimings) wordTimings.push({ word: w.word, start: w.start + t, end: w.end + t });
    t += buf.duration + PAUSE;
  }
  const rendered = await ctx.startRendering();
  const text = wordTimings.map((w) => w.word).join(' ');
  return {
    audio: audioBufferToWav(rendered),
    durationSec: rendered.duration,
    wordTimings: wordTimings.length ? wordTimings : estimateWordTimings(text, rendered.duration),
    sampleRate: rendered.sampleRate,
  };
}

/**
 * MODEL PREFLIGHT — asks the Model Manager for everything the pipeline will need BEFORE any work
 * starts, so the user never hits a missing-model error halfway through a render.
 */
export interface MissingModel {
  id: string;
  name: string;
  sizeBytes: number;
  status: string;
  issue?: string;
  category: string;
}

export function preflightModels(): MissingModel[] {
  const p = S().project;
  const missing: MissingModel[] = [];
  for (const id of [p.settings.llmModelId, p.settings.ttsModelId]) {
    if (!id) {
      missing.push({ id: '', name: 'No model selected', sizeBytes: 0, status: 'NOT_INSTALLED', category: 'unknown' });
      continue;
    }
    const req = modelManager.requirementFor(id);
    if (!req) {
      missing.push({ id, name: id, sizeBytes: 0, status: 'NOT_INSTALLED', category: 'unknown' });
      continue;
    }
    const st = req.state?.status ?? 'NOT_INSTALLED';
    if (st !== 'READY' && st !== 'UPDATING') {
      missing.push({ id: req.entry.id, name: req.entry.name, sizeBytes: req.entry.sizeBytes, status: st, issue: req.state?.issue, category: req.entry.category });
    }
  }
  return missing;
}

// ---------------- Stage 1: LLM — story, style bible, scene plan ----------------
async function stageScript() {
  const p = S().project;
  if (p.script) return;
  if (!p.settings.topic.trim()) throw new Error('Enter a topic first.');
  const req = modelManager.requirementFor(p.settings.llmModelId);
  if (!req) throw new Error(`Model not installed: "${p.settings.llmModelId}". Pick an LLM in Local Models — nothing is substituted silently.`);
  if (!modelManager.isReady(p.settings.llmModelId)) {
    throw new Error(`"${req.entry.name}" is required for scene planning but is not installed (${req.state?.status ?? 'NOT_INSTALLED'}). Open Local Models to download it (${(req.entry.sizeBytes / 1024 ** 2).toFixed(0)} MB).`);
  }
  const model = modelManager.get(p.settings.llmModelId) ?? { name: req.entry.name };
  const llm = modelManager.llmAdapterFor(p.settings.llmModelId);

  setStage('script');
  await queueManager.enqueue({ label: `Load LLM · ${model.name}`, kind: 'load', locality: llm.locality }, async (t) => {
    await llm.load(p.settings.llmModelId, (pr: number, txt: string) => {
      queueManager.update(t.id, { progress: pr });
      S().setStatus(txt || 'Loading LLM…');
    });
  });

  await queueManager.enqueue({ label: 'Story + visual style bible (LLM)', kind: 'style', locality: llm.locality }, async () => {
    memoryManager.setStatus('LLM: creative direction');
    const { script, bible } = await generateScript(
      llm,
      {
        topic: p.settings.topic,
        durationSec: p.settings.durationSec,
        language: p.settings.language,
        masterSeed: p.settings.masterSeed,
        existingBible: p.styleBible,
        styleLocked: p.settings.styleLockEnabled && !!p.styleBible?.locked,
        characterMode: p.settings.characterMode ?? 'auto',
      },
      (msg, partial) => S().setStatus(msg, partial),
    );
    clearSceneCache();
    S().setProject((pp) => ({
      ...pp,
      name: pp.name === 'Untitled project' ? script.title : pp.name,
      script,
      styleBible: { ...bible, style: pp.settings.visualStyle ?? bible.style, locked: pp.settings.styleLockEnabled },
    }));
    S().log(`Scene plan ready: "${script.title}" · ${script.scenes.length} scenes · ${bible.characters.length} character(s) locked.`);
    S().setStatus(`Scene plan ready — ${script.scenes.length} scenes`, '');
  });
  await persistNow();
}

async function unloadLLM() {
  const p = S().project;
  try {
    const llm = modelManager.llmAdapterFor(p.settings.llmModelId);
    if (llm.isLoaded()) {
      await queueManager.enqueue({ label: 'Unload LLM (free VRAM)', kind: 'unload', locality: llm.locality }, async () => {
        await memoryManager.release('llm');
      });
    }
  } catch {
    /* no llm loaded */
  }
  await modelManager.refresh();
}

// ---------------- Stage 2: Kokoro TTS — strictly one scene at a time ----------------
async function generateOneTTS(scene: Scene, idx: number, total: number) {
  const p = S().project;
  const adapter = modelManager.ttsAdapterFor(p.settings.ttsModelId);
  S().updateScene(scene.sceneId, { ttsStatus: 'generating', ttsError: undefined });
  memoryManager.setStatus(`TTS Scene ${scene.sceneId}`);
  S().setStatus(`Scene ${idx + 1}/${total} — Generating TTS`);

  // Raw LLM text is never sent to the synth: clean → pronunciation → sentence split.
  const cleaned = cleanForTts(scene.voiceover, p.settings.pronunciation, p.settings.language);
  if (!cleaned.clean.trim()) {
    S().updateScene(scene.sceneId, { ttsStatus: 'invalid', ttsError: 'Nothing speakable after text preprocessing.' });
    throw new Error('Nothing speakable left after text preprocessing.');
  }

  // Sentences are synthesised one by one (never Promise.all) — the adapter also serialises
  // internally, so at most one GPU/WASM session is active at any moment.
  const results: SpeechResult[] = [];
  const sentences = cleaned.sentences.length ? cleaned.sentences : [cleaned.clean];
  for (const sentence of sentences) {
    results.push(
      await adapter.generateSpeech({
        text: sentence,
        voice: p.settings.voice,
        speed: p.settings.ttsSpeed,
        pitch: p.settings.ttsPitch,
        volume: p.settings.ttsVolume,
        language: p.settings.language,
        modelId: p.settings.ttsModelId,
      }),
    );
    await yieldToBrowser(0);
  }

  const merged = await mergeSpeech(results);
  results.length = 0; // free the per-sentence WAV blobs
  await blobStore.put(ttsKey(p, scene.sceneId), merged.audio);
  S().setAudioUrl(scene.sceneId, URL.createObjectURL(merged.audio));
  S().updateScene(scene.sceneId, {
    ttsStatus: 'done',
    actualDuration: Math.round(merged.durationSec * 100) / 100,
    wordTimings: merged.wordTimings,
    ttsSource: `${adapter.id} (${adapter.locality})`,
    voiceover: cleaned.clean,
  });
  S().setStatus(`Scene ${idx + 1}/${total} — TTS complete`);
  S().log(`Scene ${scene.sceneId}: estimated ${scene.durationEstimate}s → measured ${merged.durationSec.toFixed(2)}s (${sentences.length} sentence${sentences.length > 1 ? 's' : ''})`);
  await yieldToBrowser(deviceProfile().aggressiveCleanup ? 40 : 0);
}

async function stageTTS(sceneIds?: number[]) {
  const p = S().project;
  if (!p.script) return;
  const req = modelManager.requirementFor(p.settings.ttsModelId);
  if (!req) throw new Error(`Model not installed: "${p.settings.ttsModelId}". Pick a TTS model in Local Models.`);
  if (!modelManager.isReady(p.settings.ttsModelId)) {
    throw new Error(`"${req.entry.name}" is required for narration but is not installed (${req.state?.status ?? 'NOT_INSTALLED'}). Open Local Models to download it (${(req.entry.sizeBytes / 1024 ** 2).toFixed(0)} MB).`);
  }
  const model = modelManager.get(p.settings.ttsModelId) ?? { name: req.entry.name, languages: req.entry.languages };
  if (!model.languages.includes(p.settings.language)) throw new Error(`"${model.name}" has no ${p.settings.language.toUpperCase()} voice. Switch language or model — no silent substitution.`);
  const adapter = modelManager.ttsAdapterFor(p.settings.ttsModelId);
  const targets = p.script.scenes.filter((s) => (sceneIds ? sceneIds.includes(s.sceneId) : s.ttsStatus !== 'done' && s.ttsStatus !== 'skipped'));
  if (!targets.length) return;

  setStage('tts');
  // Surface GPU→CPU fallback messages from the adapter in the UI/log.
  const offStatus = kokoroAdapter.onStatus(({ level, message }) => {
    S().setStatus(message);
    S().log(`TTS: ${message}`, level === 'warn' ? 'warn' : 'info');
  });

  try {
    // The model is loaded ONCE for the whole batch (Load → Scene 1 → Scene 2 → … → Unload).
    await queueManager.enqueue({ label: `Load TTS · ${model.name}`, kind: 'load', locality: adapter.locality }, async (t) => {
      await adapter.load(p.settings.ttsModelId, (pr: number, txt: string) => {
        queueManager.update(t.id, { progress: pr });
        S().setStatus(txt);
      });
    });

    for (let i = 0; i < targets.length; i++) {
      const scene = targets[i];
      if (cancelled()) break;
      try {
        await queueManager.enqueue({ label: `TTS Scene ${scene.sceneId}`, kind: 'tts', locality: adapter.locality, sceneId: scene.sceneId }, () =>
          generateOneTTS(S().project.script!.scenes.find((s) => s.sceneId === scene.sceneId)!, i, targets.length),
        );
      } catch (e) {
        const msg = (e as Error).message;
        const recoverable = isTransientFailure(e);
        const current = S().project.script?.scenes.find((s) => s.sceneId === scene.sceneId);
        if (current?.ttsStatus !== 'invalid') {
          S().updateScene(scene.sceneId, { ttsStatus: recoverable ? 'recovering' : 'failed', ttsError: msg });
        }
        S().setStatus(`Scene ${i + 1}/${targets.length} — TTS failed (${recoverable ? 'recoverable' : 'permanent'})`);
        S().log(`Scene ${scene.sceneId} TTS failed: ${msg}`, 'error');
        // One scene failing must never abort the others.
        await yieldToBrowser(deviceProfile().aggressiveCleanup ? 120 : 20);
      }
      await persistNow();
    }
  } finally {
    offStatus();
    await queueManager.enqueue({ label: 'Unload TTS (free memory)', kind: 'unload', locality: adapter.locality }, async () => {
      await memoryManager.release('tts');
      await yieldToBrowser(0);
    });
    await modelManager.refresh();
  }

  const failed = (S().project.script?.scenes ?? []).filter((s) => s.ttsStatus === 'recovering' || s.ttsStatus === 'failed');
  if (failed.length) S().log(`${failed.length} scene(s) have no narration yet — they will render silently. Use "Retry TTS" to try again.`, 'warn');
}

// ---------------- Stage 3: procedural frame-by-frame render + encode ----------------
export async function stageRender() {
  const p = S().project;
  if (!p.script) throw new Error('No scene plan to render.');
  setStage('render');
  await queueManager.enqueue({ label: 'Procedural render + encode (WebCodecs)', kind: 'render', locality: 'LOCAL' }, async (t) => {
    memoryManager.setStatus('Rendering procedural frames');
    const narration = await loadNarration(p);
    const timeline = buildTimeline(p.script!.scenes, p.settings.captionMode);
    S().log(`Timeline: ${timeline.scenes.length} scenes · ${timeline.totalDuration.toFixed(1)}s (from measured audio).`);
    const result = await renderProject(p, timeline, narration, {
      onPlan: (chunks) => S().setProject((pp) => ({ ...pp, chunks })),
      onChunkStart: (i, n, rec) => {
        S().setStatus(`Rendering chunk ${i + 1}/${n}`);
        S().setProject((pp) => ({ ...pp, chunks: pp.chunks.map((c) => (c.index === rec.index ? { ...rec } : c)) }));
      },
      onChunkProgress: (i, pr) => {
        const n = Math.max(1, S().project.chunks.length || 1);
        queueManager.update(t.id, { progress: (i + pr) / n });
      },
      onChunkDone: (rec) => S().setProject((pp) => ({ ...pp, chunks: pp.chunks.map((c) => (c.index === rec.index ? { ...rec } : c)) })),
      onStatus: (s) => {
        S().setStatus(s);
        S().log(s);
      },
      shouldCancel: cancelled,
    });
    S().setProject((pp) => ({ ...pp, chunks: result.chunks }));
    const fileName = `${(p.script!.title || 'video').replace(/[^\w-]+/g, '_').slice(0, 60)}.${result.ext}`;
    await blobStore.put(blobStore.key(p.id, 'export', 'final'), result.blob);
    S().setExportUrl(URL.createObjectURL(result.blob));
    S().setProject((pp) => ({ ...pp, exportFileName: fileName, exportMime: result.mime, stage: 'done' }));
    S().log(`Export ready: ${fileName} (${(result.blob.size / 1e6).toFixed(1)} MB)`);
  });
  await persistNow();
}

// ---------------- Public API ----------------
export async function generateVideo() {
  if (S().busy) return;
  queueManager.reset();
  queueManager.clear();
  S().setBusy(true);
  try {
    S().setProject((p) => ({ ...p, modelsUsed: { llm: p.settings.llmModelId, ttsModel: p.settings.ttsModelId, visualEngine: 'procedural-2d-scene-engine' } }));
    if (!S().project.script) {
      S().setProject((p) => ({ ...p, chunks: [] }));
      await chunkStore.clear(S().project.id);
    }
    await stageScript();
    if (cancelled()) return;
    await unloadLLM();
    if (cancelled()) return;
    await stageTTS();
    if (cancelled()) return;
    setStage('sync');
    await stageRender();
    S().setStatus('Video exported ✔');
  } catch (e) {
    S().log((e as Error).message, 'error');
    S().setStatus('Failed: ' + (e as Error).message);
    setStage('failed');
    await persistNow();
  } finally {
    S().setBusy(false);
    memoryManager.setStatus('Idle');
  }
}

export async function regenerateTTS(sceneIds: number[]) {
  if (S().busy) return;
  queueManager.reset();
  S().setBusy(true);
  try {
    for (const id of sceneIds) S().updateScene(id, { ttsStatus: 'pending', ttsError: undefined });
    S().setProject((p) => ({ ...p, chunks: [] }));
    await chunkStore.clear(S().project.id);
    await stageTTS(sceneIds);
  } catch (e) {
    S().log((e as Error).message, 'error');
    S().setStatus('Failed: ' + (e as Error).message);
  } finally {
    S().setBusy(false);
  }
}

/** Re-plan the scene visuals with the LLM while keeping the narration and the locked style. */
export async function regenerateScenePlan() {
  if (S().busy) return;
  queueManager.reset();
  S().setBusy(true);
  try {
    S().setProject((p) => ({ ...p, script: null, chunks: [] }));
    await chunkStore.clear(S().project.id);
    clearSceneCache();
    await stageScript();
    await unloadLLM();
  } catch (e) {
    S().log((e as Error).message, 'error');
  } finally {
    S().setBusy(false);
  }
}

export async function renderOnly() {
  if (S().busy) return;
  queueManager.reset();
  S().setBusy(true);
  try {
    clearSceneCache();
    await stageRender();
    S().setStatus('Video exported ✔');
  } catch (e) {
    S().log((e as Error).message, 'error');
    S().setStatus('Failed: ' + (e as Error).message);
  } finally {
    S().setBusy(false);
  }
}

export async function resumeProject() {
  return generateVideo();
}

export function cancelGeneration() {
  queueManager.cancel();
  S().setStatus('Cancelling after the current task…');
}

export async function skipScene(sceneId: number) {
  S().updateScene(sceneId, { ttsStatus: 'skipped' });
  await persistNow();
}
