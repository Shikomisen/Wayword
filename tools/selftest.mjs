/**
 * selftest.mjs — content validation + SRS regression check.
 *
 * Runs without a browser. Catches the failure modes that would silently
 * break the app: malformed/incomplete content JSON in any course, an
 * interface string with no translation, and an SRS scheduler that stops
 * laddering.
 *
 *   node tools/selftest.mjs
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as srs from '../js/srs.js';
import { dictionaries as i18nDicts } from '../js/i18n.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks++;
  if (!condition) {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return condition;
}

function readJSON(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
}

/* ---------- courses ---------- */

console.log('\nCourses');

const registry = readJSON('content/courses.json');
check('courses.json has schemaVersion', typeof registry.schemaVersion === 'number');
check('courses.json lists courses', Array.isArray(registry.courses) && registry.courses.length > 0);

const courseIds = new Set();
for (const c of registry.courses) {
  check(`${c.id}: unique course id`, !courseIds.has(c.id));
  courseIds.add(c.id);
  check(`${c.id}: id is <speaker>-<target>`, c.id === `${c.speaker}-${c.target}`);
  check(`${c.id}: speaker is a declared speaker`, registry.speakers.includes(c.speaker), c.speaker);
  check(`${c.id}: both languages are described`,
    Boolean(registry.languages[c.speaker] && registry.languages[c.target]));
  check(`${c.id}: status is available or planned`, ['available', 'planned'].includes(c.status), c.status);
  if (c.status === 'available') {
    check(`${c.id}: available course has a manifest`, Boolean(c.manifest) && existsSync(resolve(ROOT, c.manifest)), c.manifest);
  } else {
    check(`${c.id}: planned course has no manifest yet`, !c.manifest);
  }
}
for (const [code, lang] of Object.entries(registry.languages)) {
  for (const ui of registry.speakers) {
    check(`language ${code} is named in ${ui}`, Boolean(lang.name?.[ui]));
  }
}

/* ---------- content, per course ---------- */

// Audio paths must be unique across every course, not just within one.
const seenAudio = new Set();

for (const course of registry.courses.filter((c) => c.manifest && existsSync(resolve(ROOT, c.manifest)))) {
  validateCourse(course);
}

function validateCourse(course) {
  console.log(`\nContent — ${course.id}`);

  const manifest = readJSON(course.manifest);
  check(`${course.id}: manifest has schemaVersion`, typeof manifest.schemaVersion === 'number');
  check(`${course.id}: manifest lists categories`, Array.isArray(manifest.categories) && manifest.categories.length > 0);
  check(`${course.id}: manifest language matches the course target`, manifest.language === course.target, manifest.language);
  check(`${course.id}: manifest speaker matches the course`, manifest.speaker === course.speaker, manifest.speaker);
  check(`${course.id}: manifest declares its fields`, Boolean(manifest.fields?.target && manifest.fields?.meaning));
  check(`${course.id}: placement copy present`, Boolean(manifest.copy?.placementLede));

  const fields = manifest.fields || {};
  const target = fields.target;

  // Card ids only need to be unique within a course: each course has its own storage.
  const seenIds = new Set();
  let phraseCount = 0;
  let audioPresent = 0;

  const REQUIRED = ['id', fields.target, fields.meaning, fields.reading, 'registerNotes', 'audio', 'tags', 'difficulty']
    .filter(Boolean);

  for (const entry of manifest.categories) {
    if (!check(`category file exists: ${entry.file}`, existsSync(resolve(ROOT, entry.file)))) continue;

    const cat = readJSON(entry.file);
    check(`${entry.id}: schemaVersion present`, cat.schemaVersion === manifest.schemaVersion);
    check(`${entry.id}: id matches manifest`, cat.id === entry.id, `${cat.id} vs ${entry.id}`);
    check(`${entry.id}: has phrases`, Array.isArray(cat.phrases) && cat.phrases.length > 0);

    for (const p of cat.phrases || []) {
      phraseCount++;
      for (const field of REQUIRED) {
        check(`${p.id}: has ${field}`, p[field] !== undefined && p[field] !== '');
      }
      check(`${p.id}: unique id`, !seenIds.has(p.id));
      seenIds.add(p.id);

      check(`${p.id}: difficulty in 1-5`, p.difficulty >= 1 && p.difficulty <= 5, String(p.difficulty));
      check(`${p.id}: tags is a non-empty array`, Array.isArray(p.tags) && p.tags.length > 0);

      if (fields.ruby && Array.isArray(p[fields.ruby])) {
        const rebuilt = p[fields.ruby].map((s) => s.b).join('');
        check(`${p.id}: furigana segments reconstruct ${target}`, rebuilt === p[target], `${rebuilt} vs ${p[target]}`);
      }
      for (const n of manifest.noteFields || []) {
        if (p[n.field] !== undefined) check(`${p.id}: ${n.field} is non-empty text`, typeof p[n.field] === 'string' && p[n.field].length > 0);
      }

      check(`${p.id}: audio path is unique`, !seenAudio.has(p.audio));
      seenAudio.add(p.audio);
      check(`${p.id}: audio lives under audio/${course.target}/`, p.audio.startsWith(`audio/${course.target}/`), p.audio);

      const audioPath = resolve(ROOT, p.audio);
      if (existsSync(audioPath)) {
        audioPresent++;
        check(`${p.id}: audio clip is non-trivial`, statSync(audioPath).size > 800);
      }
    }
  }

  /* ---------- character sets ---------- */

  const CHAR_REQUIRED = ['id', 'character', 'japanese', 'romaji', 'audio', 'tags', 'difficulty', 'group'];
  let charCount = 0;
  let charAudioPresent = 0;

  for (const entry of manifest.characterSets || []) {
    if (!check(`character set file exists: ${entry.file}`, existsSync(resolve(ROOT, entry.file)))) continue;

    const set = readJSON(entry.file);
    check(`${entry.id}: schemaVersion matches`, set.schemaVersion === manifest.schemaVersion);
    check(`${entry.id}: id matches manifest`, set.id === entry.id, `${set.id} vs ${entry.id}`);
    check(`${entry.id}: has characters`, Array.isArray(set.characters) && set.characters.length > 0);
    check(`${entry.id}: declares groups`, Array.isArray(set.groups) && set.groups.length > 0);

    const groupIds = new Set((set.groups || []).map((g) => g.id));

    for (const c of set.characters || []) {
      charCount++;
      for (const field of CHAR_REQUIRED) {
        check(`${c.id}: has ${field}`, c[field] !== undefined && c[field] !== '');
      }
      check(`${c.id}: unique id across all content`, !seenIds.has(c.id));
      seenIds.add(c.id);

      check(`${c.id}: group is declared`, groupIds.has(c.group), c.group);
      check(`${c.id}: difficulty in 1-5`, c.difficulty >= 1 && c.difficulty <= 5, String(c.difficulty));
      check(`${c.id}: japanese mirrors character`, c.japanese === c.character);
      check(`${c.id}: readings is a non-empty array`, Array.isArray(c.readings) && c.readings.length > 0);

      if (Array.isArray(c.furigana)) {
        const rebuilt = c.furigana.map((s) => s.b).join('');
        check(`${c.id}: furigana segments reconstruct the character`, rebuilt === c.character);
      }

      // Kanji carry a meaning; kana legitimately do not (README §12).
      if (set.script === 'kanji') {
        check(`${c.id}: kanji has an English meaning`, Boolean(c.english));
        for (const ref of c.seenIn || []) {
          check(`${c.id}: cross-ref ${ref} is a real phrase`, seenIds.has(ref));
        }
      } else {
        check(`${c.id}: kana leaves english null`, c.english === null);
      }

      check(`${c.id}: audio path is unique`, !seenAudio.has(c.audio));
      seenAudio.add(c.audio);

      const audioPath = resolve(ROOT, c.audio);
      if (existsSync(audioPath)) {
        charAudioPresent++;
        check(`${c.id}: audio clip is non-trivial`, statSync(audioPath).size > 800);
      }
    }
  }

  if (charCount) {
    console.log(`  ${charCount} characters, ${charAudioPresent} with generated audio (${charCount - charAudioPresent} pending)`);
  }

  for (const s of manifest.scenarios || []) {
    if (!check(`scenario file exists: ${s.file}`, existsSync(resolve(ROOT, s.file)))) continue;
    const sc = readJSON(s.file);
    check(`${s.id}: has a start node`, Boolean(sc.start));
    check(`${s.id}: has nodes`, sc.nodes && Object.keys(sc.nodes).length > 0);
    check(`${s.id}: category exists`, manifest.categories.some((c) => c.id === s.category), s.category);

    check(`${s.id}: start node resolves`, Boolean(sc.nodes?.[sc.start]), sc.start);

    const QUALITIES = ['good', 'awkward', 'wrong'];
    const reachable = new Set([sc.start]);

    for (const [nodeId, node] of Object.entries(sc.nodes || {})) {
      const terminal = node.end === true;
      check(`${s.id}/${nodeId}: has options or is terminal`,
        terminal || (node.options || []).length > 0);
      if (node.speaker === 'narration') {
        check(`${s.id}/${nodeId}: narration is written in the learner's language`, Boolean(node[fields.meaning]));
      }

      if (node.audio) {
        const clip = resolve(ROOT, node.audio);
        check(`${s.id}/${nodeId}: audio clip exists`, existsSync(clip), node.audio);
        if (existsSync(clip)) check(`${s.id}/${nodeId}: audio clip is non-trivial`, statSync(clip).size > 800);
        check(`${s.id}/${nodeId}: audio has text to synthesise`, Boolean(node.audioHint || node[target]));
        check(`${s.id}/${nodeId}: audio path is unique`, !seenAudio.has(node.audio));
        seenAudio.add(node.audio);
      }

      for (const opt of node.options || []) {
        const next = opt.next;
        check(
          `${s.id}/${nodeId}: option target "${next}" exists`,
          next === null || next === undefined || next === 'END' || Boolean(sc.nodes[next])
        );
        if (sc.nodes[next]) reachable.add(next);

        check(`${s.id}/${nodeId}: option quality is valid`,
          !opt.quality || QUALITIES.includes(opt.quality), opt.quality);
        check(`${s.id}/${nodeId}: option has feedback`, Boolean(opt.feedback));
        check(`${s.id}/${nodeId}: option has text or a phraseId`,
          Boolean(opt.phraseId || opt[target] || opt[fields.meaning]));

        if (opt.phraseId) {
          check(`${s.id}/${nodeId}: phrase ${opt.phraseId} exists in content`, seenIds.has(opt.phraseId));
        }
      }
      if (node.phraseId) {
        check(`${s.id}/${nodeId}: phrase ${node.phraseId} exists in content`, seenIds.has(node.phraseId));
      }
    }

    // Walk from the start so an orphaned node can't hide a broken branch.
    for (let grew = true; grew; ) {
      grew = false;
      for (const id of [...reachable]) {
        for (const opt of sc.nodes[id]?.options || []) {
          if (sc.nodes[opt.next] && !reachable.has(opt.next)) { reachable.add(opt.next); grew = true; }
        }
      }
    }
    for (const nodeId of Object.keys(sc.nodes || {})) {
      check(`${s.id}/${nodeId}: reachable from start`, reachable.has(nodeId));
    }
    check(`${s.id}: every path can terminate`,
      [...reachable].some((id) => sc.nodes[id].end === true));
  }

  console.log(`  ${phraseCount} phrases, ${audioPresent} with generated audio (${phraseCount - audioPresent} pending)`);
}

/* ---------- interface strings ---------- */

console.log('\nInterface strings');

// Keys the Japanese interface can never reach: they belong to features only
// courses with furigana, romaji or character sets have, and every such course
// today is taught from English.
const EN_ONLY = /^(reading\.|settings\.(furigana|romaji|newChars|characters)|quiz\.(reading|loaded$)|toast\.romajiRetired)/;

const enKeys = new Set(Object.keys(i18nDicts.en));
const jaKeys = new Set(Object.keys(i18nDicts.ja));
for (const key of jaKeys) check(`ja key ${key} exists in en`, enKeys.has(key));
for (const key of enKeys) {
  if (!EN_ONLY.test(key)) check(`en key ${key} has a Japanese translation`, jaKeys.has(key));
}

// Every literal t('…') in the app must name a real key, or the raw key would show.
let literalKeys = 0;
for (const file of readdirSync(resolve(ROOT, 'js')).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(resolve(ROOT, 'js', file), 'utf8');
  for (const [, key] of src.matchAll(/\bt\('([\w.]+)'/g)) {
    literalKeys++;
    check(`${file}: t('${key}') exists`, enKeys.has(key));
  }
}
console.log(`  ${enKeys.size} keys, ${jaKeys.size} translated to Japanese, ${literalKeys} uses checked`);

/* ---------- SRS ---------- */

console.log('\nSRS (SM-2)');

let card = srs.newCard('t-1', 'test');
check('new card is due immediately', card.due <= Date.now());
check('new card starts at ease 2.5', card.ease === 2.5);

card = srs.review(card, srs.GRADE.GOOD);
check('first success -> 1 day', card.interval === 1, String(card.interval));

card = srs.review(card, srs.GRADE.GOOD);
check('second success -> 6 days', card.interval === 6, String(card.interval));

const third = srs.review(card, srs.GRADE.GOOD);
check('third success multiplies by ease', third.interval > 6, String(third.interval));
check('intervals keep growing', srs.review(third, srs.GRADE.GOOD).interval > third.interval);

const lapsed = srs.review(third, srs.GRADE.AGAIN);
check('lapse resets reps', lapsed.reps === 0);
check('lapse increments lapses', lapsed.lapses === 1);
check('lapse drops ease', lapsed.ease < third.ease);
check('lapse returns within the hour', lapsed.due - Date.now() < srs.DAY);
check('ease floors at 1.3', (() => {
  let c = srs.newCard('t-2', 'test');
  for (let i = 0; i < 40; i++) c = srs.review(c, srs.GRADE.AGAIN);
  return c.ease >= 1.3;
})());

const hard = srs.review(srs.review(srs.newCard('t-3', 'test'), srs.GRADE.GOOD), srs.GRADE.HARD);
check('"hard" still advances but lowers ease', hard.interval === 6 && hard.ease < 2.5, `${hard.interval}/${hard.ease.toFixed(2)}`);

const easy = srs.review(srs.review(srs.newCard('t-4', 'test'), srs.GRADE.GOOD), srs.GRADE.EASY);
check('"easy" schedules further out than "good"', easy.interval > 6, String(easy.interval));

const seeded = srs.seedKnown('t-5', 'test', 6);
check('seeded card is not new', seeded.state === 'review');
check('seeded card is due in ~6 days', Math.round((seeded.due - Date.now()) / srs.DAY) === 6);
check('seeded card is excluded from the due queue today', srs.dueCards([seeded]).length === 0);

const queue = srs.buildQueue(
  [srs.newCard('n1', 'c'), srs.newCard('n2', 'c'), { ...srs.newCard('d1', 'c'), state: 'review', due: Date.now() - 1000 }],
  { newLimit: 1 }
);
check('queue puts due cards before new ones', queue[0].id === 'd1', queue.map((q) => q.id).join(','));
check('queue respects the new-card limit', queue.length === 2, String(queue.length));

// Character deck separation.
check('cards default to kind "phrase"', srs.newCard('p1', 'c').kind === 'phrase');
check('character cards carry their kind',
  srs.newCard('c1', 'hiragana', Date.now(), { kind: srs.KIND.CHARACTER }).kind === 'character');
check('seedKnown preserves kind',
  srs.seedKnown('c2', 'hiragana', 6, 2.6, Date.now(), { kind: srs.KIND.CHARACTER }).kind === 'character');
check('ofKind splits a mixed deck', (() => {
  const mixed = [
    srs.newCard('p', 'greetings'),
    srs.newCard('c', 'hiragana', Date.now(), { kind: srs.KIND.CHARACTER }),
  ];
  return srs.ofKind(mixed, srs.KIND.PHRASE).length === 1 && srs.ofKind(mixed, srs.KIND.CHARACTER).length === 1;
})());
check('ofKind treats untagged legacy records as phrases', (() => {
  const legacy = { id: 'old', categoryId: 'greetings', state: 'new' }; // written before `kind` existed
  return srs.ofKind([legacy], srs.KIND.PHRASE).length === 1;
})());

check('new cards are introduced easiest-first', (() => {
  const now = Date.now();
  const cards = [
    srs.newCard('hard', 'hiragana', now, { difficulty: 3 }),
    srs.newCard('easy', 'hiragana', now, { difficulty: 1 }),
    srs.newCard('mid', 'hiragana', now, { difficulty: 2 }),
  ];
  return srs.buildQueue(cards, { newLimit: 3 }).map((c) => c.id).join(',') === 'easy,mid,hard';
})());

/* ---------- result ---------- */

console.log(
  failures ? `\n✗ ${failures} of ${checks} checks failed\n` : `\n✓ all ${checks} checks passed\n`
);
process.exit(failures ? 1 : 0);
