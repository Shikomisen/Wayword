/**
 * levels.js — a course's levels (README §7.10): which level each deck
 * belongs to, how far through a level the learner is, and what to add next.
 *
 * Pure logic over loaded content (content.js) and plain data (cards, lesson
 * records, settings). deck.js reads the data and hands it in, so this can be
 * tested without storage.
 *
 * A course without `levels` in its manifest has none: every function here
 * then answers empty, and the screens show what they always did.
 */

/** A recognition card at a week-long interval counts as learned — the same bar as a kana card (README §7.7). */
export const LEARNED_DAYS = 7;

/** Ready to move up: this share of a level's items learned, and of its lessons practised. */
export const READY_SHARE = 0.8;

/** The course's levels, in order. */
export const levelsOf = (content) => content.levels || [];

export const levelById = (content, id) => levelsOf(content).find((l) => l.id === id) || null;

export const levelIndex = (content, id) => levelsOf(content).findIndex((l) => l.id === id);

const KIND_RANK = { words: 0, sentences: 1, phrases: 2 };

/**
 * The decks a learner adds in a level — word and sentence decks and phrase
 * categories — in next-step order: by `step`, then words before sentences
 * before phrases, then each list's own order.
 */
export function addableIn(content, levelId) {
  return [...(content.decks || []), ...(content.categories || [])]
    .filter((d) => d.level === levelId && !d.missing)
    .sort((a, b) => (a.step ?? Infinity) - (b.step ?? Infinity)
      || (KIND_RANK[a.type] ?? 9) - (KIND_RANK[b.type] ?? 9)
      || (a.order ?? 0) - (b.order ?? 0));
}

/** A level's lessons, in their order. */
export const lessonsIn = (content, levelId) => (content.lessons || []).filter((l) => l.level === levelId);

/** Whether an item's recognition card counts as learned. */
export const isLearned = (card) => Boolean(card && card.state === 'review' && card.interval >= LEARNED_DAYS);

/**
 * How far through a level: its items learned (phrases, words, sentences —
 * not lesson examples, which only become cards once practised) and its
 * lessons practised at least once.
 */
export function levelProgress(content, levelId, cardsById, lessonStats = {}) {
  const items = addableIn(content, levelId).flatMap((d) => d.items || []);
  const learned = items.filter((x) => isLearned(cardsById.get(x.id))).length;
  const lessons = lessonsIn(content, levelId);
  const practised = lessons.filter((l) => lessonStats[l.id]).length;
  const share = (n, total) => (total ? n / total : 1);
  return {
    learned,
    total: items.length,
    lessons: lessons.length,
    practised,
    ready: items.length > 0
      && share(learned, items.length) >= READY_SHARE
      && share(practised, lessons.length) >= READY_SHARE,
  };
}

/** The next deck to add in a level: the first in order that isn't in study and wasn't taken out. */
export function nextStep(content, levelId, settings) {
  return addableIn(content, levelId).find((d) =>
    !settings.activeCategories.includes(d.id) && !(settings.parkedDecks || []).includes(d.id)) || null;
}

/** The next lesson to practise in a level, or null when every one has been. */
export const nextLesson = (content, levelId, lessonStats = {}) =>
  lessonsIn(content, levelId).find((l) => !lessonStats[l.id]) || null;

/** The level after this one, or null at the top. */
export function levelAfter(content, levelId) {
  const levels = levelsOf(content);
  const i = levelIndex(content, levelId);
  return i >= 0 && i < levels.length - 1 ? levels[i + 1] : null;
}

/** The levels up to and including this one — what the listening drill draws on. */
export function levelsUpTo(content, levelId) {
  const levels = levelsOf(content);
  const i = levelIndex(content, levelId);
  return new Set(levels.slice(0, i < 0 ? levels.length : i + 1).map((l) => l.id));
}

/**
 * Placement's suggestion, from its overall score (README §7.4): "just
 * starting" or "early" → the first level; "partial" → the second; "strong" →
 * the third. A course with fewer levels caps it at its last.
 */
export function suggestedLevel(content, overall) {
  const levels = levelsOf(content);
  if (!levels.length) return null;
  const at = overall >= 0.75 ? 2 : overall >= 0.45 ? 1 : 0;
  return levels[Math.min(at, levels.length - 1)].id;
}

/** Whether placement samples a level's categories and character sets. A level marked `placement: false` isn't. */
export const sampled = (content, levelId) => {
  if (!levelsOf(content).length || levelId == null) return true;
  return levelById(content, levelId)?.placement !== false;
};

/**
 * A learner from before levels existed: the highest level among the decks
 * they study, or the first level if they study none.
 */
export function inferLevel(content, settings) {
  const levels = levelsOf(content);
  if (!levels.length) return null;
  const active = new Set(settings.activeCategories || []);
  let best = 0;
  for (const d of [...(content.decks || []), ...(content.categories || [])]) {
    if (active.has(d.id)) best = Math.max(best, levelIndex(content, d.level));
  }
  return levels[best].id;
}

/** The starter decks of one level — what placement, or moving up, adds. */
export const startersIn = (content, levelId) =>
  addableIn(content, levelId).filter((d) => d.starter);
