/**
 * kana.js — kana mastery and the daily kana drill (README §16). Pure logic,
 * no DOM: reading.js draws it, deck.js stores the per-character record.
 *
 * Mastery is per character: right three times in a row, on at least two
 * different days — knowledge that lasted overnight, not a lucky run. A
 * character whose flashcard has reached a week-long interval counts too, so
 * kana already learned through the character deck isn't drilled again.
 *
 * A script is mastered when 90% of its core characters are: the 46 base kana
 * and the 25 with ゛ or ゜. Yōon (きゃ…) and extended katakana (ファ…) are
 * built from those, so they don't hold anything up.
 */

export const MASTERY = { streak: 3, days: 2, threshold: 0.9, cardInterval: 7 };
export const CORE_GROUPS = ['base', 'dakuten', 'handakuten'];
export const SCRIPTS = ['hiragana', 'katakana'];

/** Has the drill record shown this character mastered? */
export const drillMastered = (stat) =>
  Boolean(stat && stat.streak >= MASTERY.streak && (stat.days || []).length >= MASTERY.days);

/** A flashcard that has reached a week-long interval is mastery too. */
const cardMastered = (card) => Boolean(card && card.state === 'review' && card.interval >= MASTERY.cardInterval);

/** A predicate for "mastered", from the drill record and the character cards (Map id → card). */
export function masteryOf(stats, cards = new Map()) {
  return (c) => drillMastered(stats[c.id]) || cardMastered(cards.get(c.id));
}

/** The characters of a set that count toward mastery, in teaching order — row by row. */
export const coreOf = (set) => set.characters.filter((c) => CORE_GROUPS.includes(c.group));

/** Per script: core characters mastered and seen, and whether the script is done. */
export function kanaProgress(sets, stats, cards = new Map()) {
  const mastered = masteryOf(stats, cards);
  const out = {};
  for (const script of SCRIPTS) {
    const set = sets.find((s) => s.script === script);
    if (!set) continue;
    const core = coreOf(set);
    const done = core.filter(mastered).length;
    out[script] = {
      set,
      total: core.length,
      mastered: done,
      seen: core.filter((c) => stats[c.id] || mastered(c)).length,
      done: core.length > 0 && done / core.length >= MASTERY.threshold,
    };
  }
  return out;
}

/** The script the daily drill works on: hiragana until it's mastered, then katakana; null once both are. */
export const focusScript = (progress) => SCRIPTS.find((s) => progress[s] && !progress[s].done) || null;

export function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// を is read "o": in a listening question it must never sit next to お.
const soundOf = (c) => (c.romaji === 'wo' ? 'o' : c.romaji);

/**
 * Three wrong options for a character: others from the same script that
 * sound different, preferring the ones it's easiest to confuse it with —
 * the same row (か き く) or the same vowel column (か さ た) — and ones
 * already met.
 */
function distractors(char, pool, random) {
  const others = pool.filter((c) => c.id !== char.id && soundOf(c) !== soundOf(char));
  const near = shuffle(others.filter((c) => c.row === char.row || c.column === char.column), random);
  const rest = shuffle(others.filter((c) => !near.includes(c)), random);
  const picked = [];
  for (const c of [...near.slice(0, 2), ...rest, ...near.slice(2)]) {
    if (picked.length === 3) break;
    if (!picked.some((p) => soundOf(p) === soundOf(c))) picked.push(c);
  }
  return picked;
}

/**
 * One daily drill for a script, about `size` questions:
 *   - new characters, at most `newMax` (half that until most answers so far
 *     are right) and only while fewer than `inProgressCap` are half-learned —
 *     met first on an intro screen, in teaching order, then asked like the rest;
 *   - characters in progress, the ones missed most recently first;
 *   - and two or so mastered ones, so they stay mastered.
 * Two kinds of question: `read` (see the kana, pick its sound) and `listen`
 * (hear it, pick the kana) — about one in three is listening.
 */
export function buildKanaDrill(set, stats, {
  cards = new Map(), size = 15, newMax = 10, inProgressCap = 20, random = Math.random,
} = {}) {
  const mastered = masteryOf(stats, cards);
  const core = coreOf(set);
  const inProgress = core.filter((c) => stats[c.id] && !mastered(c));
  const unseen = core.filter((c) => !stats[c.id] && !mastered(c));
  const known = core.filter(mastered);

  // Missed last time first, then the ones seen longest ago.
  inProgress.sort((a, b) =>
    Number(stats[b.id].streak === 0) - Number(stats[a.id].streak === 0) || (stats[a.id].last || 0) - (stats[b.id].last || 0));

  // New characters come in half as fast until the answers so far are mostly right.
  const answered = core.reduce((n, c) => n + (stats[c.id]?.right || 0) + (stats[c.id]?.wrong || 0), 0);
  const rightSoFar = core.reduce((n, c) => n + (stats[c.id]?.right || 0), 0);
  const newCap = answered >= 10 && rightSoFar / answered >= 0.8 ? newMax : Math.ceil(newMax / 2);

  const refreshCount = Math.min(known.length, Math.max(2, size - inProgress.length - newCap));
  const room = Math.max(0, Math.min(newCap, inProgressCap - inProgress.length, size - refreshCount));
  const intros = unseen.slice(0, room);
  const learning = inProgress.slice(0, Math.max(0, size - refreshCount - intros.length));
  const refresh = shuffle(known, random).slice(0, Math.max(refreshCount, size - intros.length - learning.length));
  const targets = [...intros, ...learning, ...refresh].slice(0, size);

  const pool = [...new Set([...core.filter((c) => stats[c.id] || mastered(c)), ...intros])];
  const optionPool = pool.length >= 8 ? pool : core;
  const questions = shuffle(targets, random).map((char) => {
    const type = char.audio && random() < 1 / 3 ? 'listen' : 'read';
    return { type, char, options: shuffle([char, ...distractors(char, optionPool, random)], random) };
  });
  return { intros, questions };
}

/** The record after one answer: a right answer extends the streak (and its days), a wrong one starts over. */
export function nextStat(stat, right, day, now = Date.now()) {
  const s = { right: 0, wrong: 0, streak: 0, days: [], last: null, ...(stat || {}) };
  if (right) {
    s.right += 1;
    s.streak += 1;
    if (!s.days.includes(day)) s.days = [...s.days, day].slice(-MASTERY.days - 2);
  } else {
    s.wrong += 1;
    s.streak = 0;
    s.days = [];
  }
  s.last = now;
  return s;
}

/** Is this segment a hiragana reading over katakana — an aid for someone still learning katakana? */
export function isKatakanaAid(seg) {
  return Boolean(seg?.r && /^[ァ-ヺー・]+$/u.test(seg.b) && /^[ぁ-ゖー]+$/u.test(seg.r));
}
