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
import { toSegments } from './ruby.js';

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

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
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
        return { ...entry, ...data, phrases: (data.phrases || []).map((p) => register(normalise(p))), missing: false };
      } catch (err) {
        // A category file that fails to load must not take the app down.
        console.error(err);
        return { ...entry, phrases: [], missing: true };
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

  for (const cat of loaded) {
    byCategory.set(cat.id, cat);
    for (const p of cat.phrases) {
      phrases.set(p.id, { ...p, kind: 'phrase', categoryId: cat.id, categoryTitle: cat.title });
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
    },
    categories: loaded,
    characterSets,
    phrases,
    characters,
    byCategory,
    bySet,
  };
  caches.set(courseId, loadedContent);
  return loadedContent;
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
