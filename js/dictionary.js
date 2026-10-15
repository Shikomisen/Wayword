/**
 * dictionary.js — the offline dictionary behind "Paste a message" (README §6.14).
 *
 * A course's manifest can name a dictionary file. The Japanese course's is
 * JMdict's common words, with English meanings (content/ja/dictionary.json,
 * built by tools/make-dictionary.mjs). It downloads with the course, so
 * everything here works offline, with no external library:
 *
 *   lookupAt(dict, text, i)  the dictionary words that start at position i —
 *                            the longest match first, with inflected verbs
 *                            and adjectives traced back to their dictionary
 *                            form (食べなかった → 食べる)
 *   segment(dict, text)      the text cut into dictionary words and the rest
 *   readingOf(surface, match) how the matched text itself is read
 *                            (食べなかった → たべなかった), for furigana
 *
 * The inflection rules below are this app's own, written from Japanese
 * grammar: each turns an ending back into a less inflected one, and a chain
 * of them reaches the dictionary form. A candidate only counts if the
 * dictionary has that word, of the right kind — a rule for ichidan verbs
 * can't produce a godan verb — which is what keeps the rules from inventing
 * words. Longest match is right most of the time, not always (今日は can be
 * "hello" or 今日 + は), so the screens offer the alternatives and nothing is
 * added without a tap.
 */

import { loadContent } from './content.js';
import { alignReading, hasKanji } from './ruby.js';

/* ---------- word classes and inflection rules ---------- */

// What a form is, for the rules: an ichidan or godan verb, 来る, する, an
// い-adjective (which ない and たい forms behave as), a て-form, or a form
// nothing else attaches to.
const V1 = 1;
const V5 = 2;
const VK = 4;
const VS = 8;
const ADJ = 16;
const TE = 32;
const FINAL = 64;
const ANY = 127;

/** [inflected ending, its replacement, what the inflected form is, what the result is, why]. */
const RULES = [];
const rule = (from, to, inClass, outClass, reason) => RULES.push([from, to, inClass, outClass, reason]);

// The polite ます forms, and the past and conditional endings that share a stem.
function politeForms(stem, to, outClass) {
  rule(`${stem}ます`, to, FINAL, outClass, 'polite');
  rule(`${stem}ました`, to, FINAL, outClass, 'polite-past');
  rule(`${stem}ません`, to, FINAL, outClass, 'polite-negative');
  rule(`${stem}ませんでした`, to, FINAL, outClass, 'polite-past-negative');
  rule(`${stem}ましょう`, to, FINAL, outClass, 'lets');
}

// 行く's て and past forms are 行って and 行った, not 行いて: listed before the
// general godan rules, so "went" comes before 行う ("carried out").
for (const [ending, reason, cls] of [['って', 'te', TE], ['った', 'past', FINAL], ['ったら', 'if-when', FINAL],
  ['ったり', 'tari', FINAL], ['っちゃう', 'finish', V5]]) rule(ending, 'く', cls, V5, reason);

// Ichidan verbs: 食べる.
rule('ない', 'る', ADJ, V1, 'negative');
politeForms('', 'る', V1);
rule('た', 'る', FINAL, V1, 'past');
rule('たら', 'る', FINAL, V1, 'if-when');
rule('たり', 'る', FINAL, V1, 'tari');
rule('て', 'る', TE, V1, 'te');
rule('たい', 'る', ADJ, V1, 'want');
rule('よう', 'る', FINAL, V1, 'lets');
rule('られる', 'る', V1, V1, 'can-passive');
rule('れる', 'る', V1, V1, 'can'); // 食べれる, the everyday spoken form
rule('させる', 'る', V1, V1, 'causative');
rule('れば', 'る', FINAL, V1, 'if');
rule('ろ', 'る', FINAL, V1, 'command');
rule('ないで', 'る', FINAL, V1, 'without');
rule('なきゃ', 'る', FINAL, V1, 'have-to');
rule('ちゃう', 'る', V5, V1, 'finish');
rule('すぎる', 'る', V1, V1, 'too-much');

// Godan verbs, a row at a time: [ending, あ, い, え, お, て form, past].
const GODAN = [
  ['う', 'わ', 'い', 'え', 'お', 'って', 'った'],
  ['く', 'か', 'き', 'け', 'こ', 'いて', 'いた'],
  ['ぐ', 'が', 'ぎ', 'げ', 'ご', 'いで', 'いだ'],
  ['す', 'さ', 'し', 'せ', 'そ', 'して', 'した'],
  ['つ', 'た', 'ち', 'て', 'と', 'って', 'った'],
  ['ぬ', 'な', 'に', 'ね', 'の', 'んで', 'んだ'],
  ['ぶ', 'ば', 'び', 'べ', 'ぼ', 'んで', 'んだ'],
  ['む', 'ま', 'み', 'め', 'も', 'んで', 'んだ'],
  ['る', 'ら', 'り', 'れ', 'ろ', 'って', 'った'],
];
for (const [u, a, i, e, o, te, ta] of GODAN) {
  rule(`${a}ない`, u, ADJ, V5, 'negative');
  politeForms(i, u, V5);
  rule(`${i}たい`, u, ADJ, V5, 'want');
  rule(te, u, TE, V5, 'te');
  rule(ta, u, FINAL, V5, 'past');
  rule(`${ta}ら`, u, FINAL, V5, 'if-when');
  rule(`${ta}り`, u, FINAL, V5, 'tari');
  rule(`${e}る`, u, V1, V5, 'can');
  rule(`${a}れる`, u, V1, V5, 'passive');
  rule(`${a}せる`, u, V1, V5, 'causative');
  rule(`${o}う`, u, FINAL, V5, 'lets');
  rule(`${e}ば`, u, FINAL, V5, 'if');
  rule(`${a}ないで`, u, FINAL, V5, 'without');
  rule(`${a}なきゃ`, u, FINAL, V5, 'have-to');
  rule(`${te.slice(0, -1)}${te.endsWith('で') ? 'じゃう' : 'ちゃう'}`, u, V5, V5, 'finish');
  rule(`${i}すぎる`, u, V1, V5, 'too-much');
}
// いらっしゃる, くださる, おっしゃる, なさる, ござる: いらっしゃいます, ございます.
politeForms('い', 'る', V5);

// The ます stem with なさい (食べなさい) and ながら (食べながら).
rule('なさい', 'る', FINAL, V1, 'polite-command');
rule('ながら', 'る', FINAL, V1, 'while');
for (const [u, , i] of GODAN) {
  rule(`${i}なさい`, u, FINAL, V5, 'polite-command');
  rule(`${i}ながら`, u, FINAL, V5, 'while');
}

// する, alone or after a noun (勉強する).
rule('した', 'する', FINAL, VS, 'past');
rule('したら', 'する', FINAL, VS, 'if-when');
rule('したり', 'する', FINAL, VS, 'tari');
rule('して', 'する', TE, VS, 'te');
politeForms('し', 'する', VS);
rule('しない', 'する', ADJ, VS, 'negative');
rule('したい', 'する', ADJ, VS, 'want');
rule('しよう', 'する', FINAL, VS, 'lets');
rule('される', 'する', V1, VS, 'passive');
rule('させる', 'する', V1, VS, 'causative');
rule('できる', 'する', V1, VS, 'can');
rule('すれば', 'する', FINAL, VS, 'if');
rule('しろ', 'する', FINAL, VS, 'command');
rule('しないで', 'する', FINAL, VS, 'without');
rule('しなきゃ', 'する', FINAL, VS, 'have-to');
rule('しちゃう', 'する', V5, VS, 'finish');
rule('しなさい', 'する', FINAL, VS, 'polite-command');
rule('しながら', 'する', FINAL, VS, 'while');

// 来る, whose stem changes: 来た (きた), 来ない (こない), 来れば (くれば).
for (const [k, ki, ko, ku] of [['来', '来', '来', '来'], ['く', 'き', 'こ', 'く']]) {
  const base = `${k === '来' ? '来' : 'く'}る`;
  rule(`${ki}た`, base, FINAL, VK, 'past');
  rule(`${ki}たら`, base, FINAL, VK, 'if-when');
  rule(`${ki}て`, base, TE, VK, 'te');
  politeForms(ki, base, VK);
  rule(`${ki}たい`, base, ADJ, VK, 'want');
  rule(`${ki}ちゃう`, base, V5, VK, 'finish');
  rule(`${ki}なさい`, base, FINAL, VK, 'polite-command');
  rule(`${ki}ながら`, base, FINAL, VK, 'while');
  rule(`${ko}ない`, base, ADJ, VK, 'negative');
  rule(`${ko}よう`, base, FINAL, VK, 'lets');
  rule(`${ko}られる`, base, V1, VK, 'can-passive');
  rule(`${ko}れる`, base, V1, VK, 'can');
  rule(`${ko}させる`, base, V1, VK, 'causative');
  rule(`${ko}い`, base, FINAL, VK, 'command');
  rule(`${ko}ないで`, base, FINAL, VK, 'without');
  rule(`${ku}れば`, base, FINAL, VK, 'if');
}

// い-adjectives — and the ない and たい forms, which inflect the same way.
rule('かった', 'い', FINAL, ADJ, 'past');
rule('かったら', 'い', FINAL, ADJ, 'if-when');
rule('くない', 'い', ADJ, ADJ, 'negative');
rule('くて', 'い', FINAL, ADJ, 'te');
rule('く', 'い', FINAL, ADJ, 'adverb');
rule('ければ', 'い', FINAL, ADJ, 'if');
rule('くなる', 'い', V5, ADJ, 'become');
rule('そう', 'い', FINAL, ADJ, 'looks');
rule('すぎる', 'い', V1, ADJ, 'too');

// What attaches to a て form: いる (食べている, 食べてる), おく, しまう, ください.
for (const t of ['て', 'で']) {
  rule(`${t}いる`, t, V1, TE, 'ongoing');
  rule(`${t}る`, t, V1, TE, 'ongoing');
  rule(`${t}おく`, t, V5, TE, 'in-advance');
  rule(`${t === 'て' ? 'とく' : 'どく'}`, t, V5, TE, 'in-advance');
  rule(`${t}しまう`, t, V5, TE, 'finish');
  rule(`${t}ください`, t, FINAL, TE, 'please');
}

/** Every reason a rule can give: each is shown as the interface string inflect.<reason>. */
export const REASONS = [...new Set(RULES.map((r) => r[4]))];

/**
 * Every way the end of `word` could be undone: the word itself first, then
 * each less inflected form, with what it would have to be and why.
 */
export function deinflect(word) {
  const out = [{ word, type: ANY, reasons: [] }];
  const seen = new Map([[word, ANY]]);
  for (let n = 0; n < out.length; n++) {
    const { word: w, type, reasons } = out[n];
    if (reasons.length >= 5) continue;
    for (const [from, to, inClass, outClass, reason] of RULES) {
      // The whole word can be the ending only for する and 来る, whose rules spell out the stem (した → する).
      if (!(type & inClass) || w.length < from.length || !w.endsWith(from)) continue;
      const base = w.slice(0, w.length - from.length) + to;
      if (base.length < 2 && w.length === from.length) continue;
      const had = seen.get(base) || 0;
      if ((had & outClass) === outClass) continue;
      seen.set(base, had | outClass);
      out.push({ word: base, type: outClass, reasons: [reason, ...reasons] });
    }
  }
  return out;
}

/* ---------- the dictionary ---------- */

const KANA_OR_KANJI = /[ぁ-ヿ㐀-鿿豈-﫿々〆ヵヶ]/;
// Longer than any word plus its endings this app needs to trace (食べさせられなかった).
const MAX_LENGTH = 14;

/** Which of the rules' classes a dictionary entry belongs to, from its word-class codes. */
function classOf(pos) {
  let c = 0;
  for (const p of pos) {
    if (p === 'v1' || p === 'v1-s') c |= V1;
    else if (p.startsWith('v5')) c |= V5;
    else if (p === 'vk') c |= VK;
    else if (p === 'vs-i' || p === 'vs-s' || p === 'vz') c |= VS;
    else if (p === 'adj-i' || p === 'adj-ix') c |= ADJ;
  }
  return c;
}

/**
 * Build the lookup from a dictionary file's contents. Entries are decoded
 * only when a lookup reaches them: the index is every spelling and reading.
 */
export function createDictionary(data) {
  const raw = data.entries || [];
  const index = new Map();
  raw.forEach(([kanji, kana], i) => {
    for (const s of `${kanji}|${kana}`.split('|')) {
      if (!s) continue;
      const list = index.get(s);
      if (list) { if (!list.includes(i)) list.push(i); } else index.set(s, [i]);
    }
  });
  const decoded = new Map();
  const entry = (i) => {
    if (!decoded.has(i)) {
      const [kanji, kana, pos, senses] = raw[i];
      const k = kanji ? kanji.split('|') : [];
      const r = kana.split('|');
      const p = pos ? pos.split(' ') : [];
      const uk = p.includes('uk');
      decoded.set(i, {
        id: i, kanji: k, kana: r, pos: p.filter((x) => x !== 'uk'), senses: senses.split('|'), uk,
        // How it's usually written: in kana for a word that usually is (ありがとう), else its first spelling.
        form: uk || !k.length ? r[0] : k[0],
        reading: r[0],
        class: classOf(p),
      });
    }
    return decoded.get(i);
  };
  return {
    size: raw.length, index, entry,
    credit: data.credit, licence: data.licence, url: data.url, licenceUrl: data.licenceUrl, source: data.source,
  };
}

const NUMERAL = /[0-9０-９一二三四五六七八九十百千万何数]/;

/**
 * How likely an entry is to be what the text means here, lower first:
 * - text in kana is most often a word usually written in kana — the
 *   particle に rather than 荷 ("load"), する rather than 下 ("below");
 * - text in kanji is most often a word's main spelling — 降る (fall) for
 *   降ってる, not 下る, which can also be written 降る;
 * - straight after a number, a counter: 7時 is しちじ, not 7 + とき.
 */
function rank(match, surface, afterNumber) {
  const { entry, word } = match;
  let r = 0;
  if (!hasKanji(surface)) {
    if (!(entry.uk || !entry.kanji.length)) r += 2;
  } else if (entry.kanji[0] !== word) {
    r += 1;
  }
  if (afterNumber && !entry.pos.some((p) => p === 'ctr' || p === 'suf')) r += 1;
  return r;
}

/** Every entry the text could be: as written, or traced back through the inflection rules; likeliest first. */
function matchesFor(dict, surface, before = '') {
  const out = [];
  const seen = new Set();
  for (const candidate of deinflect(surface)) {
    const take = (i, word) => {
      if (seen.has(i)) return;
      const entry = dict.entry(i);
      seen.add(i);
      out.push({ entry, word, reasons: candidate.reasons });
    };
    for (const i of dict.index.get(candidate.word) || []) {
      // The text as written can be any kind of word; a traced-back form must be the kind its rules make.
      if (candidate.type === ANY || (dict.entry(i).class & candidate.type)) take(i, candidate.word);
    }
    // 勉強した → 勉強する → 勉強: a noun that takes する (and 勉強する, written out).
    if ((candidate.type & VS) && candidate.word.endsWith('する') && candidate.word.length > 2) {
      const noun = candidate.word.slice(0, -2);
      for (const i of dict.index.get(noun) || []) if (dict.entry(i).pos.includes('vs')) take(i, noun);
    }
  }
  const afterNumber = NUMERAL.test(before);
  return out
    .map((m, order) => ({ m, order, r: rank(m, surface, afterNumber) }))
    .sort((a, b) => a.r - b.r || a.order - b.order)
    .map(({ m }) => m);
}

/** The longest dictionary word starting at position i, with every entry it could be; null if none. */
export function lookupAt(dict, text, i) {
  if (!KANA_OR_KANJI.test(text[i] || '')) return null;
  for (let length = Math.min(MAX_LENGTH, text.length - i); length >= 1; length--) {
    const surface = text.slice(i, i + length);
    if (!KANA_OR_KANJI.test(surface[surface.length - 1])) continue;
    const matches = matchesFor(dict, surface, text[i - 1]);
    if (matches.length) return { start: i, length, surface, matches };
  }
  return null;
}

/** Shorter words that also start at position i: 今日 inside 今日は. */
export function alternativesAt(dict, text, i, longest) {
  const out = [];
  for (let length = (longest?.length ?? 1) - 1; length >= 1 && out.length < 2; length--) {
    const surface = text.slice(i, i + length);
    const matches = matchesFor(dict, surface, text[i - 1]);
    if (matches.length) out.push({ start: i, length, surface, matches });
  }
  return out;
}

/**
 * The word to put on a card for a match: the spelling the text used when it
 * used kanji (分かりました → 分かる), else how the word is usually written —
 * in kana for a word that usually is (ありがとう), else its main kanji
 * spelling, with the reading for furigana.
 */
export function wordOf(match) {
  const { entry, word } = match;
  const target = entry.kanji.includes(word)
    ? word
    : entry.uk || !entry.kanji.length ? (entry.kana.includes(word) ? word : entry.kana[0]) : entry.kanji[0];
  return { target, reading: entry.kana[0] };
}

const PARTICLES = /[はがをにでともへやか]$/;
const PHRASE_ONLY = (match) => match.matches.every((m) => m.entry.pos.every((p) => p === 'exp' || p === 'int'));

/**
 * The text cut into dictionary words ({ text, match }) and everything else
 * ({ text }). A set phrase ending in a particle (今日は, "hello") gives way to
 * the word before it when there is one (今日 + は): in a message that's far
 * more often what's meant. The phrase stays on offer as `match.longer`.
 */
export function segment(dict, text) {
  const out = [];
  const plain = (s) => {
    const last = out[out.length - 1];
    if (last && !last.match) last.text += s;
    else out.push({ text: s });
  };
  let i = 0;
  while (i < text.length) {
    let match = lookupAt(dict, text, i);
    if (match && match.length > 1 && PARTICLES.test(match.surface) && PHRASE_ONLY(match)) {
      const shorter = alternativesAt(dict, text, i, match)[0];
      if (shorter && !PHRASE_ONLY(shorter)) match = { ...shorter, longer: match };
    }
    if (match) {
      out.push({ text: match.surface, match });
      i += match.length;
    } else {
      plain(text[i]);
      i += 1;
    }
  }
  return out;
}

const toHiragana = (s) => String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * How one match's text is read — not the dictionary form's reading, but the
 * text's own (食べなかった → たべなかった; 勉強した → べんきょうした). Null for
 * text with no kanji, or where it can't be worked out.
 */
export function readingOf(surface, match) {
  if (!hasKanji(surface)) return null;
  const { entry, word } = match;
  // 来る's stem changes with its ending: 来た (き), 来ない (こ), 来れば (く).
  if (entry.pos.includes('vk') && surface.startsWith('来')) {
    const rest = surface.slice(1);
    const stem = /^(れば|る)/.test(rest) ? 'く' : /^(な(?!が|さ)|よう|られ|れ|させ|い)/.test(rest) ? 'こ' : 'き';
    return toHiragana(`${stem}${rest}`);
  }
  // Which reading goes with the spelling that matched: a kanji spelling takes the first reading.
  const reading = entry.kana[0];
  let same = 0;
  while (same < word.length && same < surface.length && word[same] === surface[same]) same++;
  const wordEnd = toHiragana(word.slice(same));
  if (hasKanji(wordEnd) || hasKanji(surface.slice(same))) return null;
  if (!toHiragana(reading).endsWith(wordEnd)) return null;
  return toHiragana(reading).slice(0, reading.length - wordEnd.length) + toHiragana(surface.slice(same));
}

/** The text with its kanji's readings in {漢字|かんじ} notation; null when there are none. */
export function furiganaOf(surface, reading) {
  if (!reading || !hasKanji(surface)) return null;
  const aligned = alignReading(surface, reading);
  if (aligned) return aligned;
  return /^[㐀-鿿豈-﫿々]+$/.test(surface) ? `{${surface}|${reading}}` : null;
}

/** A whole sentence's suggested furigana: each word's, in turn, from segment(). */
export function sentenceFurigana(dict, text) {
  let any = false;
  const out = segment(dict, text).map((piece) => {
    const m = piece.match?.matches[0];
    const notation = m ? furiganaOf(piece.text, readingOf(piece.text, m)) : null;
    if (notation) any = true;
    return notation || piece.text;
  }).join('');
  return any ? out : null;
}

/** The kind of word, as a key under "pos." in the interface strings. */
export function wordKind(entry) {
  const p = entry.pos;
  if (p.some((x) => x.startsWith('v5') || ['v1', 'v1-s', 'vk', 'vs-i', 'vs-s', 'vz'].includes(x))) return 'verb';
  if (p.includes('adj-i') || p.includes('adj-ix')) return 'i-adjective';
  if (p.includes('adj-na')) return 'na-adjective';
  if (p[0] === 'n' && p.includes('vs')) return 'suru-noun';
  const first = p[0] || '';
  if (first.startsWith('n') || first === 'num') return 'noun';
  if (first.startsWith('adv')) return 'adverb';
  if (first === 'pn') return 'pronoun';
  if (first.startsWith('adj')) return 'adjective';
  if (first === 'exp') return 'expression';
  if (first === 'int') return 'interjection';
  if (first === 'prt') return 'particle';
  if (first === 'conj') return 'conjunction';
  if (first === 'ctr') return 'counter';
  if (first === 'suf' || first === 'pref') return 'affix';
  if (first.startsWith('aux') || first === 'cop') return 'auxiliary';
  return null;
}

/** A particle, an auxiliary or the like: shown, but quieter than the words that carry the meaning. */
export function isMinor(entry) {
  return entry.pos.length > 0 && entry.pos.every((p) => ['prt', 'aux', 'aux-v', 'aux-adj', 'cop', 'conj'].includes(p));
}

/* ---------- loading ---------- */

const loaded = new Map(); // course id → Promise<dictionary | null>

/**
 * The current course's dictionary, or null when it has none — or when it
 * isn't on this device yet (offline, before the course finished
 * downloading); the caller says so and keeps the message for later.
 */
export async function loadDictionary() {
  const content = await loadContent();
  const file = content.manifest?.dictionary?.file;
  if (!file) return null;
  const id = content.course.id;
  if (!loaded.has(id)) {
    loaded.set(id, fetch(file, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data ? createDictionary(data) : null))
      .catch(() => null)
      .then((dict) => {
        if (!dict) loaded.delete(id); // try again next time
        return dict;
      }));
  }
  return loaded.get(id);
}
