/**
 * crossref-kanji.mjs — links each kanji to the words, sentences and phrases
 * it already appears in.
 *
 * The point of the Characters section is reinforcement, not a second
 * disconnected vocabulary list. For every course whose manifest has a kanji
 * set, this scans that course's content and writes a `seenIn` array onto each
 * kanji entry, so the app can show "you already know this from: 出口はどこですか".
 * Words come first — 行く is the most direct place to meet 行 — then
 * sentences, then phrases.
 *
 * It also lists the kanji the words and sentences use that the kanji set
 * doesn't teach yet, which is the to-do list for growing the set.
 *
 * Idempotent — safe to re-run whenever content changes.
 *
 *   node tools/crossref-kanji.mjs
 *   node tools/crossref-kanji.mjs --check   # report only, write nothing
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const MAX_REFS = 6; // enough to show overlap without bloating the file

const readJSON = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));

const registry = readJSON('content/courses.json');
let found = 0;

for (const course of registry.courses.filter((c) => c.manifest)) {
  const manifest = readJSON(course.manifest);
  const target = manifest.fields?.target || 'japanese';
  const kanjiSets = (manifest.characterSets || []).filter((s) => s.script === 'kanji');
  for (const kanjiSet of kanjiSets) {
    found++;
    crossref(course, manifest, target, kanjiSet.file);
  }
  if (kanjiSets.length) untaughtReport(manifest, target, kanjiSets);
}

if (!found) console.log('No course has a kanji set — nothing to do.');
if (CHECK) console.log('\n--check: nothing written.');

/** Every word, sentence and phrase in a course — words first, they're the most direct reinforcement. */
function gather(manifest, target) {
  const phrases = [];
  const readable = (entry) => existsSync(resolve(ROOT, entry.file));
  const decks = (manifest.decks || []).filter(readable);
  for (const kind of ['words', 'sentences']) {
    for (const entry of decks.filter((d) => d.kind === kind)) {
      for (const item of readJSON(entry.file).items || []) {
        phrases.push({ id: item.id, text: item[target], category: entry.title, kind });
      }
    }
  }
  for (const entry of manifest.categories.filter(readable)) {
    const cat = readJSON(entry.file);
    for (const p of cat.phrases || []) {
      phrases.push({ id: p.id, text: p[target], category: cat.title, kind: 'phrases' });
    }
  }
  return phrases;
}

/** Kanji the word and sentence decks use that none of the course's kanji sets teach yet. */
function untaughtReport(manifest, target, kanjiSets) {
  // A compound entry (仕事, 病院) teaches each of its kanji too.
  const taught = new Set(kanjiSets.flatMap((s) => readJSON(s.file).characters.flatMap((c) => [...c.character])));
  const untaught = new Map();
  for (const p of gather(manifest, target).filter((x) => x.kind !== 'phrases')) {
    for (const ch of p.text.match(/[㐀-鿿豈-﫿]/gu) || []) {
      if (!taught.has(ch)) untaught.set(ch, (untaught.get(ch) || 0) + 1);
    }
  }
  if (!untaught.size) return;
  const list = [...untaught].sort((a, b) => b[1] - a[1]).map(([ch, n]) => `${ch}${n > 1 ? `×${n}` : ''}`);
  console.log(`\n${untaught.size} kanji in the words and sentences that no kanji set teaches yet:`);
  console.log(`  ${list.join(' ')}`);
}

function crossref(course, manifest, target, kanjiFile) {
  const phrases = gather(manifest, target);

  /* ---------- match ---------- */

  const kanji = readJSON(kanjiFile);
  let linked = 0;
  const orphans = [];

  for (const c of kanji.characters) {
    // Exact written form only. A component match would be a lie: 曜日 does
    // not appear in 日本語が少しわかります just because 日 does, and claiming
    // otherwise sends the learner to a phrase that doesn't contain the word.
    const matches = phrases.filter((p) => p.text.includes(c.character));
    const refs = matches.slice(0, MAX_REFS).map((p) => p.id);

    if (refs.length) {
      c.seenIn = refs;
      linked++;
    } else {
      delete c.seenIn;
      orphans.push(`${c.character} (${c.english})`);
    }
  }

  /* ---------- report ---------- */

  console.log(`\n${course.id} · ${kanjiFile}`);
  console.log(`Cross-referenced ${linked}/${kanji.characters.length} kanji against ${phrases.length} words, sentences and phrases.`);

  if (orphans.length) {
    console.log(`\n${orphans.length} not yet reinforced by anything (fine — they are signage-only):`);
    console.log(orphans.map((o) => `  · ${o}`).join('\n'));
  }

  const top = [...kanji.characters]
    .filter((c) => c.seenIn)
    .sort((a, b) => b.seenIn.length - a.seenIn.length)
    .slice(0, 5);
  console.log('\nMost reinforced:');
  for (const c of top) console.log(`  ${c.character.padEnd(6)} ${c.seenIn.length} phrases — ${c.seenIn.join(', ')}`);

  if (!CHECK) {
    writeFileSync(resolve(ROOT, kanjiFile), JSON.stringify(kanji, null, 2) + '\n');
    console.log(`\nWrote ${kanjiFile}`);
  }
}
