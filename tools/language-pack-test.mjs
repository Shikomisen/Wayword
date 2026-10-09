/**
 * language-pack-test.mjs — proves a new language needs no app-code changes.
 *
 * Adds a made-up course — Esperanto for English speakers — purely as
 * content: a courses.json entry, a manifest and one category file, served
 * from memory over the real files. Then runs the real app modules over it:
 * it loads, gets its own storage, placement seeds a deck, a review queue
 * builds and a card grades. If any of that needed a code change for the new
 * language, this fails.
 *
 *   node tools/language-pack-test.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));

/* ---------- the new language, as content only ---------- */

const realCourses = readJSON('content/courses.json');
const OVERLAY = {
  'content/courses.json': {
    ...realCourses,
    languages: {
      ...realCourses.languages,
      eo: { name: { en: 'Esperanto', ja: 'エスペラント語' }, native: 'Esperanto', badge: 'EO' },
    },
    courses: [...realCourses.courses,
      { id: 'en-eo', speaker: 'en', target: 'eo', status: 'available', manifest: 'content/eo/manifest.json' }],
  },
  'content/eo/manifest.json': {
    schemaVersion: 1,
    language: 'eo',
    speaker: 'en',
    fields: { target: 'esperanto', meaning: 'english' },
    noteFields: [{ field: 'registerNotes', label: 'Usage' }],
    copy: { placementLede: '{n} quick cards.' },
    groups: [{ id: 'basics', title: 'Basics' }],
    categories: [
      { id: 'basics', order: 1, file: 'content/eo/basics.json', title: 'Basics', icon: '👋', group: 'basics', starter: true },
    ],
  },
  'content/eo/basics.json': {
    schemaVersion: 1,
    id: 'basics',
    title: 'Basics',
    phrases: [
      { id: 'b-01', esperanto: 'Saluton!', english: 'Hello!', registerNotes: 'Any time of day.', audio: 'audio/eo/b-01.mp3', tags: ['greeting'], difficulty: 1 },
      { id: 'b-02', esperanto: 'Dankon.', english: 'Thank you.', registerNotes: 'Add tre for "very".', audio: 'audio/eo/b-02.mp3', tags: ['thanks'], difficulty: 1 },
      { id: 'b-03', esperanto: 'Ĝis revido!', english: 'Goodbye!', registerNotes: 'Literally "until seeing again".', audio: 'audio/eo/b-03.mp3', tags: ['greeting'], difficulty: 2 },
    ],
  },
};

/* ---------- browser shims ---------- */

const mem = new Map();
globalThis.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.fetch = async (path) => {
  const rel = String(path).replace(/^\.\//, '');
  if (rel in OVERLAY) return { ok: true, status: 200, json: async () => structuredClone(OVERLAY[rel]) };
  const file = resolve(ROOT, rel);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};

const course = await import('../js/course.js');
const store = await import('../js/store.js');
const { loadContent } = await import('../js/content.js');
const deck = await import('../js/deck.js');
const srs = await import('../js/srs.js');
const quiz = await import('../js/quiz.js');

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nA language added as content only (Esperanto, made up for this test)');

const reg = await course.loadCourses();
check('the new course is listed', reg.courses.some((c) => c.id === 'en-eo'));
await course.setCourse('en-eo');
check('it gets its own storage', store.namespace() === 'en-eo');
check('the interface stays in the speaker\'s language', (await import('../js/i18n.js')).getLang() === 'en');

const content = await loadContent();
const hello = content.phrases.get('b-01');
check('its content loads through its own manifest', content.categories.length === 1 && content.phrases.size === 3);
check('the text being learned comes from its own field name', hello.target === 'Saluton!' && hello.targetLang === 'eo', hello.target);
check('meaning and notes come through', hello.meaning === 'Hello!' && hello.notes[0]?.label === 'Usage');
check('no reading aids it doesn\'t have', !content.features.ruby && !content.features.reading && !content.features.characters);

const items = await quiz.buildPlacementSet();
await quiz.applyPlacement(items, {});
check('placement seeds its deck from the starter category', (await deck.isOnboarded()) &&
  (await deck.getSettings()).activeCategories.join() === 'basics', `${items.length} placement cards`);

const queue = await deck.queue();
check('a review queue builds', queue.length > 0, `${queue.length} cards`);
const graded = await deck.grade(queue[0].id, srs.GRADE.GOOD);
check('a card grades and reschedules', graded?.reps === 1 && graded.due > Date.now());
check('its cards are stored apart from every other course', [...mem.keys()].some((k) => k.startsWith('ww-en-eo:srs:')) &&
  ![...mem.keys()].some((k) => k.startsWith('nt:')));

const snap = await deck.courseSnapshot('en-eo');
// Three items, each studied both ways by default: recognise it, and say it.
check('the home page can read its progress', snap.onboarded && snap.total === 3 * 2, JSON.stringify(snap));
check('"say it" cards wait until their item has been met once',
  (await deck.queue()).every((c) => c.state !== 'new' || c.dir !== 'production' || c.itemId === queue[0].itemId));

console.log(failures ? `\n✗ ${failures} of ${checks} language-pack checks failed\n`
  : `\n✓ all ${checks} language-pack checks passed — a new language needed no code\n`);
process.exit(failures ? 1 : 0);
