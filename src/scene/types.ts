/**
 * STRUCTURED SCENE JSON — the contract between ANY LLM (creative director)
 * and the Procedural 2D Scene Engine.
 *
 * The LLM never draws pixels; it only describes what exists in the shot.
 * Every field is optional: missing/invalid values are repaired with safe procedural defaults,
 * so a single malformed scene can never stop the video.
 */

// ---------------------------------------------------------------- enums

export const ENVIRONMENTS = [
  'bedroom', 'living_room', 'kitchen', 'office', 'classroom', 'hallway', 'street', 'city',
  'forest', 'park', 'beach', 'hospital', 'store', 'warehouse', 'basement', 'cave',
  'rooftop', 'apartment', 'house', 'space', 'abstract',
] as const;
export type EnvType = (typeof ENVIRONMENTS)[number];

export const TIMES = ['dawn', 'day', 'sunset', 'night'] as const;
export type TimeOfDay = (typeof TIMES)[number];

export const WEATHERS = ['clear', 'rain', 'snow', 'fog', 'storm', 'wind'] as const;
export type Weather = (typeof WEATHERS)[number];

export const LIGHT_STYLES = ['daylight', 'night', 'moonlight', 'warm', 'cold', 'sunset', 'neon', 'flashlight', 'dark', 'horror', 'dramatic'] as const;
export type LightStyle = (typeof LIGHT_STYLES)[number];

export const LIGHT_DIRS = ['left', 'right', 'top', 'window', 'front', 'back'] as const;
export type LightDir = (typeof LIGHT_DIRS)[number];

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'scared', 'confused', 'surprised', 'worried', 'shocked', 'evil', 'tired', 'excited'] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** Action verbs. These drive procedural animation and can be chained. */
export const ACTIONS = [
  'idle', 'breathe', 'blink', 'look', 'turn', 'walk', 'run', 'sit', 'stand', 'reach', 'grab',
  'drop', 'open', 'close', 'talk', 'react', 'fall', 'jump', 'attack', 'flee', 'hide',
] as const;
export type ActionType = (typeof ACTIONS)[number];

export const POSITIONS = ['far_left', 'left', 'center', 'right', 'far_right'] as const;
export type ScreenPos = (typeof POSITIONS)[number];

export const CHARACTER_MODES = ['auto', 'none', 'optional', 'required'] as const;
export type CharacterMode = (typeof CHARACTER_MODES)[number];

export const CHARACTER_KINDS = ['human', 'animal', 'creature', 'monster', 'robot', 'alien', 'object', 'vehicle', 'shadow', 'abstract'] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];

export const OBJECTS = [
  'phone', 'laptop', 'computer', 'tv', 'table', 'chair', 'bed', 'nightstand', 'door', 'window',
  'curtain', 'lamp', 'book', 'cup', 'bottle', 'clock', 'bag', 'mirror', 'box', 'key', 'sign',
  'plant', 'poster', 'shelf', 'rug', 'car', 'tree', 'streetlight',
] as const;
export type ObjType = (typeof OBJECTS)[number];

/** Object states — these animate (vibrating phone, swinging door, flickering lamp…). */
export const OBJ_STATES = ['default', 'on', 'off', 'open', 'closed', 'locked', 'vibrating', 'flickering', 'broken', 'moving', 'falling', 'glowing'] as const;
export type ObjState = (typeof OBJ_STATES)[number];

export const OBJ_POSITIONS = ['far_left', 'left', 'center', 'right', 'far_right', 'character_hand', 'foreground', 'background'] as const;
export type ObjPos = (typeof OBJ_POSITIONS)[number];

export const EFFECTS = [
  'rain', 'snow', 'fog', 'smoke', 'dust', 'fire', 'sparks', 'particles', 'lightning', 'glow',
  'wind', 'floating_dust', 'moving_shadows', 'screen_flicker', 'shadow', 'window_reflection',
] as const;
export type EffectType = (typeof EFFECTS)[number];

export const SHOTS = ['wide', 'establishing', 'medium', 'close_up', 'extreme_close_up', 'pov', 'low_angle', 'high_angle', 'top_down', 'over_shoulder', 'side_view'] as const;
export type ShotType = (typeof SHOTS)[number];

export const CAMERA_MOVES = ['static', 'slow_zoom_in', 'slow_zoom_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'tracking', 'orbit', 'handheld', 'shake'] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export const TRANSITIONS = ['crossfade', 'fade', 'fade_black', 'blur', 'cut'] as const;
export type SceneTransition = (typeof TRANSITIONS)[number];

export const VISUAL_STYLES = [
  'cinematic_2d', 'cartoon', 'dark_cartoon', 'comic', 'minimal', 'flat', 'stylized',
  'horror', 'noir', 'neon', 'dreamlike', 'documentary',
] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

export const AGES = ['child', 'teen', 'young_adult', 'adult', 'elder'] as const;
export type AgeGroup = (typeof AGES)[number];

export const HAIR_STYLES = ['short', 'long', 'messy', 'bun', 'bald', 'curly', 'ponytail', 'hat', 'hood'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const BUILDS = ['slim', 'average', 'heavy', 'tall'] as const;
export type Build = (typeof BUILDS)[number];

export const ACCESSORIES = ['none', 'glasses', 'hood', 'cap', 'scarf', 'headphones', 'backpack'] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export const INTERACTION_VERBS = ['open', 'close', 'pick_up', 'drop', 'push', 'look_at', 'point_at', 'use', 'enter', 'exit', 'approach', 'avoid', 'break', 'turn_on', 'turn_off'] as const;
export type InteractionVerb = (typeof INTERACTION_VERBS)[number];

// ---------------------------------------------------------------- shapes

/** Persistent identity — created ONCE, reused in every scene (visual continuity). */
export interface CharacterDef {
  id: string;
  name: string;
  kind: CharacterKind;
  age: AgeGroup;
  /** Primary body colour (skin / fur / chassis / energy). */
  skin: string;
  hairColor: string;
  hairStyle: HairStyle;
  topColor: string;
  bottomColor: string;
  shoeColor: string;
  build: Build;
  accessory: Accessory;
  accessoryColor: string;
  /** Kind-specific trait, e.g. 'cat' | 'dog' | 'bird' for animal, 'sedan' | 'van' for vehicle. */
  variant: string;
}

/** A character as it appears inside one scene. */
export interface CharacterInScene {
  id: string;
  emotion: Emotion;
  /** Chained actions: walk → stop → look → react. Played in order across the scene. */
  actions: ActionType[];
  position: ScreenPos;
  note: string;
  facing: 'left' | 'right';
  scale: number;
}

export interface ObjectInScene {
  id: string;
  type: ObjType;
  position: ObjPos;
  state: ObjState;
  scale: number;
}

export interface Interaction {
  actor: string; // character id or object id
  verb: InteractionVerb;
  target: string; // object id or character id
}

export interface SceneSpec {
  scene: number;
  duration: number;
  characterMode: CharacterMode;
  environment: { type: EnvType; time: TimeOfDay; weather: Weather };
  lighting: { style: LightStyle; direction: LightDir; intensity: number };
  characters: CharacterInScene[];
  objects: ObjectInScene[];
  interactions: Interaction[];
  effects: EffectType[];
  camera: { shot: ShotType; movement: CameraMove; target: string | null };
  transition: SceneTransition;
  visualNote: string;
}

export interface StyleBible {
  style: VisualStyle;
  palette: { primary: string; secondary: string; accent: string; shadow: string; sky: string };
  moodNotes: string;
  characters: CharacterDef[];
  locations: { id: string; type: EnvType; notes: string }[];
  locked: boolean;
}

/** Continuity carried between scenes: object states, location, time, weather, light. */
export interface ContinuityState {
  objectStates: Record<string, ObjState>;
  lastEnvironment: EnvType | null;
  lastTime: TimeOfDay | null;
  lastWeather: Weather | null;
  lastLight: LightStyle | null;
  presentCharacters: string[];
}

export function emptyContinuity(): ContinuityState {
  return { objectStates: {}, lastEnvironment: null, lastTime: null, lastWeather: null, lastLight: null, presentCharacters: [] };
}

// ---------------------------------------------------------------- repair helpers

function nearest<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback;
  const v = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if ((allowed as readonly string[]).includes(v)) return v as T;
  const sub = allowed.find((a) => v.includes(a) || a.includes(v));
  if (sub) return sub;
  const tokens = v.split('_').filter(Boolean);
  let best: T | null = null;
  let bestScore = 0;
  for (const a of allowed) {
    const at = a.split('_');
    const score = tokens.filter((t) => at.some((x) => x.startsWith(t.slice(0, 4)) || t.startsWith(x.slice(0, 4)))).length;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ?? fallback;
}

function clamp(n: unknown, min: number, max: number, def: number) {
  const v = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}

const NAMED: Record<string, string> = {
  red: '#e03131', blue: '#1971c2', green: '#2f9e44', yellow: '#f59f00', orange: '#e8590c', purple: '#7048e8',
  pink: '#d6336c', black: '#16181c', white: '#f1f3f5', gray: '#868e96', grey: '#868e96', brown: '#8d5524',
  teal: '#0c8599', navy: '#1c3d8f', beige: '#e8d7bd', cyan: '#15aabf', dark: '#212529', light: '#dee2e6',
  blonde: '#d9a441', ginger: '#c1440e', silver: '#adb5bd', gold: '#f0a500',
};
function colorOf(v: unknown, fb: string): string {
  if (typeof v !== 'string') return fb;
  const t = v.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(t)) return t;
  if (/^[0-9a-f]{6}$/i.test(t)) return '#' + t;
  const key = t.toLowerCase();
  for (const k of Object.keys(NAMED)) if (key.includes(k)) return NAMED[k];
  return fb;
}

const ENV_KEYWORDS: [RegExp, EnvType][] = [
  [/hallway|corridor|koridor/i, 'hallway'],
  [/bed|sleep|dream|pillow|bedroom|yatak|uyku|rüya/i, 'bedroom'],
  [/kitchen|cook|food|mutfak|yemek/i, 'kitchen'],
  [/office|work|desk|meeting|ofis|iş|çalış/i, 'office'],
  [/class|school|student|teacher|okul|sınıf|öğrenci/i, 'classroom'],
  [/hospital|doctor|nurse|patient|hastane|doktor/i, 'hospital'],
  [/rooftop|roof|çatı/i, 'rooftop'],
  [/basement|cellar|bodrum/i, 'basement'],
  [/apartment|flat|daire/i, 'apartment'],
  [/street|road|sidewalk|alley|sokak|cadde|yol/i, 'street'],
  [/city|urban|skyline|building|şehir|kent|bina/i, 'city'],
  [/forest|tree|wood|jungle|orman|ağaç/i, 'forest'],
  [/park|garden|bench|bahçe|park/i, 'park'],
  [/beach|sea|ocean|wave|sand|deniz|plaj|kum/i, 'beach'],
  [/store|shop|market|mağaza|dükkan/i, 'store'],
  [/warehouse|factory|depo|fabrika/i, 'warehouse'],
  [/cave|tunnel|underground|mağara|tünel/i, 'cave'],
  [/space|star|planet|galaxy|cosmos|uzay|yıldız|gezegen/i, 'space'],
  [/living|sofa|couch|salon|oturma/i, 'living_room'],
  [/house|home|ev/i, 'house'],
  [/abstract|mind|idea|concept|soyut|zihin|fikir/i, 'abstract'],
];

export function inferEnvironment(text: string): EnvType {
  for (const [re, env] of ENV_KEYWORDS) if (re.test(text)) return env;
  return 'abstract';
}

const EMOTION_KEYWORDS: [RegExp, Emotion][] = [
  [/shock|stunned|şok/i, 'shocked'],
  [/evil|sinister|menac|kötü|şeytan/i, 'evil'],
  [/happy|joy|smile|great|mutlu|sevin/i, 'happy'],
  [/sad|cry|lonely|loss|üzgün|hüzün|ağla/i, 'sad'],
  [/angry|rage|furious|kız|öfke/i, 'angry'],
  [/scare|fear|terror|afraid|kork|dehşet/i, 'scared'],
  [/surpris|sudden|şaşır/i, 'surprised'],
  [/confus|puzzl|wonder|kafa karış|şaşkın/i, 'confused'],
  [/tired|exhaust|sleep|yorgun|uyku/i, 'tired'],
  [/worri|anxious|nervous|endişe|kaygı/i, 'worried'],
  [/excite|amaz|thrill|heyecan|harika/i, 'excited'],
];

export function inferEmotion(text: string): Emotion {
  for (const [re, e] of EMOTION_KEYWORDS) if (re.test(text)) return e;
  return 'neutral';
}

/** Detects whether narration implies a living subject — used by characterMode 'auto'/'optional'. */
export function narrationNeedsCharacter(text: string): boolean {
  return /\b(he|she|they|you|i|we|someone|person|man|woman|child|boy|girl|people|doctor|student|driver|animal|dog|cat|robot|creature|monster)\b/i.test(text)
    || /\b(biri|kişi|adam|kadın|çocuk|insan|insanlar|sen|ben|biz|onlar|köpek|kedi|robot|yaratık|canavar)\b/i.test(text);
}

/** Objects that the narration itself hints at, so empty-room scenes still get props. */
const OBJ_KEYWORDS: [RegExp, ObjType][] = [
  [/phone|telefon/i, 'phone'],
  [/laptop|dizüstü/i, 'laptop'],
  [/computer|bilgisayar/i, 'computer'],
  [/\btv\b|television|televizyon/i, 'tv'],
  [/door|kapı/i, 'door'],
  [/window|pencere/i, 'window'],
  [/lamp|light bulb|lamba/i, 'lamp'],
  [/book|kitap/i, 'book'],
  [/clock|time|saat/i, 'clock'],
  [/mirror|ayna/i, 'mirror'],
  [/car|araba|araç/i, 'car'],
  [/\bkey\b|anahtar/i, 'key'],
  [/\bbox\b|kutu/i, 'box'],
  [/bottle|şişe/i, 'bottle'],
  [/\bbed\b|yatak/i, 'bed'],
  [/sign|tabela/i, 'sign'],
];
export function inferObjects(text: string): ObjType[] {
  const out: ObjType[] = [];
  for (const [re, o] of OBJ_KEYWORDS) if (re.test(text) && !out.includes(o)) out.push(o);
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- defaults

const KIND_PALETTES: Record<CharacterKind, { skin: string; hair: string; top: string; bottom: string; shoe: string; variant: string }> = {
  human: { skin: '#e8b98a', hair: '#2b2118', top: '#3b5bdb', bottom: '#343a40', shoe: '#212529', variant: 'person' },
  animal: { skin: '#b5651d', hair: '#7a4312', top: '#b5651d', bottom: '#8d5524', shoe: '#2b2118', variant: 'dog' },
  creature: { skin: '#5f9e6e', hair: '#2f5d3a', top: '#5f9e6e', bottom: '#3d6b48', shoe: '#1e2d24', variant: 'spirit' },
  monster: { skin: '#6b2d5c', hair: '#2a1030', top: '#6b2d5c', bottom: '#38152f', shoe: '#120611', variant: 'beast' },
  robot: { skin: '#b0bac6', hair: '#7b8794', top: '#8d99a6', bottom: '#5c6773', shoe: '#2f3740', variant: 'android' },
  alien: { skin: '#8fe3a1', hair: '#3fae5e', top: '#2fa36a', bottom: '#1d6b47', shoe: '#10402c', variant: 'grey' },
  object: { skin: '#c9a227', hair: '#8a6d1b', top: '#c9a227', bottom: '#8a6d1b', shoe: '#5c480f', variant: 'artifact' },
  vehicle: { skin: '#c92a2a', hair: '#1c1f24', top: '#c92a2a', bottom: '#1c1f24', shoe: '#101317', variant: 'sedan' },
  shadow: { skin: '#15161c', hair: '#0a0b0f', top: '#15161c', bottom: '#0a0b0f', shoe: '#05060a', variant: 'figure' },
  abstract: { skin: '#7c6cf0', hair: '#4b3fd0', top: '#7c6cf0', bottom: '#4b3fd0', shoe: '#2b2490', variant: 'form' },
};

const HUMAN_PALETTES = [
  { skin: '#e8b98a', hair: '#2b2118', top: '#3b5bdb', bottom: '#343a40', shoe: '#212529' },
  { skin: '#c9865a', hair: '#1a1410', top: '#c2255c', bottom: '#495057', shoe: '#212529' },
  { skin: '#f3d2b3', hair: '#9c6644', top: '#2f9e44', bottom: '#212529', shoe: '#343a40' },
  { skin: '#8d5524', hair: '#140f0b', top: '#f08c00', bottom: '#1864ab', shoe: '#212529' },
];

export function defaultCharacter(id: string, index = 0, kind: CharacterKind = 'human'): CharacterDef {
  const k = KIND_PALETTES[kind];
  const p = kind === 'human' ? HUMAN_PALETTES[index % HUMAN_PALETTES.length] : k;
  return {
    id,
    name: id,
    kind,
    age: 'young_adult',
    skin: p.skin,
    hairColor: p.hair,
    hairStyle: 'short',
    topColor: p.top,
    bottomColor: p.bottom,
    shoeColor: p.shoe,
    build: 'average',
    accessory: 'none',
    accessoryColor: '#dee2e6',
    variant: k.variant,
  };
}

export function validateCharacterDef(raw: unknown, index: number): CharacterDef {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = String(o.id ?? `character_${String(index + 1).padStart(2, '0')}`).trim() || `character_${index + 1}`;
  const kind = nearest(o.kind ?? o.type, CHARACTER_KINDS, 'human');
  const base = defaultCharacter(id, index, kind);
  return {
    id,
    name: String(o.name ?? id).slice(0, 40),
    kind,
    age: nearest(o.age, AGES, base.age),
    skin: colorOf(o.skin ?? o.color ?? o.body_color, base.skin),
    hairColor: colorOf(o.hair_color ?? o.hairColor, base.hairColor),
    hairStyle: nearest(o.hair_style ?? o.hairStyle, HAIR_STYLES, base.hairStyle),
    topColor: colorOf(o.top_color ?? o.topColor ?? o.shirt, base.topColor),
    bottomColor: colorOf(o.bottom_color ?? o.bottomColor ?? o.pants, base.bottomColor),
    shoeColor: colorOf(o.shoe_color ?? o.shoeColor, base.shoeColor),
    build: nearest(o.build, BUILDS, base.build),
    accessory: nearest(o.accessory, ACCESSORIES, base.accessory),
    accessoryColor: colorOf(o.accessory_color, base.accessoryColor),
    variant: String(o.variant ?? base.variant).slice(0, 24),
  };
}

export function defaultStyleBible(): StyleBible {
  return {
    style: 'cinematic_2d',
    palette: { primary: '#4c6ef5', secondary: '#15aabf', accent: '#f59f00', shadow: '#0b0d12', sky: '#1c2333' },
    moodNotes: '',
    characters: [],
    locations: [],
    locked: false,
  };
}

export function validateStyleBible(raw: unknown): StyleBible {
  const o = (raw ?? {}) as Record<string, unknown>;
  const base = defaultStyleBible();
  const pal = (o.palette ?? {}) as Record<string, unknown>;
  const chars = Array.isArray(o.characters) ? o.characters.slice(0, 4).map((c, i) => validateCharacterDef(c, i)) : [];
  return {
    style: nearest(o.style ?? o.visual_style, VISUAL_STYLES, base.style),
    palette: {
      primary: colorOf(pal.primary, base.palette.primary),
      secondary: colorOf(pal.secondary, base.palette.secondary),
      accent: colorOf(pal.accent, base.palette.accent),
      shadow: colorOf(pal.shadow, base.palette.shadow),
      sky: colorOf(pal.sky, base.palette.sky),
    },
    moodNotes: String(o.mood_notes ?? o.moodNotes ?? '').slice(0, 300),
    characters: chars,
    locations: Array.isArray(o.locations)
      ? o.locations.slice(0, 8).map((l, i) => {
          const lo = (l ?? {}) as Record<string, unknown>;
          return { id: String(lo.id ?? `location_${i + 1}`), type: nearest(lo.type, ENVIRONMENTS, 'abstract'), notes: String(lo.notes ?? '').slice(0, 120) };
        })
      : [],
    locked: false,
  };
}

// ---------------------------------------------------------------- scene validation

export interface ValidateCtx {
  index: number;
  narration: string;
  knownCharacters: string[];
  /** Global character policy from the UI. */
  mode: CharacterMode;
  continuity: ContinuityState;
}

function defaultLightFor(env: EnvType, time: TimeOfDay): LightStyle {
  if (time === 'night') return env === 'street' || env === 'city' ? 'neon' : 'night';
  if (time === 'sunset') return 'sunset';
  if (time === 'dawn') return 'cold';
  return ['bedroom', 'living_room', 'kitchen', 'office', 'classroom', 'store', 'hospital', 'warehouse', 'hallway', 'apartment', 'house', 'basement'].includes(env) ? 'warm' : 'daylight';
}

/** Props that make an environment feel furnished when the LLM lists none. */
const ENV_PROPS: Record<EnvType, { type: ObjType; position: ObjPos }[]> = {
  bedroom: [{ type: 'bed', position: 'left' }, { type: 'nightstand', position: 'center' }, { type: 'lamp', position: 'center' }, { type: 'window', position: 'right' }, { type: 'curtain', position: 'right' }, { type: 'poster', position: 'far_left' }],
  living_room: [{ type: 'chair', position: 'left' }, { type: 'table', position: 'center' }, { type: 'tv', position: 'right' }, { type: 'rug', position: 'center' }, { type: 'plant', position: 'far_right' }],
  kitchen: [{ type: 'table', position: 'center' }, { type: 'cup', position: 'center' }, { type: 'window', position: 'right' }, { type: 'bottle', position: 'left' }],
  office: [{ type: 'table', position: 'center' }, { type: 'computer', position: 'center' }, { type: 'chair', position: 'right' }, { type: 'shelf', position: 'far_left' }, { type: 'clock', position: 'far_right' }],
  classroom: [{ type: 'table', position: 'left' }, { type: 'table', position: 'right' }, { type: 'poster', position: 'center' }, { type: 'clock', position: 'far_right' }],
  hallway: [{ type: 'door', position: 'center' }, { type: 'door', position: 'far_left' }, { type: 'lamp', position: 'right' }, { type: 'sign', position: 'far_right' }],
  street: [{ type: 'streetlight', position: 'right' }, { type: 'car', position: 'left' }, { type: 'sign', position: 'far_right' }],
  city: [{ type: 'streetlight', position: 'far_right' }, { type: 'car', position: 'center' }],
  forest: [{ type: 'tree', position: 'left' }, { type: 'tree', position: 'right' }, { type: 'tree', position: 'far_left' }],
  park: [{ type: 'tree', position: 'far_left' }, { type: 'chair', position: 'center' }, { type: 'tree', position: 'far_right' }],
  beach: [{ type: 'chair', position: 'left' }, { type: 'bottle', position: 'right' }],
  hospital: [{ type: 'bed', position: 'center' }, { type: 'door', position: 'far_left' }, { type: 'sign', position: 'right' }],
  store: [{ type: 'shelf', position: 'left' }, { type: 'shelf', position: 'right' }, { type: 'sign', position: 'center' }],
  warehouse: [{ type: 'box', position: 'left' }, { type: 'box', position: 'center' }, { type: 'box', position: 'far_right' }, { type: 'lamp', position: 'center' }],
  basement: [{ type: 'box', position: 'left' }, { type: 'lamp', position: 'center' }, { type: 'shelf', position: 'right' }],
  cave: [{ type: 'box', position: 'far_right' }],
  rooftop: [{ type: 'box', position: 'left' }, { type: 'sign', position: 'right' }],
  apartment: [{ type: 'chair', position: 'left' }, { type: 'table', position: 'center' }, { type: 'window', position: 'right' }, { type: 'plant', position: 'far_right' }],
  house: [{ type: 'door', position: 'center' }, { type: 'window', position: 'right' }, { type: 'tree', position: 'far_left' }],
  space: [],
  abstract: [],
};

export function validateSceneSpec(raw: unknown, ctx: ValidateCtx): SceneSpec {
  const o = (raw ?? {}) as Record<string, unknown>;
  const envRaw = (o.environment ?? {}) as Record<string, unknown>;
  const lightRaw = (o.lighting ?? {}) as Record<string, unknown>;
  const camRaw = (o.camera ?? {}) as Record<string, unknown>;
  const { index, narration, knownCharacters, continuity } = ctx;

  // ----- environment (with continuity fallback) -----
  let envType = envRaw.type !== undefined ? nearest(envRaw.type, ENVIRONMENTS, inferEnvironment(narration)) : inferEnvironment(narration);
  if (envType === 'abstract' && continuity.lastEnvironment && inferEnvironment(narration) === 'abstract') envType = continuity.lastEnvironment;
  const time = envRaw.time !== undefined ? nearest(envRaw.time, TIMES, continuity.lastTime ?? 'day') : continuity.lastTime ?? (envType === 'space' || envType === 'cave' || envType === 'basement' ? 'night' : 'day');
  const weather = envRaw.weather !== undefined ? nearest(envRaw.weather, WEATHERS, 'clear') : continuity.lastWeather ?? 'clear';

  // ----- character policy -----
  const llmMode = nearest(o.character_mode ?? o.characterMode, CHARACTER_MODES, 'auto');
  const mode: CharacterMode = ctx.mode === 'auto' ? llmMode : ctx.mode;

  let chars: CharacterInScene[] = [];
  if (mode !== 'none' && Array.isArray(o.characters)) {
    chars = o.characters.slice(0, 3).map((c, i) => {
      const co = (c ?? {}) as Record<string, unknown>;
      let id = String(co.id ?? '').trim();
      if (!knownCharacters.includes(id)) id = knownCharacters[Math.min(i, Math.max(0, knownCharacters.length - 1))] ?? `character_${String(i + 1).padStart(2, '0')}`;
      const rawActions = co.actions ?? co.action ?? co.pose;
      const list = Array.isArray(rawActions) ? rawActions : typeof rawActions === 'string' ? rawActions.split(/[,>→]+/) : [];
      const actions = list.map((a) => nearest(a, ACTIONS, 'idle')).filter((a, j, arr) => arr.indexOf(a) === j || j === 0).slice(0, 4);
      return {
        id,
        emotion: co.emotion !== undefined ? nearest(co.emotion, EMOTIONS, inferEmotion(narration)) : inferEmotion(narration),
        actions: actions.length ? actions : ['idle'],
        position: nearest(co.position, POSITIONS, i === 0 ? 'center' : i === 1 ? 'left' : 'right'),
        note: String(co.note ?? co.description ?? '').slice(0, 80),
        facing: co.facing === 'left' ? 'left' : 'right',
        scale: clamp(co.scale, 0.5, 1.6, 1),
      };
    });
  }

  if (mode === 'none') chars = [];
  else if (mode === 'required' && !chars.length) {
    chars = [{ id: knownCharacters[0] ?? 'character_01', emotion: inferEmotion(narration), actions: ['idle'], position: 'center', note: '', facing: 'right', scale: 1 }];
  } else if (mode === 'optional' && !chars.length && narrationNeedsCharacter(narration)) {
    chars = [{ id: knownCharacters[0] ?? 'character_01', emotion: inferEmotion(narration), actions: ['idle'], position: 'center', note: '', facing: 'right', scale: 1 }];
  }
  // 'auto' leaves the LLM's choice alone — empty scenes (a corridor, a buzzing phone) stay empty.

  // ----- objects (+ environment dressing + narration hints) -----
  const listed: ObjectInScene[] = Array.isArray(o.objects)
    ? o.objects.slice(0, 8).map((x, i) => {
        const xo = (x ?? {}) as Record<string, unknown>;
        const t = typeof x === 'string' ? x : xo.type;
        const type = nearest(t, OBJECTS, 'box');
        const id = String(xo.id ?? `${type}_${i + 1}`);
        return {
          id,
          type,
          position: nearest(xo.position, OBJ_POSITIONS, 'center'),
          state: nearest(xo.state, OBJ_STATES, continuity.objectStates[id] ?? 'default'),
          scale: clamp(xo.scale, 0.4, 2.4, 1),
        };
      })
    : [];

  const objs: ObjectInScene[] = [...listed];
  for (const hinted of inferObjects(narration)) {
    if (!objs.some((x) => x.type === hinted)) objs.push({ id: `${hinted}_h`, type: hinted, position: objs.length % 2 ? 'left' : 'right', state: continuity.objectStates[`${hinted}_h`] ?? 'default', scale: 1 });
  }
  // dress the set so rooms are never empty boxes
  for (const p of ENV_PROPS[envType] ?? []) {
    if (objs.length >= 8) break;
    if (objs.some((x) => x.type === p.type && x.position === p.position)) continue;
    objs.push({ id: `${p.type}_${p.position}`, type: p.type, position: p.position, state: continuity.objectStates[`${p.type}_${p.position}`] ?? 'default', scale: 1 });
  }

  // ----- interactions -----
  const interactions: Interaction[] = Array.isArray(o.interactions)
    ? o.interactions.slice(0, 4).map((x) => {
        const xo = (x ?? {}) as Record<string, unknown>;
        return { actor: String(xo.actor ?? chars[0]?.id ?? ''), verb: nearest(xo.verb ?? xo.action, INTERACTION_VERBS, 'look_at'), target: String(xo.target ?? objs[0]?.id ?? '') };
      }).filter((x) => x.actor && x.target)
    : [];

  // ----- effects -----
  const fx: EffectType[] = Array.isArray(o.effects) ? [...new Set(o.effects.map((e) => nearest(e, EFFECTS, 'floating_dust')))].slice(0, 5) : [];
  if (weather === 'rain' && !fx.includes('rain')) fx.push('rain');
  if (weather === 'snow' && !fx.includes('snow')) fx.push('snow');
  if (weather === 'fog' && !fx.includes('fog')) fx.push('fog');
  if (weather === 'wind' && !fx.includes('wind')) fx.push('wind');
  if (weather === 'storm') {
    if (!fx.includes('rain')) fx.push('rain');
    if (!fx.includes('lightning')) fx.push('lightning');
  }
  // empty-room scenes get subtle life so they are never a flat picture
  if (!chars.length && fx.length < 2 && !fx.includes('floating_dust')) fx.push('floating_dust');

  // ----- camera -----
  const shot = nearest(camRaw.shot, SHOTS, index === 0 ? 'establishing' : chars.length ? 'medium' : 'wide');
  let target = typeof camRaw.target === 'string' && camRaw.target.trim() ? camRaw.target.trim() : null;
  if (target && !objs.some((x) => x.id === target) && !chars.some((c) => c.id === target)) {
    const match = objs.find((x) => target!.includes(x.type)) ?? null;
    target = match ? match.id : chars[0]?.id ?? objs[0]?.id ?? null;
  }
  if (!target) target = chars[0]?.id ?? objs.find((x) => x.position !== 'background')?.id ?? null;

  return {
    scene: index + 1,
    duration: clamp(o.duration, 1.5, 30, 5),
    characterMode: mode,
    environment: { type: envType, time, weather },
    lighting: {
      style: lightRaw.style !== undefined ? nearest(lightRaw.style, LIGHT_STYLES, defaultLightFor(envType, time)) : defaultLightFor(envType, time),
      direction: nearest(lightRaw.direction, LIGHT_DIRS, 'top'),
      intensity: clamp(lightRaw.intensity, 0.05, 1, time === 'night' ? 0.4 : 0.8),
    },
    characters: chars,
    objects: objs.slice(0, 9),
    interactions,
    effects: fx,
    camera: { shot, movement: nearest(camRaw.movement, CAMERA_MOVES, (['slow_zoom_in', 'pan_right', 'slow_zoom_out', 'pan_left'] as const)[index % 4]), target },
    transition: nearest(o.transition, TRANSITIONS, 'crossfade'),
    visualNote: String(o.visual_note ?? o.visualNote ?? o.description ?? '').slice(0, 200),
  };
}

/** Applies a finished scene to the running continuity state. */
export function advanceContinuity(cont: ContinuityState, spec: SceneSpec): ContinuityState {
  const objectStates = { ...cont.objectStates };
  for (const o of spec.objects) if (o.state !== 'default') objectStates[o.id] = o.state;
  for (const it of spec.interactions) {
    if (it.verb === 'open') objectStates[it.target] = 'open';
    if (it.verb === 'close') objectStates[it.target] = 'closed';
    if (it.verb === 'turn_on') objectStates[it.target] = 'on';
    if (it.verb === 'turn_off') objectStates[it.target] = 'off';
    if (it.verb === 'break') objectStates[it.target] = 'broken';
    if (it.verb === 'drop') objectStates[it.target] = 'falling';
  }
  return {
    objectStates,
    lastEnvironment: spec.environment.type,
    lastTime: spec.environment.time,
    lastWeather: spec.environment.weather,
    lastLight: spec.lighting.style,
    presentCharacters: spec.characters.map((c) => c.id),
  };
}

// ---------------------------------------------------------------- labels

export const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: 'Neutral', happy: 'Happy', sad: 'Sad', angry: 'Angry', scared: 'Scared', confused: 'Confused',
  surprised: 'Surprised', worried: 'Worried', shocked: 'Shocked', evil: 'Evil', tired: 'Tired', excited: 'Excited',
};
export const SHOT_LABELS: Record<ShotType, string> = {
  wide: 'Wide', establishing: 'Establishing', medium: 'Medium', close_up: 'Close-up', extreme_close_up: 'Extreme close-up',
  pov: 'POV', low_angle: 'Low angle', high_angle: 'High angle', top_down: 'Top-down', over_shoulder: 'Over shoulder', side_view: 'Side view',
};
export const MOVE_LABELS: Record<CameraMove, string> = {
  static: 'Static', slow_zoom_in: 'Slow zoom in', slow_zoom_out: 'Slow zoom out', pan_left: 'Pan left', pan_right: 'Pan right',
  tilt_up: 'Tilt up', tilt_down: 'Tilt down', tracking: 'Tracking', orbit: 'Orbit', handheld: 'Handheld', shake: 'Shake',
};
export const STYLE_LABELS: Record<VisualStyle, string> = {
  cinematic_2d: 'Cinematic 2D', cartoon: 'Cartoon', dark_cartoon: 'Dark Cartoon', comic: 'Comic', minimal: 'Minimal',
  flat: 'Flat 2D', stylized: 'Stylized', horror: 'Horror', noir: 'Noir', neon: 'Neon', dreamlike: 'Dreamlike', documentary: 'Documentary Illustration',
};
export const MODE_LABELS: Record<CharacterMode, string> = { auto: 'Auto', none: 'No Character', optional: 'Optional', required: 'Required' };
