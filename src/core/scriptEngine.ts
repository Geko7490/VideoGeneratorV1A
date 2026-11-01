import type { Language, LLMAdapter, Scene, Script } from '../types';
import {
  ACTIONS, CAMERA_MOVES, CHARACTER_KINDS, EFFECTS, EMOTIONS, ENVIRONMENTS, INTERACTION_VERBS, LIGHT_STYLES,
  OBJECTS, OBJ_STATES, POSITIONS, SHOTS, VISUAL_STYLES,
  advanceContinuity, defaultCharacter, emptyContinuity, inferEmotion, inferEnvironment, narrationNeedsCharacter,
  validateSceneSpec, validateStyleBible,
  type CharacterMode, type ContinuityState, type SceneSpec, type StyleBible,
} from '../scene/types';

/**
 * The LLM is the CREATIVE DIRECTOR. It never draws.
 * This prompt set is deliberately model-agnostic: every field is a plain enum string, so a 0.5B
 * model and a 70B model both emit the same Scene JSON. Anything missing or wrong is repaired
 * by the validator, so weaker models still produce a usable video.
 */

const LANG_NAME: Record<Language, string> = { en: 'English', tr: 'Turkish (Türkçe)' };
const WPS: Record<Language, number> = { en: 2.5, tr: 2.1 };

export function extractJSON(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1) throw new Error('No JSON object found in LLM output.');
  t = end > start ? t.slice(start, end + 1) : t.slice(start);
  const attempts = [
    t,
    t.replace(/,\s*([}\]])/g, '$1'),
    t.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"'),
    t.replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":'),
  ];
  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {
      /* try next repair */
    }
  }
  // salvage: close the array/object after the last complete entry
  for (const tail of ['}]}', ']}', '}}', '}']) {
    const cut = t.lastIndexOf('},');
    if (cut <= 0) break;
    try {
      return JSON.parse(t.slice(0, cut + 1) + tail);
    } catch {
      /* keep trying */
    }
  }
  throw new Error('LLM produced JSON that could not be repaired.');
}

function sysPrompt(lang: Language) {
  return `You are a film director and storyboard artist for a 2D animation engine. Output ONLY valid JSON — no markdown fences, no commentary.
Spoken narration must be in ${LANG_NAME[lang]}. Every visual field must use EXACTLY one of the English enum values given to you.
You never describe pictures in prose; you choose structured parameters that the engine renders.
Scenes do NOT need characters. Empty rooms, a buzzing phone, a swinging door or a rainy street are valid, strong shots.`;
}

// ---------------- stage 1: story + style + cast ----------------

function storyPrompt(topic: string, durationSec: number, lang: Language, mode: CharacterMode) {
  const words = Math.round(durationSec * WPS[lang]);
  const castRule =
    mode === 'none'
      ? 'This video has NO characters at all. Return "characters": [].'
      : mode === 'required'
      ? 'Every scene will show at least one character. Define 1-2 recurring characters.'
      : 'Define 0-2 recurring characters. If the story works better with no character at all (objects, places, atmosphere), return an empty list.';

  return `Plan a ${durationSec}-second narrated 2D animated video about: "${topic}".
Decide the look and the cast ONCE — they stay identical for the whole video.
${castRule}

Return JSON:
{
  "title": "short title in ${LANG_NAME[lang]}",
  "hook": "first spoken sentence in ${LANG_NAME[lang]}",
  "music_mood": "e.g. dark ambient / uplifting / tense",
  "style": one of ${JSON.stringify(VISUAL_STYLES)},
  "mood_notes": "one English sentence about the visual mood",
  "palette": { "primary": "#rrggbb", "secondary": "#rrggbb", "accent": "#rrggbb", "shadow": "#rrggbb", "sky": "#rrggbb" },
  "characters": [
    {
      "id": "character_01",
      "name": "short name",
      "kind": one of ${JSON.stringify(CHARACTER_KINDS)},
      "age": "child"|"teen"|"young_adult"|"adult"|"elder",
      "skin": "#rrggbb (body / fur / chassis colour)",
      "hair_color": "#rrggbb",
      "hair_style": "short"|"long"|"messy"|"bun"|"bald"|"curly"|"ponytail"|"hat"|"hood",
      "top_color": "#rrggbb",
      "bottom_color": "#rrggbb",
      "shoe_color": "#rrggbb",
      "build": "slim"|"average"|"heavy"|"tall",
      "accessory": "none"|"glasses"|"hood"|"cap"|"scarf"|"headphones"|"backpack",
      "variant": "free short word, e.g. cat, dog, android, sedan"
    }
  ],
  "locations": [ { "id": "home", "type": one of ${JSON.stringify(ENVIRONMENTS)}, "notes": "short English note" } ],
  "outline": ["beat 1", "beat 2", "beat 3"]
}

Total narration will be about ${words} words.`;
}

// ---------------- stage 2: storyboard ----------------

function scenePrompt(a: {
  topic: string; title: string; outline: string[]; lang: Language; durationSec: number;
  charIds: string[]; mode: CharacterMode; partIndex: number; partCount: number; previously: string; objectStates: string;
}) {
  const words = Math.round(a.durationSec * WPS[a.lang]);
  const minScenes = Math.max(3, Math.round(a.durationSec / 9));
  const maxScenes = Math.max(minScenes + 2, Math.round(a.durationSec / 4.5));
  const part = a.partCount > 1 ? `This is PART ${a.partIndex + 1} of ${a.partCount}. Previously: ${a.previously || '(nothing yet — open with the hook)'}.` : 'Open with a strong hook.';
  const castRule =
    a.mode === 'none' ? 'NEVER include characters. "characters" must always be []. Tell the story with places, objects, light and motion.'
    : a.mode === 'required' ? 'Every scene must contain at least one character from the cast.'
    : a.mode === 'optional' ? 'Only include a character when the narration really needs one; otherwise use []. '
    : 'Use characters only where they help. Pure environment/object shots are encouraged for atmosphere.';

  return `Storyboard "${a.title}" (topic: "${a.topic}"). ${part}
Outline: ${a.outline.join(' | ')}
Cast ids you may use: ${JSON.stringify(a.charIds)}
${a.objectStates ? `Object states carried over from earlier scenes: ${a.objectStates}` : ''}

${castRule}

Write ${minScenes}-${maxScenes} scenes covering ~${words} words of narration (~${a.durationSec}s). Each scene is one visual beat of 4-9 seconds.

DIRECTING RULES
- The visuals must match what the narration says in that exact scene.
- "establishing"/"wide" for openings and new places, "medium" for normal beats, "close_up" for emotion or a key object, "pov"/"over_shoulder" for tension.
- Set "camera.target" to the id of the character or object the shot is about.
- Change emotions and actions as the story develops; never repeat the same camera movement 3 times in a row.
- Keep continuity: if a door was opened it stays open; reuse the same environment while the story stays in one place.
- Use object states to tell the story: a phone can be "vibrating", a lamp "flickering", a door "open".

Return JSON:
{
  "scenes": [
    {
      "duration": 5.5,
      "voiceover": "the sentence spoken in this scene, in ${LANG_NAME[a.lang]}",
      "visual_note": "short English note on what we see",
      "character_mode": "auto"|"none"|"optional"|"required",
      "environment": { "type": one of ${JSON.stringify(ENVIRONMENTS)}, "time": "dawn"|"day"|"sunset"|"night", "weather": "clear"|"rain"|"snow"|"fog"|"storm"|"wind" },
      "lighting": { "style": one of ${JSON.stringify(LIGHT_STYLES)}, "direction": "left"|"right"|"top"|"window"|"front"|"back", "intensity": 0.6 },
      "characters": [ { "id": "character_01", "emotion": one of ${JSON.stringify(EMOTIONS)}, "actions": ["walk","stand","look","react"] from ${JSON.stringify(ACTIONS)}, "position": one of ${JSON.stringify(POSITIONS)}, "facing": "left"|"right" } ],
      "objects": [ { "id": "door_01", "type": one of ${JSON.stringify(OBJECTS)}, "position": "left"|"center"|"right"|"far_left"|"far_right"|"character_hand"|"foreground"|"background", "state": one of ${JSON.stringify(OBJ_STATES)} } ],
      "interactions": [ { "actor": "character_01", "verb": one of ${JSON.stringify(INTERACTION_VERBS)}, "target": "door_01" } ],
      "effects": ${JSON.stringify(EFFECTS)} (choose 0-3),
      "camera": { "shot": one of ${JSON.stringify(SHOTS)}, "movement": one of ${JSON.stringify(CAMERA_MOVES)}, "target": "door_01" },
      "transition": "crossfade"|"fade"|"fade_black"|"blur"|"cut"
    }
  ]
}`;
}

export interface ScriptProgress {
  (msg: string, partial?: string): void;
}

async function completeWithRetry(llm: LLMAdapter, system: string, user: string, onProgress: ScriptProgress, label: string, attempts = 3): Promise<unknown> {
  let lastErr: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await llm.complete(system, i === 0 ? user : `${user}\n\nIMPORTANT: your previous answer was not valid JSON. Reply with ONLY the JSON object.`, {
        json: true,
        maxTokens: 3000,
        temperature: i === 0 ? 0.75 : 0.4,
        onToken: (t) => onProgress(label, t),
      });
      return extractJSON(out);
    } catch (e) {
      lastErr = e as Error;
      onProgress(`${label} — JSON repair ${i + 2}/${attempts}…`);
    }
  }
  throw lastErr ?? new Error('LLM failed to produce valid JSON.');
}

/** Narration-only fallback so a failed storyboard still yields scenes. */
function fallbackScenes(topic: string, durationSec: number, lang: Language) {
  const n = Math.max(3, Math.round(durationSec / 6));
  return Array.from({ length: n }, () => ({
    duration: durationSec / n,
    voiceover: lang === 'tr' ? `${topic} üzerine düşünelim.` : `Let's look closer at ${topic}.`,
  }));
}

export async function generateStyleBible(
  llm: LLMAdapter,
  topic: string,
  durationSec: number,
  lang: Language,
  mode: CharacterMode,
  onProgress: ScriptProgress,
): Promise<{ bible: StyleBible; title: string; hook: string; musicMood: string; outline: string[] }> {
  onProgress('Creative director: story, style & cast…');
  let j: Record<string, unknown> = {};
  try {
    j = (await completeWithRetry(llm, sysPrompt(lang), storyPrompt(topic, durationSec, lang, mode), onProgress, 'Planning story & cast…')) as Record<string, unknown>;
  } catch (e) {
    onProgress(`LLM plan failed (${(e as Error).message}) — using safe defaults.`);
  }
  const bible = validateStyleBible(j);
  if (mode === 'none') bible.characters = [];
  else if (mode === 'required' && !bible.characters.length) bible.characters = [defaultCharacter('character_01', 0)];
  return {
    bible,
    title: String(j.title ?? topic).slice(0, 120) || topic,
    hook: String(j.hook ?? ''),
    musicMood: String(j.music_mood ?? ''),
    outline: Array.isArray(j.outline) ? j.outline.map(String).slice(0, 8) : [],
  };
}

export async function generateScenePlan(
  llm: LLMAdapter,
  args: { topic: string; title: string; outline: string[]; durationSec: number; lang: Language; bible: StyleBible; masterSeed: number; mode: CharacterMode },
  onProgress: ScriptProgress,
): Promise<Scene[]> {
  const SEG = 75;
  const parts = args.durationSec > 100 ? Math.ceil(args.durationSec / SEG) : 1;
  const charIds = args.bible.characters.map((c) => c.id);
  const scenes: Scene[] = [];
  let previously = '';
  let continuity: ContinuityState = emptyContinuity();
  const lastMoves: string[] = [];

  for (let p = 0; p < parts; p++) {
    const segDur = Math.min(SEG, args.durationSec - p * SEG);
    onProgress(`Storyboarding part ${p + 1}/${parts} (${Math.round(segDur)}s)…`);
    let raw: Record<string, unknown> = {};
    const stateSummary = Object.entries(continuity.objectStates).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(', ');
    try {
      raw = (await completeWithRetry(
        llm,
        sysPrompt(args.lang),
        scenePrompt({ topic: args.topic, title: args.title, outline: args.outline, lang: args.lang, durationSec: segDur, charIds, mode: args.mode, partIndex: p, partCount: parts, previously, objectStates: stateSummary }),
        onProgress,
        `Storyboarding part ${p + 1}/${parts}…`,
      )) as Record<string, unknown>;
    } catch (e) {
      onProgress(`Storyboard JSON failed (${(e as Error).message}) — generating safe scenes.`);
    }
    const list = Array.isArray(raw.scenes) && raw.scenes.length ? raw.scenes : fallbackScenes(args.topic, segDur, args.lang);

    for (const item of list as Record<string, unknown>[]) {
      const idx = scenes.length;
      const voiceover = String(item.voiceover ?? item.narration ?? '').trim();
      if (!voiceover) continue;

      const spec: SceneSpec = validateSceneSpec(item, { index: idx, narration: voiceover, knownCharacters: charIds, mode: args.mode, continuity });

      // ---- director polish that small models usually miss ----
      if (lastMoves.length >= 2 && lastMoves[lastMoves.length - 1] === spec.camera.movement && lastMoves[lastMoves.length - 2] === spec.camera.movement) {
        const alt = ['slow_zoom_in', 'pan_right', 'slow_zoom_out', 'pan_left', 'handheld', 'orbit'] as const;
        spec.camera.movement = alt[idx % alt.length];
      }
      lastMoves.push(spec.camera.movement);
      if (idx === 0 && spec.camera.shot === 'medium') spec.camera.shot = 'establishing';
      if (spec.characters.length) {
        if (spec.characters[0].emotion === 'neutral') {
          const inferred = inferEmotion(voiceover);
          if (inferred !== 'neutral') spec.characters[0].emotion = inferred;
        }
        // give flat 'idle' characters a small action chain so they are never frozen
        if (spec.characters[0].actions.length === 1 && spec.characters[0].actions[0] === 'idle') {
          spec.characters[0].actions = /\?|!/.test(voiceover) ? ['idle', 'talk', 'react'] : ['breathe', 'look'];
        }
      } else if (spec.camera.shot === 'close_up' || spec.camera.shot === 'extreme_close_up') {
        // a close-up with no subject should target a prop, not empty air
        const prop = spec.objects.find((o) => o.position !== 'background');
        if (prop) spec.camera.target = prop.id;
        else spec.camera.shot = 'wide';
      }
      if (inferEnvironment(voiceover) === 'abstract' && continuity.lastEnvironment) spec.environment.type = spec.environment.type === 'abstract' ? continuity.lastEnvironment : spec.environment.type;
      spec.scene = idx + 1;
      const est = Math.max(1.6, Math.min(14, spec.duration || voiceover.split(/\s+/).length / WPS[args.lang]));
      spec.duration = est;
      continuity = advanceContinuity(continuity, spec);

      scenes.push({
        sceneId: idx + 1,
        voiceover,
        durationEstimate: Math.round(est * 10) / 10,
        actualDuration: null,
        spec,
        captionText: voiceover,
        seed: args.masterSeed + idx,
        ttsStatus: 'pending',
        wordTimings: [],
        chunkIndex: 0,
      });
    }
    previously = (previously + ' ' + (args.outline[p] ?? scenes.slice(-4).map((s) => s.voiceover).join(' '))).slice(-700);
  }

  if (!scenes.length) throw new Error('The LLM produced no usable scenes. Try a larger model or a simpler topic.');
  return scenes;
}

export async function generateScript(
  llm: LLMAdapter,
  args: { topic: string; durationSec: number; language: Language; masterSeed: number; existingBible: StyleBible | null; styleLocked: boolean; characterMode: CharacterMode },
  onProgress: ScriptProgress,
): Promise<{ script: Script; bible: StyleBible }> {
  let bible = args.existingBible;
  let title = args.topic;
  let hook = '';
  let musicMood = '';
  let outline: string[] = [];

  if (!bible || !args.styleLocked) {
    const r = await generateStyleBible(llm, args.topic, args.durationSec, args.language, args.characterMode, onProgress);
    bible = r.bible;
    title = r.title;
    hook = r.hook;
    musicMood = r.musicMood;
    outline = r.outline;
  }
  // 'required' needs at least one body available to the renderer
  if (args.characterMode === 'required' && !bible!.characters.length) bible!.characters = [defaultCharacter('character_01', 0)];
  // 'optional'/'auto' with a people-driven topic: make sure a cast member exists if the LLM forgot
  if ((args.characterMode === 'optional' || args.characterMode === 'auto') && !bible!.characters.length && narrationNeedsCharacter(args.topic)) {
    bible!.characters = [defaultCharacter('character_01', 0)];
  }

  const scenes = await generateScenePlan(
    llm,
    { topic: args.topic, title, outline, durationSec: args.durationSec, lang: args.language, bible: bible!, masterSeed: args.masterSeed, mode: args.characterMode },
    onProgress,
  );
  return { script: { title, hook: hook || scenes[0].voiceover, musicMood, styleNotes: bible!.moodNotes, scenes }, bible: bible! };
}
