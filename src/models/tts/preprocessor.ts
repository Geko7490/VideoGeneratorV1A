import type { Language, PronunciationRule, TtsCleanResult } from '../../types';

/**
 * TTS TEXT PREPROCESSOR
 * LLM narration is never sent raw to the speech model. It is cleaned, pronunciation-corrected and
 * split into sentences so each one can be synthesized (and retried) independently.
 */

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const MARKDOWN_RE = /(\*\*|__|\*|_|`|~~|#+\s*|>\s*|!\[.*?\]\(.*?\)|\[([^\]]*)\]\(.*?\))/g;
/** Director notes / production directions the voice must not read aloud. */
const DIRECTION_RE = /(\(|\[)\s*(?:scene|shot|cut to|sfx|music|fade|camera|visual|voice ?over|narrator|pause|beat|b-?roll|on screen|text on screen)[^)\]]*(\)|\])/gi;
const STRAY_SYMBOL_RE = / [--]+ | [•·▪] /g;

export function cleanForTts(raw: string, rules: PronunciationRule[], language: Language): TtsCleanResult {
  const removed: string[] = [];
  let text = raw;

  const strip = (re: RegExp, label: string) => {
    const before = text;
    text = text.replace(re, ' ');
    if (before !== text) removed.push(label);
  };

  strip(MARKDOWN_RE, 'markdown formatting');
  strip(URL_RE, 'URLs');
  strip(DIRECTION_RE, 'production directions');
  strip(EMOJI_RE, 'emojis');
  strip(STRAY_SYMBOL_RE, 'stray symbols');

  // Normalise punctuation so the synth produces natural pauses.
  text = text.replace(/\s+([,.;:!?])/g, '$1');
  text = text.replace(/([,.;:!?])(?=[^\s])/g, '$1 ');
  text = text.replace(/\s{2,}/g, ' ');
  text = text.replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.');
  text = text.trim();

  // Pronunciation dictionary (word-boundary, case-insensitive, longest match first).
  const pronunciationApplied: string[] = [];
  const applicable = rules.filter((r) => r.language === 'any' || r.language === language);
  for (const rule of [...applicable].sort((a, b) => b.word.length - a.word.length)) {
    const re = new RegExp(`\\b${rule.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (re.test(text)) {
      text = text.replace(re, rule.speakAs);
      pronunciationApplied.push(`${rule.word} → ${rule.speakAs}`);
    }
  }

  // Sentence segmentation: keep terminal punctuation, split very long runs at commas.
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .flatMap((s) => (s.length > 240 ? s.split(/(?<=,)\s+/).reduce<string[]>((acc, part) => (acc.length && (acc[acc.length - 1] + ' ' + part).length < 200 ? [...acc.slice(0, -1), acc[acc.length - 1] + ' ' + part] : [...acc, part]), []) : [s]))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { clean: text, sentences: sentences.length ? sentences : text ? [text] : [], removed: [...new Set(removed)], pronunciationApplied };
}

/** Concatenates per-sentence PCM with a small inter-sentence pause, returning mono Float32 audio. */
export function concatSentenceAudio(chunks: { samples: Float32Array; sampleRate: number }[], pauseSec = 0.16): { samples: Float32Array; sampleRate: number } {
  if (!chunks.length) return { samples: new Float32Array(0), sampleRate: 24000 };
  const sr = chunks[0].sampleRate;
  const pause = Math.round(pauseSec * sr);
  const total = chunks.reduce((a, c) => a + c.samples.length + pause, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    // resample by naive linear interpolation when a sentence came back at a different rate
    if (c.sampleRate === sr) out.set(c.samples, o);
    else {
      const ratio = c.sampleRate / sr;
      for (let i = 0; i < Math.floor(c.samples.length / ratio); i++) {
        const src = i * ratio;
        const i0 = Math.floor(src);
        const frac = src - i0;
        out[o + i] = (c.samples[i0] ?? 0) * (1 - frac) + (c.samples[i0 + 1] ?? 0) * frac;
      }
    }
    o += Math.floor(c.samples.length / (c.sampleRate / sr)) + pause;
  }
  return { samples: out.subarray(0, o), sampleRate: sr };
}
