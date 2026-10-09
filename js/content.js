/**
 * content.js — content loader (README §3a).
 *
 * The app never hardcodes a category. Everything comes from the current
 * course's manifest (content/ja/manifest.json for English → Japanese), so
 * adding a category is: drop in a JSON file, add one manifest line. No app
 * code changes.
 *
 * Each course's content keeps field names that read naturally for its
 * authors — `japanese` / `english` and so on — and the manifest's `fields`
 * map says which of them is the language being learned. Everything loaded
 * here gains the same generic fields, so screens never need to know which
 * way round a course goes:
 *
 *   target   the text being learned           (japanese | english | …)
 *   ruby     furigana segments, if any
 *   reading  a romanisation, if any
 *   meaning  the gloss in the learner's own language
 *   notes    [{ label, text, style }] from the manifest's `noteFields` list
 */

import { currentCourse, currentCourseId } from './course.js';
import { toSegments, rubyText } from './ruby.js';
import * as store from './store.js';
import { t } from './i18n.js';

const caches = new Map();

// Registers a phrase can be labelled with. A course whose manifest `register`
// is one of these labels every phrase that doesn't declare its own.
const REGISTERS = ['polite', 'casual'];

const SUPPORTED_SCHEMA = 1;

// What en-ja's manifest declares; also the fallback for a manifest that
// predates `fields`, since en-ja is the only course that ever lacked one.
const DEFAULT_FIELDS = { target: 'japanese', ruby: 'furigana', reading: 'romaji', meaning: 'english' };
const DEFAULT_NOTES = [
  { field: 'registerNotes', label: 'Register' },
  { field: 'animeNote', label: 'From anime?', style: 'anime' },
];

function makeNormaliser(manifest, course) {
  const fields = manifest.fields || DEFAULT_FIELDS;
  const notes = manifest.noteFields || DEFAULT_NOTES;
  const targetLang = manifest.language || course?.target || 'ja';
  const meaningLang = manifest.speaker || course?.speaker || 'en';

  const normalise = (item) => ({
    ...item,
    target: item[fields.target] ?? '',
    // Segment arrays or the inline "{漢字|かんじ}" notation — see ruby.js.
    ruby: fields.ruby ? toSegments(item[fields.ruby]) : null,
    reading: fields.reading ? item[fields.reading] ?? null : null,
    meaning: item[fields.meaning] ?? '',
    notes: notes
      .filter((n) => item[n.field])
      .map((n) => ({ label: n.label, text: item[n.field], style: n.style || null })),
    // A casual phrase carries its polite counterpart, which shares its meaning.
    polite: item.polite
      ? normalise({ ...item.polite, [fields.meaning]: item[fields.meaning], register: 'polite' })
      : null,
    targetLang,
    meaningLang,
  });
  return normalise;
}

/** Phrases are labelled polite or casual: their own register, else the course default. */
function withRegister(manifest) {
  const fallback = REGISTERS.includes(manifest.register) ? manifest.register : null;
  return (phrase) => ({ ...phrase, register: REGISTERS.includes(phrase.register) ? phrase.register : fallback });
}

/**
 * A content file. An error says `offline` when the file simply couldn't be
 * reached — no connection, and the service worker hasn't got it (it answers
 * 504) — which for a course means it was never downloaded to this device.
 */
async function fetchJSON(path) {
  let res;
  try {
    res = await fetch(path, { cache: 'no-cache' });
  } catch {
    throw Object.assign(new Error(`Failed to load ${path} (no connection)`), { offline: true });
  }
  if (!res.ok) throw Object.assign(new Error(`Failed to load ${path} (${res.status})`), { offline: res.status === 504 });
  return res.json();
}

/**
 * Character sets (hiragana / katakana / kanji) are stored in the same
 * phrase-shaped schema so every existing component — the flashcard
 * session, targetNode's ruby rendering, the furigana/romaji toggles,
 * the audio button — renders them with no special-casing.
 *
 * The only thing synthesised here is a display `english` for kana, which
 * genuinely has no meaning to show; the JSON keeps `english: null` and
 * `declaredMeaning` preserves whatever the file actually declared. (The
 * generic `meaning` added afterwards is the display gloss, like phrases.)
 */
function normaliseCharacter(c, set) {
  return {
    ...c,
    kind: 'character',
    categoryId: set.id,
    categoryTitle: set.title,
    script: set.script,
    declaredMeaning: c.english ?? null,
    english: c.english ?? `reads “${c.romaji}”`,
  };
}

/**
 * Loads the manifest, every category file, and every character set.
 * Returns { manifest, categories, characterSets, phrases, characters,
 *           byCategory, bySet }
 *
 * `phrases` is the lookup-by-id index for anything studiable, characters
 * included — that is what lets the review session find a card's content
 * without caring which deck it came from.
 */
export async function loadContent() {
  const courseId = currentCourseId();
  if (caches.has(courseId)) return caches.get(courseId);

  const course = await currentCourse();
  if (!course?.manifest) throw new Error(`Course ${courseId} has no content yet`);

  const manifest = await fetchJSON(course.manifest);
  if (manifest.schemaVersion > SUPPORTED_SCHEMA) {
    console.warn(
      `Content schemaVersion ${manifest.schemaVersion} is newer than this app supports (${SUPPORTED_SCHEMA}). Rendering anyway.`
    );
  }
  const normalise = makeNormaliser(manifest, course);
  const register = withRegister(manifest);
  const fields = manifest.fields || DEFAULT_FIELDS;

  const entries = [...manifest.categories].sort((a, b) => a.order - b.order);

  const loaded = await Promise.all(
    entries.map(async (entry) => {
      try {
        const data = await fetchJSON(entry.file);
        const phrases = (data.phrases || []).map((p) =>
          ({ ...register(normalise(p)), kind: 'phrase', categoryId: entry.id, categoryTitle: data.title || entry.title }));
        return { ...entry, ...data, type: 'phrases', phrases, items: phrases, missing: false };
      } catch (err) {
        // A category file that fails to load must not take the app down.
        console.error(err);
        return { ...entry, type: 'phrases', phrases: [], items: [], missing: true };
      }
    })
  );

  // Word and sentence decks: the same item shape, plus a word's forms and a
  // sentence's chunks (each optionally linked to a word by id).
  const deckEntries = [...(manifest.decks || [])].sort((a, b) => a.order - b.order);
  const decks = await Promise.all(
    deckEntries.map(async (entry) => {
      const kind = entry.kind === 'sentences' ? 'sentence' : 'word';
      try {
        const data = await fetchJSON(entry.file);
        const items = (data.items || []).map((x) => normaliseDeckItem(
          { ...normalise(x), kind, categoryId: entry.id, categoryTitle: data.title || entry.title }));
        return { ...entry, ...data, type: entry.kind, items, phrases: items, missing: false };
      } catch (err) {
        console.error(err);
        return { ...entry, type: entry.kind, items: [], phrases: [], missing: true };
      }
    })
  );

  // Connector lessons: each lesson's examples are sentences, studied like a
  // sentence deck; the lesson's prose and each example's drill data ride along.
  const lessonEntries = [...(manifest.lessons || [])].sort((a, b) => a.order - b.order);
  const lessons = await Promise.all(
    lessonEntries.map(async (entry) => {
      try {
        const data = await fetchJSON(entry.file);
        const items = (data.examples || []).map((x) => normaliseDeckItem(
          { ...normalise(x), kind: 'sentence', categoryId: entry.id, categoryTitle: data.title || entry.title }));
        // The kinds of drill this course uses (drills.js); null means the usual three.
        return { ...entry, ...data, type: 'lesson', drills: manifest.drills || null, items, phrases: items, missing: false };
      } catch (err) {
        console.error(err);
        return { ...entry, type: 'lesson', items: [], phrases: [], missing: true };
      }
    })
  );

  const setEntries = [...(manifest.characterSets || [])].sort((a, b) => a.order - b.order);

  const loadedSets = await Promise.all(
    setEntries.map(async (entry) => {
      try {
        const data = await fetchJSON(entry.file);
        return { ...entry, ...data, characters: data.characters || [], missing: false };
      } catch (err) {
        console.error(err);
        return { ...entry, characters: [], groups: [], missing: true };
      }
    })
  );

  const phrases = new Map();
  const characters = new Map();
  const byCategory = new Map();
  const bySet = new Map();

  for (const deck of [...loaded, ...decks, ...lessons]) {
    byCategory.set(deck.id, deck);
    for (const item of deck.items) phrases.set(item.id, item);
  }

  // Which sentences use each word, so a word card can show it in context —
  // the connector examples included, which is where learned words reappear.
  const usage = new Map();
  for (const deck of [...decks.filter((d) => d.type === 'sentences'), ...lessons]) {
    for (const s of deck.items) {
      for (const chunk of s.chunks || []) {
        if (chunk.w) usage.set(chunk.w, [...new Set([...(usage.get(chunk.w) || []), s.id])]);
      }
    }
  }

  for (const set of loadedSets) {
    const normalised = set.characters.map((c) => normalise(normaliseCharacter(c, set)));
    bySet.set(set.id, { ...set, characters: normalised });
    for (const c of normalised) {
      characters.set(c.id, c);
      phrases.set(c.id, c); // shared id index — see the note above
    }
  }

  const characterSets = [...bySet.values()];
  const loadedContent = {
    course,
    manifest,
    normalise,
    // What this course's content supports, so screens can drop controls
    // that would do nothing (no furigana toggle for English, and so on).
    features: {
      ruby: Boolean(fields.ruby),
      reading: Boolean(fields.reading),
      // What the course calls its reading aids (ふりがな, romaji…) — content, not UI strings.
      aids: manifest.aids || {},
      characters: characterSets.length > 0,
      scenarios: (manifest.scenarios || []).length > 0,
      words: decks.some((d) => d.type === 'words'),
      sentences: decks.some((d) => d.type === 'sentences'),
      lessons: lessons.length > 0,
    },
    categories: loaded,
    decks,
    lessons,
    lessonGroups: manifest.lessonGroups || [],
    characterSets,
    phrases,
    characters,
    byCategory,
    bySet,
    usage,
  };
  await attachUserItems(loadedContent);
  caches.set(courseId, loadedContent);
  return loadedContent;
}

/**
 * A word's ます/て forms, a sentence's chunks and a connector example's drill
 * pieces get the same generic fields as everything else, so targetNode can
 * render any of them. Each piece keeps its `notation` as written.
 */
function normaliseDeckItem(item) {
  const lang = item.targetLang;
  const piece = (notation) => ({ target: rubyText(notation), ruby: toSegments(notation), targetLang: lang, notation });
  const { gap, combine } = item;
  return {
    ...item,
    forms: item.forms ? Object.entries(item.forms).map(([key, notation]) => ({ key, ...piece(notation) })) : null,
    chunks: item.chunks ? item.chunks.map((c) => ({ ...piece(c.t), w: c.w || null })) : null,
    // Fill-in: the sentence around the gap, and each option with its verdict —
    // the answer, another answer that also works, or wrong.
    gap: gap
      ? {
          ...gap,
          before: piece(gap.before),
          after: piece(gap.after),
          answer: piece(gap.answer),
          options: gap.options.map((o) => ({
            ...piece(o),
            verdict: o === gap.answer ? 'right' : (gap.ok || []).includes(o) ? 'ok' : 'wrong',
          })),
        }
      : null,
    // Combine: the two sentences to join, and the trap pieces among the real ones.
    combine: combine
      ? { a: piece(combine.a), b: piece(combine.b), distractors: combine.distractors.map(piece) }
      : null,
  };
}

/* ---------- your own words ---------- */

export const USER_DECK = 'mine';

/**
 * Words and sentences the learner adds (things a partner says, say). They
 * live in the course's own storage, not in content files, and are merged in
 * here as one more deck — "mine" — so the deck, review and study code treat
 * them exactly like built-in content.
 *
 * Stored shape: { id, kind, target, reading, furigana, meaning, note,
 * audioMode: 'recording' | 'tts' | 'none', createdAt }. A recording is kept
 * under its own key (rec:<id>) and only fetched to play it.
 */
export async function attachUserItems(content) {
  const ns = store.namespace();
  const stored = (await store.get('meta', 'userItems', ns)) || [];
  // Drop the previous attachment before re-adding, so edits and deletes show.
  for (const old of content.byCategory.get(USER_DECK)?.items || []) content.phrases.delete(old.id);

  const items = stored.map((u) => ({
    id: u.id,
    kind: u.kind === 'sentence' ? 'sentence' : 'word',
    source: 'user',
    categoryId: USER_DECK,
    categoryTitle: t('mine.title'),
    target: u.target,
    ruby: u.furigana ? toSegments(u.furigana) : null,
    reading: null,
    kana: u.reading || null,
    meaning: u.meaning,
    notes: u.note ? [{ label: t('mine.noteLabel'), text: u.note, style: null }] : [],
    targetLang: content.course.target,
    meaningLang: content.course.speaker,
    audio: null,
    audioMode: u.audioMode || 'none',
    loadRecording: () => store.get('meta', `rec:${u.id}`, ns),
    tags: [],
    difficulty: 2,
    register: null,
    polite: null,
    createdAt: u.createdAt,
  }));

  content.byCategory.set(USER_DECK, {
    id: USER_DECK, type: 'mine', title: t('mine.title'), icon: '✍️', items, phrases: items, missing: false,
  });
  for (const item of items) content.phrases.set(item.id, item);
  content.userItems = items;
  return items;
}

/** Re-read your own words into the loaded content after one is added, edited or deleted. */
export async function refreshUserItems() {
  return attachUserItems(await loadContent());
}

export async function getPhrase(id) {
  const { phrases } = await loadContent();
  return phrases.get(id);
}

export async function getCategory(id) {
  const { byCategory } = await loadContent();
  return byCategory.get(id);
}

export async function getCharacterSet(id) {
  const { bySet } = await loadContent();
  return bySet.get(id);
}

export async function getCharacter(id) {
  const { characters } = await loadContent();
  return characters.get(id);
}

/**
 * Kana laid out as the traditional grid: rows are consonants, columns are
 * vowels. Returns [{ row, cells: [character|null, …] }] with gaps left as
 * null so や・ゆ・よ and わ・を line up under the right vowel columns.
 */
export function gridFor(set, group = 'base') {
  const inGroup = set.characters.filter((c) => c.group === group);
  const columns = ['a', 'i', 'u', 'e', 'o'];

  // Whether a row sits on the vowel grid is decided per row, not per group.
  // や・ゆ・よ and わ・を genuinely have vowel-column holes worth showing;
  // ん (column "n"), yōon (ya/yu/yo) and extended katakana do not sit on the
  // grid at all, and reserving five vowel slots for them would emit a
  // screenful of empty cells.
  const order = [];
  const byRow = new Map();

  for (const c of inGroup) {
    if (!byRow.has(c.row)) { byRow.set(c.row, []); order.push(c.row); }
    byRow.get(c.row).push(c);
  }

  return order.map((row) => {
    const chars = byRow.get(row);
    if (!chars.some((c) => columns.includes(c.column))) return { row, cells: chars };

    const cells = columns.map(() => null);
    for (const c of chars) {
      const idx = columns.indexOf(c.column);
      if (idx >= 0) cells[idx] = c;
      else cells.push(c);
    }
    return { row, cells };
  });
}

/** Scenario trees are loaded on demand — they're only needed on one screen. */
const scenarioCache = new Map();

export async function loadScenario(id) {
  const key = `${currentCourseId()}/${id}`;
  if (scenarioCache.has(key)) return scenarioCache.get(key);
  const { manifest, normalise } = await loadContent();
  const entry = manifest.scenarios?.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown scenario: ${id}`);
  const data = await fetchJSON(entry.file);

  // NPC lines and inline replies carry text in the course's own field
  // names, exactly like phrases, so they get the same generic fields.
  const nodes = Object.fromEntries(
    Object.entries(data.nodes || {}).map(([nodeId, node]) => [nodeId, {
      ...normalise(node),
      options: (node.options || []).map((o) => (o.phraseId ? o : normalise(o))),
    }])
  );

  const merged = { ...entry, ...data, nodes };
  scenarioCache.set(key, merged);
  return merged;
}

export async function scenariosFor(categoryId) {
  const { manifest } = await loadContent();
  return (manifest.scenarios || []).filter((s) => s.category === categoryId);
}
