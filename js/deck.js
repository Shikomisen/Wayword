/**
 * deck.js — the bridge between content, SRS state and storage.
 *
 * Owns settings, which decks are active, and the introduce/grade operations.
 * Screens talk to this, never to store.js directly.
 *
 * Everything here acts on the current course: store.js is pointed at that
 * course's own database when the course is activated, so settings, cards,
 * placement and stats are all per course without any function here taking
 * a course argument.
 *
 * A "deck" is anything whose items can be studied: a phrase category, a word
 * or sentence deck, or your own words ("mine"). They all live in
 * settings.activeCategories (the name predates words and sentences).
 *
 * Each item becomes one card per enabled direction — recognition,
 * production, listening (srs.DIR). Characters are only ever recognition.
 */

import * as store from './store.js';
import * as srs from './srs.js';
import { loadContent, getCharacterSet, refreshUserItems, USER_DECK } from './content.js';
import { nextStat } from './kana.js';

const DEFAULT_DIRECTIONS = { recognition: true, production: true, listening: false };

const DEFAULT_SETTINGS = {
  furigana: true,        // legacy on/off — superseded by furiganaMode, kept so old records read right
  furiganaMode: null,    // 'always' | 'tap' | 'hidden'; null = derive from `furigana`
  romaji: true,          // README §6: off by default after the first week — see maybeRetireRomaji()
  textScale: 1,          // superseded by the app-wide preference (course.js getTextScale)
  newPerDay: 10,
  newCharsPerDay: 15,    // characters are faster to review than phrases
  activeCategories: [],  // every active deck: phrase categories, word/sentence decks, "mine"
  activeCharacterSets: [], // opt-in from the Characters screen
  directions: DEFAULT_DIRECTIONS,
  autoPlayAudio: true,
  installedAt: null,
  romajiRetired: false,
};

export const FURIGANA_MODES = ['always', 'tap', 'hidden'];

const settingsCache = new Map(); // namespace → settings

function withDefaults(saved = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  settings.directions = { ...DEFAULT_DIRECTIONS, ...(saved.directions || {}) };
  if (!FURIGANA_MODES.includes(settings.furiganaMode)) {
    settings.furiganaMode = saved.furigana === false ? 'hidden' : 'always';
  }
  return settings;
}

export async function getSettings() {
  const ns = store.namespace();
  if (settingsCache.has(ns)) return settingsCache.get(ns);
  const saved = (await store.get('meta', 'settings', ns)) || {};
  const settings = withDefaults(saved);
  settingsCache.set(ns, settings);
  if (!settings.installedAt) {
    settings.installedAt = Date.now();
    await store.set('meta', 'settings', settings, ns);
  }
  return settings;
}

export async function saveSettings(patch) {
  const ns = store.namespace();
  const settings = { ...(await getSettings()), ...patch };
  settingsCache.set(ns, settings);
  await store.set('meta', 'settings', settings, ns);
  return settings;
}

/**
 * README §6: romaji off by default after the first week. Rather than
 * silently yanking it, this flips the default once and tells the caller so
 * the UI can mention it. The user can turn it straight back on in settings.
 */
export async function maybeRetireRomaji() {
  const s = await getSettings();
  if (s.romajiRetired || !s.installedAt) return false;
  const weekOne = 7 * srs.DAY;
  if (Date.now() - s.installedAt < weekOne) return false;
  await saveSettings({ romaji: false, romajiRetired: true });
  return true;
}

/* ---------- directions ---------- */

/** True if an item can actually be heard — bundled clip, your recording, or the device voice. */
export function hasAudio(item) {
  return Boolean(item.audio || item.audioMode === 'recording' || item.audioMode === 'tts');
}

/** The directions an item is studied in, given the course's settings. */
export function directionsFor(item, settings) {
  if (item.kind === srs.KIND.CHARACTER) return [srs.DIR.RECOGNITION];
  const d = settings.directions || DEFAULT_DIRECTIONS;
  const dirs = [];
  if (d.recognition) dirs.push(srs.DIR.RECOGNITION);
  if (d.production) dirs.push(srs.DIR.PRODUCTION);
  if (d.listening && hasAudio(item)) dirs.push(srs.DIR.LISTENING);
  return dirs.length ? dirs : [srs.DIR.RECOGNITION]; // never study nothing
}

/** Whether a card's direction is currently switched on. Characters always are. */
export function dirEnabled(card, settings) {
  if ((card.kind ?? srs.KIND.PHRASE) === srs.KIND.CHARACTER) return true;
  const dir = srs.dirOf(card);
  const d = settings.directions || DEFAULT_DIRECTIONS;
  const anyOn = d.recognition || d.production || d.listening;
  return anyOn ? Boolean(d[dir]) : dir === srs.DIR.RECOGNITION;
}

/* ---------- placement ---------- */

export async function getPlacement() {
  return (await store.get('meta', 'placement')) || null;
}

export async function savePlacement(result) {
  await store.set('meta', 'placement', result);
  return result;
}

export async function isOnboarded() {
  const p = await getPlacement();
  return Boolean(p && p.done);
}

/* ---------- deck ---------- */

export async function getDeck() {
  const cards = await store.getAll('srs');
  return cards.filter(Boolean);
}

export async function getCard(id) {
  return store.get('srs', id);
}

export async function putCard(card) {
  await store.set('srs', card.id, card);
  return card;
}

/**
 * Introduce every item of a deck — phrase category, word or sentence deck,
 * or your own words — into the deck, one card per enabled direction.
 *
 * Placement results shape the starting interval of recognition cards: a
 * category the user clearly already has gets its easy cards seeded forward
 * instead of starting from zero (README §6a). Production and listening start
 * fresh — recognising a phrase isn't the same as being able to say it.
 * Cards already in the deck are left untouched.
 */
export async function activateCategory(deckId) {
  const { byCategory } = await loadContent();
  const deck = byCategory.get(deckId);
  if (!deck) return { added: 0, seeded: 0 };

  const s = await getSettings();
  const placement = await getPlacement();
  const score = placement?.perCategory?.[deckId]?.score ?? 0;
  const existing = new Set((await getDeck()).map((c) => c.id));

  const now = Date.now();
  const entries = [];
  let seeded = 0;

  for (const item of deck.items || deck.phrases || []) {
    const difficulty = item.difficulty ?? 3;
    for (const dir of directionsFor(item, s)) {
      if (existing.has(srs.cardId(item.id, dir))) continue;
      const opts = { kind: item.kind || srs.KIND.PHRASE, difficulty, dir };

      let card;
      if (dir === srs.DIR.RECOGNITION && score >= 0.75 && difficulty <= 2) {
        card = srs.seedKnown(item.id, deckId, 4, 2.6, now, opts);
        seeded++;
      } else if (dir === srs.DIR.RECOGNITION && score >= 0.5 && difficulty <= 1) {
        card = srs.seedKnown(item.id, deckId, 2, 2.5, now, opts);
        seeded++;
      } else {
        card = srs.newCard(item.id, deckId, now, opts);
      }
      entries.push([card.id, card]);
    }
  }

  await store.setMany('srs', entries);

  if (!s.activeCategories.includes(deckId)) {
    await saveSettings({ activeCategories: [...s.activeCategories, deckId] });
  }

  return { added: entries.length, seeded };
}

/** Same thing, by its newer name. */
export const activateDeck = activateCategory;

/**
 * Make sure every active deck has a card for every enabled direction — after
 * a direction is switched on, and on entering a course (decks activated
 * before directions existed have only recognition cards). Idempotent.
 * Returns how many cards it added.
 */
export async function syncDirections() {
  const { byCategory } = await loadContent();
  const s = await getSettings();
  const existing = new Set((await getDeck()).map((c) => c.id));
  const now = Date.now();
  const entries = [];

  for (const deckId of s.activeCategories) {
    for (const item of byCategory.get(deckId)?.items || []) {
      for (const dir of directionsFor(item, s)) {
        const id = srs.cardId(item.id, dir);
        if (existing.has(id)) continue;
        const card = srs.newCard(item.id, deckId, now, { kind: item.kind || srs.KIND.PHRASE, difficulty: item.difficulty ?? 3, dir });
        entries.push([card.id, card]);
        existing.add(id);
      }
    }
  }
  if (entries.length) await store.setMany('srs', entries);
  return entries.length;
}

export async function deactivateCategory(categoryId) {
  const s = await getSettings();
  await saveSettings({ activeCategories: s.activeCategories.filter((c) => c !== categoryId) });
}

export async function isActive(categoryId) {
  const s = await getSettings();
  return s.activeCategories.includes(categoryId);
}

/* ---------- character sets ---------- */

/**
 * Introduce a character set into the deck.
 *
 * Mirrors activateCategory, including placement-driven seeding: someone
 * who already reads kana shouldn't be made to grind 104 cards from zero.
 * Cards are tagged kind:'character' so they never enter the phrase queue.
 */
export async function activateCharacterSet(setId) {
  const set = await getCharacterSet(setId);
  if (!set) return { added: 0, seeded: 0 };

  const placement = await getPlacement();
  const score = placement?.perCategory?.[setId]?.score ?? 0;
  const existing = new Set((await getDeck()).map((c) => c.id));

  const now = Date.now();
  const entries = [];
  let seeded = 0;

  for (const c of set.characters) {
    if (existing.has(c.id)) continue;
    const difficulty = c.difficulty ?? 3;
    const opts = { kind: srs.KIND.CHARACTER, difficulty };

    let card;
    if (score >= 0.75 && difficulty <= 2) {
      card = srs.seedKnown(c.id, setId, 4, 2.6, now, opts);
      seeded++;
    } else if (score >= 0.5 && difficulty <= 1) {
      card = srs.seedKnown(c.id, setId, 2, 2.5, now, opts);
      seeded++;
    } else {
      card = srs.newCard(c.id, setId, now, opts);
    }
    entries.push([card.id, card]);
  }

  await store.setMany('srs', entries);

  const s = await getSettings();
  if (!s.activeCharacterSets.includes(setId)) {
    await saveSettings({ activeCharacterSets: [...s.activeCharacterSets, setId] });
  }

  return { added: entries.length, seeded };
}

export async function deactivateCharacterSet(setId) {
  const s = await getSettings();
  await saveSettings({ activeCharacterSets: s.activeCharacterSets.filter((c) => c !== setId) });
}

export async function isSetActive(setId) {
  const s = await getSettings();
  return s.activeCharacterSets.includes(setId);
}

/** Review queue for characters only — never mixed with the phrase queue. */
export async function characterQueue(setId = null) {
  const s = await getSettings();
  const chars = srs.ofKind(await getDeck(), srs.KIND.CHARACTER);
  const scoped = setId
    ? chars.filter((c) => c.categoryId === setId)
    : chars.filter((c) => s.activeCharacterSets.includes(c.categoryId));
  return srs.buildQueue(scoped, { newLimit: s.newCharsPerDay });
}

export async function characterSummary() {
  const s = await getSettings();
  const chars = srs.ofKind(await getDeck(), srs.KIND.CHARACTER);
  return srs.summarise(chars.filter((c) => s.activeCharacterSets.includes(c.categoryId)));
}

export async function setProgress(setId) {
  const chars = srs.ofKind(await getDeck(), srs.KIND.CHARACTER);
  return srs.summarise(chars.filter((c) => c.categoryId === setId));
}

/** Grade a card and persist. Returns the updated record. */
export async function grade(cardId, quality) {
  const card = await getCard(cardId);
  if (!card) return null;
  const updated = srs.review(card, quality, Date.now());
  await putCard(updated);
  await bumpStat(quality, updated.kind ?? srs.KIND.PHRASE);
  return updated;
}

/* ---------- daily stats ---------- */

const todayKey = () => new Date().toISOString().slice(0, 10);

const EMPTY_DAY = { reviews: 0, again: 0, charReviews: 0, charAgain: 0, drills: 0 };

/**
 * Phrase and character reviews are counted separately so the "done today"
 * figure on the home screen stays a phrase figure — 40 kana drills
 * shouldn't make it look like you did your phrase reviews.
 */
async function bumpStat(quality, kind) {
  const key = todayKey();
  const stats = (await store.get('meta', 'stats')) || {};
  const day = { ...EMPTY_DAY, ...(stats[key] || {}) };

  if (kind === srs.KIND.CHARACTER) {
    day.charReviews += 1;
    if (quality < 3) day.charAgain += 1;
  } else {
    day.reviews += 1;
    if (quality < 3) day.again += 1;
  }

  stats[key] = day;
  await store.set('meta', 'stats', stats);
}

export async function todayStats() {
  const stats = (await store.get('meta', 'stats')) || {};
  // Spread over EMPTY_DAY so records written before characters existed
  // still report zeroes rather than undefined.
  return { ...EMPTY_DAY, ...(stats[todayKey()] || {}) };
}

export async function streak() {
  const stats = (await store.get('meta', 'stats')) || {};
  // A day of connector drills counts as much as a day of flashcards.
  const studied = (day) => Boolean(day && ((day.reviews || 0) + (day.charReviews || 0) + (day.drills || 0)));

  let count = 0;
  const d = new Date();
  // Today only counts if something was actually reviewed; otherwise start
  // counting back from yesterday so an untouched today doesn't zero it.
  if (!studied(stats[d.toISOString().slice(0, 10)])) d.setDate(d.getDate() - 1);
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if (studied(stats[key])) { count++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return count;
}

/** The main queue's cards for a set of decks, in enabled directions only. */
function studyable(cards, settings, deckIds) {
  const all = srs.studyCards(cards);
  const scoped = all.filter((c) => deckIds.has(c.categoryId) && dirEnabled(c, settings));
  return { all, scoped };
}

/**
 * The sibling rule (srs.introducible) holds a new production or listening
 * card back until its recognition card has been seen — which only makes
 * sense while recognition cards are being studied at all. With recognition
 * switched off, holding them back would mean never introducing them.
 */
function introducible(scoped, all, settings) {
  const recognitionOn = dirEnabled({ dir: srs.DIR.RECOGNITION }, settings);
  return recognitionOn ? srs.introducible(scoped, all) : scoped;
}

/**
 * Review queue — every active deck, or just one. Phrases, words and
 * sentences share it; characters have their own (characterQueue).
 */
export async function queue(deckId = null) {
  const s = await getSettings();
  const { all, scoped } = studyable(await getDeck(), s, new Set(deckId ? [deckId] : s.activeCategories));
  return srs.buildQueue(introducible(scoped, all, s), { newLimit: s.newPerDay });
}

export async function deckSummary() {
  const s = await getSettings();
  return srs.summarise(studyable(await getDeck(), s, new Set(s.activeCategories)).scoped);
}

export async function categoryProgress(deckId) {
  const s = await getSettings();
  return srs.summarise(studyable(await getDeck(), s, new Set([deckId])).scoped);
}

/** Erases the current course only — other courses live in other databases. */
export async function resetEverything() {
  await store.clearAll();
  settingsCache.delete(store.namespace());
  await refreshUserItems();
}

/**
 * Read-only look at any course's deck, for the home page's course list.
 * Takes the namespace explicitly rather than switching the current course,
 * so drawing the home page can never redirect a screen that is mid-render.
 * Writes nothing: a course nobody has opened stays untouched.
 */
export async function courseSnapshot(ns) {
  const [saved, placement, cards] = await Promise.all([
    store.get('meta', 'settings', ns),
    store.get('meta', 'placement', ns),
    store.getAll('srs', ns),
  ]);
  const settings = withDefaults(saved || {});
  const { all, scoped } = studyable(cards.filter(Boolean), settings, new Set(settings.activeCategories));
  return {
    onboarded: Boolean(placement?.done),
    due: srs.buildQueue(introducible(scoped, all, settings), { newLimit: settings.newPerDay }).length,
    total: scoped.length,
  };
}

/* ---------- connectors: drills ---------- */

/**
 * A missed drill sends its sentence to the review deck. The sentence's
 * cards are added (every enabled direction), and the one closest to what the
 * drill asked — building the sentence, so *Say it* when that's on — is
 * failed, so it comes back within minutes instead of waiting its turn as a
 * new card. The lesson counts as an active deck from then on, but only the
 * sentences actually missed are added: the rest wait for "Study as cards".
 */
export async function recordMiss(itemId, deckId) {
  const { byCategory } = await loadContent();
  const item = (byCategory.get(deckId)?.items || []).find((x) => x.id === itemId);
  if (!item) return null;
  const s = await getSettings();
  const now = Date.now();
  const existing = new Set((await getDeck()).map((c) => c.id));
  const dirs = directionsFor(item, s);
  const entries = dirs
    .filter((dir) => !existing.has(srs.cardId(item.id, dir)))
    .map((dir) => srs.newCard(item.id, deckId, now, { kind: item.kind || srs.KIND.SENTENCE, difficulty: item.difficulty ?? 3, dir }))
    .map((card) => [card.id, card]);
  if (entries.length) await store.setMany('srs', entries);
  if (!s.activeCategories.includes(deckId)) await saveSettings({ activeCategories: [...s.activeCategories, deckId] });

  const dir = dirs.includes(srs.DIR.PRODUCTION) ? srs.DIR.PRODUCTION : dirs[0];
  const card = await getCard(srs.cardId(item.id, dir));
  if (!card) return null;
  const missed = srs.review(card, srs.GRADE.AGAIN, now);
  await putCard(missed);
  return missed;
}

/** Per lesson: sessions practised, drills right and done in total, the best session, and when. */
export async function getLessonStats() {
  return (await store.get('meta', 'lessonStats')) || {};
}

/** Record one practice session: `results` is { [lessonId]: { right, total } }. */
export async function recordPractice(results) {
  const stats = await getLessonStats();
  const now = Date.now();
  let drills = 0;
  for (const [id, r] of Object.entries(results)) {
    if (!r.total) continue;
    const s = stats[id] || { sessions: 0, right: 0, total: 0, best: null, lastAt: null };
    s.sessions += 1;
    s.right += r.right;
    s.total += r.total;
    s.lastAt = now;
    if (!s.best || r.right / r.total > s.best.right / s.best.total) s.best = { right: r.right, total: r.total };
    stats[id] = s;
    drills += r.total;
  }
  await store.set('meta', 'lessonStats', stats);
  await countDrills(drills);
  return stats;
}

/** Drills done today, connector or kana: they keep the streak going like reviews do. */
async function countDrills(n) {
  if (!n) return;
  const key = todayKey();
  const days = (await store.get('meta', 'stats')) || {};
  days[key] = { ...EMPTY_DAY, ...(days[key] || {}), drills: (days[key]?.drills || 0) + n };
  await store.set('meta', 'stats', days);
}

/* ---------- kana mastery (kana.js has the rules) ---------- */

/** Per character id: { right, wrong, streak, days, last } from the daily kana drill. */
export async function getKanaStats() {
  return (await store.get('meta', 'kanaStats')) || {};
}

/** Record one kana drill answer. */
export async function recordKana(charId, right) {
  const stats = await getKanaStats();
  stats[charId] = nextStat(stats[charId], right, todayKey());
  await store.set('meta', 'kanaStats', stats);
  return stats[charId];
}

/** A finished kana drill counts toward the day, and marks today's drill done. */
export async function finishKanaDrill(answered, script) {
  await countDrills(answered);
  const log = (await store.get('meta', 'kanaLog')) || { sessions: 0 };
  await store.set('meta', 'kanaLog', { sessions: log.sessions + 1, lastDay: todayKey(), lastScript: script });
}

/** Whether a kana drill was done today, and in which script. */
export async function kanaDrillToday() {
  const log = await store.get('meta', 'kanaLog');
  return log?.lastDay === todayKey() ? { done: true, script: log.lastScript || null } : { done: false, script: null };
}

/** Every character card by id — a well-learned card counts toward kana mastery. */
export async function characterCards() {
  return new Map(srs.ofKind(await getDeck(), srs.KIND.CHARACTER).map((c) => [c.id, c]));
}

/* ---------- "I can read this" ---------- */

/**
 * Items the learner has marked as readable. Their furigana stops showing by
 * default (tap to see it), so furigana fades as reading improves — card by
 * card, at the learner's own say-so.
 */
export async function getReadable() {
  return new Set((await store.get('meta', 'readable')) || []);
}

export async function setReadable(itemId, readable) {
  const set = await getReadable();
  if (readable) set.add(itemId); else set.delete(itemId);
  await store.set('meta', 'readable', [...set]);
  return set;
}

/* ---------- your own words ---------- */

export async function getUserItems() {
  return (await store.get('meta', 'userItems')) || [];
}

/**
 * Add or update one of your own words or sentences, then (re)create its
 * cards. Its deck — "mine" — becomes active the first time you add to it.
 */
export async function saveUserItem(item) {
  const items = await getUserItems();
  const at = items.findIndex((x) => x.id === item.id);
  if (at >= 0) items[at] = { ...items[at], ...item };
  else items.push({ createdAt: Date.now(), ...item });
  await store.set('meta', 'userItems', items);
  await refreshUserItems();

  // A direction may have become possible (listening needs audio) or the
  // item may be new: activation creates exactly the missing cards.
  await activateCategory(USER_DECK);
  // Listening cards for an item that has lost its audio would be unplayable.
  const saved = items[at >= 0 ? at : items.length - 1];
  if (saved.audioMode === 'none') await store.del('srs', srs.cardId(saved.id, srs.DIR.LISTENING));
  return saved;
}

export async function deleteUserItem(id) {
  const items = (await getUserItems()).filter((x) => x.id !== id);
  await store.set('meta', 'userItems', items);
  for (const dir of Object.values(srs.DIR)) await store.del('srs', srs.cardId(id, dir));
  await store.del('meta', `rec:${id}`);
  await refreshUserItems();
}

export async function getRecording(id) {
  return store.get('meta', `rec:${id}`);
}

export async function setRecording(id, dataUrl) {
  if (dataUrl) await store.set('meta', `rec:${id}`, dataUrl);
  else await store.del('meta', `rec:${id}`);
}
