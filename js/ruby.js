/**
 * ruby.js — furigana notation for content files.
 *
 * Older content stores furigana as segment arrays:
 *   [{ "b": "電車", "r": "でんしゃ" }, { "b": "に" }, { "b": "乗", "r": "の" }, { "b": "る" }]
 * Newer content can write the same thing inline, which is far easier to
 * author and to proofread:
 *   "{電車|でんしゃ}に{乗|の}る"
 *
 * Both forms are accepted everywhere; this module turns the inline form into
 * segments. It has no DOM dependency, so the build tools use it too.
 */

const TOKEN = /\{([^|{}]+)\|([^{}]+)\}/g;

/** "{電車|でんしゃ}に…" → [{ b: '電車', r: 'でんしゃ' }, { b: 'に' }, …] */
export function parseRuby(src) {
  const out = [];
  let last = 0;
  for (const m of String(src).matchAll(TOKEN)) {
    if (m.index > last) out.push({ b: src.slice(last, m.index) });
    out.push({ b: m[1], r: m[2] });
    last = m.index + m[0].length;
  }
  if (last < String(src).length) out.push({ b: String(src).slice(last) });
  return out;
}

/** Accepts either form (or nothing) and always returns segments or null. */
export function toSegments(value) {
  if (Array.isArray(value)) return value.length ? value : null;
  if (typeof value === 'string' && value) return parseRuby(value);
  return null;
}

/** The plain text the segments spell out. */
export function rubyText(value) {
  return (toSegments(value) || []).map((s) => s.b).join('');
}

/** The whole thing in kana — what text-to-speech reads most reliably. */
export function rubyReading(value) {
  return (toSegments(value) || []).map((s) => s.r || s.b).join('');
}

/** True if a string contains any kanji (CJK unified ideographs, incl. 々). */
export function hasKanji(text) {
  return /[㐀-鿿豈-﫿々]/.test(String(text));
}

const KANJI_RUN = /([㐀-鿿豈-﫿々〆ヵヶ]+)|([^㐀-鿿豈-﫿々〆ヵヶ]+)/g;
const toHiragana = (s) => String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Spread a whole-word kana reading over the kanji in a text, using the kana
 * the text already contains as anchors:
 *   alignReading('食べ物', 'たべもの') → '{食|た}べ{物|もの}'
 * Used for words the learner types in with a reading. Returns notation, or
 * null if the reading doesn't fit the text (the caller then falls back to
 * one reading over the whole thing).
 */
export function alignReading(text, reading) {
  const runs = [...String(text).matchAll(KANJI_RUN)].map((m) => ({ kanji: Boolean(m[1]), s: m[0] }));
  if (!runs.some((r) => r.kanji) || !reading) return null;
  const pattern = `^${runs.map((r) => (r.kanji ? '(.+?)' : `(${escapeRe(toHiragana(r.s))})`)).join('')}$`;
  const m = toHiragana(reading.replace(/\s+/g, '')).match(new RegExp(pattern, 'u'));
  if (!m) return null;
  return runs.map((r, i) => (r.kanji ? `{${r.s}|${m[i + 1]}}` : r.s)).join('');
}
