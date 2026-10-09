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
import { toSegments, rubyText, hasKanji } from '../js/ruby.js';

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

/**
 * Furigana, in either form (segment array or "{漢字|かんじ}" notation), must
 * spell out exactly the text it annotates, and every reading must be kana.
 */
function checkRuby(label, value, text) {
  if (value === undefined || value === null) return;
  const segs = toSegments(value);
  if (!check(`${label}: furigana parses`, Array.isArray(segs) && segs.length > 0)) return;
  const rebuilt = rubyText(value);
  check(`${label}: furigana reconstructs the text`, rebuilt === text, `${rebuilt} vs ${text}`);
  check(`${label}: furigana has no stray notation`, !/[{}|]/.test(rebuilt), rebuilt);
  for (const s of segs) {
    if (s.r !== undefined) check(`${label}: reading "${s.r}" is kana`, /^[぀-ヿー]+$/.test(s.r), s.r);
  }
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

// Word decks: every part of speech and word form any course declares (its
// manifest's `words`), each of which needs an interface string.
const POS = new Set();
const FORMS = new Set();
const REGISTERS = ['polite', 'casual'];

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

  // Categories are shown under named groups; `starter` ones are loaded by placement.
  if (check(`${course.id}: manifest declares groups`, Array.isArray(manifest.groups) && manifest.groups.length > 0)) {
    const groupIds = new Set(manifest.groups.map((g) => g.id));
    for (const g of manifest.groups) check(`${course.id}: group ${g.id} has a title`, Boolean(g.title));
    for (const c of manifest.categories) check(`${c.id}: group "${c.group}" is declared`, groupIds.has(c.group), c.group);
    check(`${course.id}: at least one starter category`, manifest.categories.some((c) => c.starter));
  }

  const fields = manifest.fields || {};
  const target = fields.target;

  // What words in this course can be: parts of speech, word forms, and the
  // forms every verb must show (Japanese: ます and て; English: none yet).
  const words = manifest.words || { pos: [], forms: [], verbForms: [] };
  if ((manifest.decks || []).some((d) => d.kind === 'words')) {
    check(`${course.id}: manifest declares its parts of speech`, Array.isArray(manifest.words?.pos) && manifest.words.pos.length > 0);
  }
  for (const p of words.pos || []) POS.add(p);
  for (const f of words.forms || []) FORMS.add(f);
  for (const f of words.verbForms || []) check(`${course.id}: required verb form "${f}" is a declared form`, (words.forms || []).includes(f));
  // A course whose default register is polite or casual labels every sentence.
  const usesRegister = REGISTERS.includes(manifest.register);

  // Which voice its clips are made with (tools/generate-audio.mjs). Optional: Google's by default.
  if (manifest.voice) {
    const { engine, azure } = manifest.voice;
    check(`${course.id}: voice engine is one the generator knows`, ['google', 'azure'].includes(engine), engine);
    const neural = (v) => typeof v === 'string' && /^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(v) && v.startsWith(`${manifest.language}-`);
    if (engine === 'azure' || azure) {
      check(`${course.id}: Azure voices are neural voices in the course's language`,
        neural(azure?.default) && (typeof azure.speakers === 'string'
          ? neural(azure.speakers)
          : Object.values(azure?.speakers || {}).every(neural)),
        JSON.stringify(azure));
    }
  }

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

      if (fields.ruby) checkRuby(p.id, p[fields.ruby], p[target]);
      for (const n of manifest.noteFields || []) {
        if (p[n.field] !== undefined) check(`${p.id}: ${n.field} is non-empty text`, typeof p[n.field] === 'string' && p[n.field].length > 0);
      }
      if (p.register !== undefined) {
        check(`${p.id}: register is polite or casual`, ['polite', 'casual'].includes(p.register), p.register);
      }

      // A casual phrase carries its polite counterpart, with its own clip.
      if (p.polite) {
        const q = p.polite;
        check(`${p.id}: polite version has ${target}`, Boolean(q[target]));
        if (fields.reading) check(`${p.id}: polite version has ${fields.reading}`, Boolean(q[fields.reading]));
        if (fields.ruby) checkRuby(`${p.id}/polite`, q[fields.ruby], q[target]);
        if (check(`${p.id}: polite version has audio`, Boolean(q.audio))) {
          check(`${p.id}: polite audio path is unique`, !seenAudio.has(q.audio));
          seenAudio.add(q.audio);
          const clip = resolve(ROOT, q.audio);
          if (existsSync(clip)) { audioPresent++; check(`${p.id}: polite clip is non-trivial`, statSync(clip).size > 800); }
          phraseCount++;
        }
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

  /* ---------- word and sentence decks ---------- */

  const wordIds = new Set();
  const chunkRefs = []; // checked once every deck is read: a sentence may use a later deck's word
  let deckItems = 0;
  let deckAudio = 0;

  // One word or sentence — from a word or sentence deck, or a connector lesson's examples.
  function checkItem(item, kind) {
    deckItems++;
    for (const field of ['id', target, fields.meaning, 'audio', 'tags', 'difficulty']) {
      check(`${item.id}: has ${field}`, item[field] !== undefined && item[field] !== '');
    }
    check(`${item.id}: unique id across all content`, !seenIds.has(item.id));
    seenIds.add(item.id);
    check(`${item.id}: difficulty in 1-5`, item.difficulty >= 1 && item.difficulty <= 5, String(item.difficulty));
    check(`${item.id}: tags is a non-empty array`, Array.isArray(item.tags) && item.tags.length > 0);
    if (item.audioHint !== undefined) check(`${item.id}: audioHint is text`, typeof item.audioHint === 'string' && item.audioHint.length > 0);

    if (fields.ruby) {
      checkRuby(item.id, item[fields.ruby], item[target]);
      // Reading is the weak skill this course is built around: no kanji without its reading.
      if (hasKanji(item[target])) check(`${item.id}: kanji carry furigana`, Boolean(item[fields.ruby]));
    }

    if (kind === 'word') {
      wordIds.add(item.id);
      check(`${item.id}: part of speech is one the course declares`, (words.pos || []).includes(item.pos), item.pos);
      if (item.pos === 'verb' && (words.verbForms || []).length) {
        check(`${item.id}: verb has its ${words.verbForms.join(' and ')} forms`, words.verbForms.every((f) => item.forms?.[f]));
      }
      for (const [key, value] of Object.entries(item.forms || {})) {
        check(`${item.id}: form "${key}" is one the course declares`, (words.forms || []).includes(key), key);
        if (fields.ruby) checkRuby(`${item.id}/${key}`, value, rubyText(value));
        if (hasKanji(rubyText(value))) check(`${item.id}/${key}: kanji carry furigana`, /\{[^|]+\|/.test(value));
      }
      if (item.usage !== undefined) check(`${item.id}: usage is non-empty text`, typeof item.usage === 'string' && item.usage.length > 0);
    } else {
      if (usesRegister || item.register !== undefined) {
        check(`${item.id}: register is polite or casual`, REGISTERS.includes(item.register), item.register);
      }
      // The chunks are the sentence cut into pieces — together, exactly the sentence.
      if (check(`${item.id}: has chunks`, Array.isArray(item.chunks) && item.chunks.length > 1)) {
        const rebuilt = item.chunks.map((c) => rubyText(c.t)).join('');
        check(`${item.id}: chunks rebuild the sentence`, rebuilt === item[target], `${rebuilt} vs ${item[target]}`);
        if (fields.ruby) {
          check(`${item.id}: chunks rebuild the furigana`, item.chunks.map((c) => c.t).join('') === item[fields.ruby]);
        }
        for (const c of item.chunks) if (c.w) chunkRefs.push([item.id, c.w]);
        check(`${item.id}: links at least one word`, item.chunks.some((c) => c.w));
      }
    }

    check(`${item.id}: audio path is unique`, !seenAudio.has(item.audio));
    seenAudio.add(item.audio);
    check(`${item.id}: audio lives under audio/${course.target}/`, String(item.audio).startsWith(`audio/${course.target}/`), item.audio);
    const clip = resolve(ROOT, item.audio);
    if (existsSync(clip)) {
      deckAudio++;
      check(`${item.id}: audio clip is non-trivial`, statSync(clip).size > 800);
    }
  }

  for (const entry of manifest.decks || []) {
    check(`${entry.id}: deck kind is words or sentences`, ['words', 'sentences'].includes(entry.kind), entry.kind);
    check(`${entry.id}: deck has a title`, Boolean(entry.title));
    if (!check(`deck file exists: ${entry.file}`, existsSync(resolve(ROOT, entry.file)))) continue;

    const deck = readJSON(entry.file);
    check(`${entry.id}: schemaVersion matches`, deck.schemaVersion === manifest.schemaVersion);
    check(`${entry.id}: id matches manifest`, deck.id === entry.id, `${deck.id} vs ${entry.id}`);
    check(`${entry.id}: has items`, Array.isArray(deck.items) && deck.items.length > 0);
    for (const item of deck.items || []) checkItem(item, entry.kind === 'words' ? 'word' : 'sentence');
  }

  /* ---------- connector lessons ---------- */

  const lessonGroupIds = new Set((manifest.lessonGroups || []).map((g) => g.id));
  let lessonExamples = 0;
  let combineDrills = 0;
  for (const entry of manifest.lessons || []) {
    check(`${entry.id}: lesson group "${entry.group}" is declared`, lessonGroupIds.has(entry.group), entry.group);
    if (!check(`lesson file exists: ${entry.file}`, existsSync(resolve(ROOT, entry.file)))) continue;
    const lesson = readJSON(entry.file);
    check(`${entry.id}: schemaVersion matches`, lesson.schemaVersion === manifest.schemaVersion);
    check(`${entry.id}: id matches manifest`, lesson.id === entry.id, `${lesson.id} vs ${entry.id}`);
    for (const f of ['connector', 'gloss', 'title', 'pattern', 'explanation', 'natural', 'stiff']) {
      check(`${entry.id}: has ${f}`, typeof lesson[f] === 'string' && lesson[f].length > 0);
    }
    // In a course whose target has furigana, the prose quotes it to someone
    // still learning to read: every kanji gets its reading. (In the English
    // course the prose is the learner's own Japanese, which needs none.)
    if (fields.ruby) {
      for (const f of ['explanation', 'natural', 'stiff']) {
        const bare = String(lesson[f] || '').replace(/\{[^|{}]+\|[^{}]+\}/g, '');
        check(`${entry.id}: ${f} gives every kanji a reading`, !hasKanji(bare), bare.match(/[㐀-鿿豈-﫿々]/u)?.[0]);
        checkRuby(`${entry.id}/${f}`, lesson[f], rubyText(lesson[f]));
      }
    }
    check(`${entry.id}: 3–5 examples`, lesson.examples?.length >= 3 && lesson.examples.length <= 5, String(lesson.examples?.length));

    for (const ex of lesson.examples || []) {
      lessonExamples++;
      checkItem(ex, 'sentence');
      const n = (ex.chunks || []).length;

      // Fill-in: the gap and the text around it are the sentence, exactly.
      if (check(`${ex.id}: has a fill-in gap`, Boolean(ex.gap?.answer))) {
        const g = ex.gap;
        check(`${ex.id}: the gap rebuilds the sentence`, g.before + g.answer + g.after === ex[fields.ruby || target]);
        check(`${ex.id}: the answer is one of the options`, g.options?.includes(g.answer));
        check(`${ex.id}: options are distinct`, new Set(g.options).size === g.options?.length);
        check(`${ex.id}: two to four options`, g.options?.length >= 2 && g.options.length <= 4, String(g.options?.length));
        for (const o of g.ok || []) check(`${ex.id}: "also right" option ${o} is offered`, g.options.includes(o) && o !== g.answer);
        if ((g.ok || []).length) check(`${ex.id}: an "also right" option says why`, Boolean(g.note));
        for (const o of g.options || []) {
          checkRuby(`${ex.id}/option`, o, rubyText(o));
          if (hasKanji(rubyText(o))) check(`${ex.id}/option ${o}: kanji carry furigana`, /\{[^|]+\|/.test(o));
        }
      }
      // Orders other than the written one that are just as right.
      for (const o of ex.alsoOrders || []) {
        check(`${ex.id}: alternative order is a reordering`, o.length === n && [...o].sort((a, b) => a - b).every((v, i) => v === i), o.join());
      }
      // Combine: two sentences to join, and trap pieces that aren't pieces of the answer.
      if (ex.combine) {
        combineDrills++;
        const c = ex.combine;
        check(`${ex.id}: combine has two sentences and a trap`, Boolean(c.a && c.b) && c.distractors?.length > 0);
        for (const piece of [c.a, c.b, ...(c.distractors || [])]) {
          checkRuby(`${ex.id}/combine`, piece, rubyText(piece));
          if (hasKanji(rubyText(piece))) check(`${ex.id}/combine ${piece}: kanji carry furigana`, /\{[^|]+\|/.test(piece));
        }
        for (const d of c.distractors || []) {
          check(`${ex.id}: trap "${d}" isn't a real piece`, !(ex.chunks || []).some((ch) => ch.t === d));
        }
      }
    }
  }

  for (const [sentence, word] of chunkRefs) {
    check(`${sentence}: word ${word} is in a word deck`, wordIds.has(word));
  }
  if (deckItems) {
    console.log(`  ${deckItems} words and sentences, ${deckAudio} with generated audio (${deckItems - deckAudio} pending)`);
  }
  if (lessonExamples) {
    console.log(`  ${(manifest.lessons || []).length} connector lessons: ${lessonExamples} examples, ${combineDrills} combine drills`);
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
const EN_ONLY = /^(reading\.|settings\.(newChars|characters)|quiz\.(reading|loaded$)|toast\.romajiRetired)/;

// Strings are content: content/ui/<lang>.json, one per language people learn
// from. Plural variants (key_one, key_other…) count as the key itself.
const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKeys = (dict) => new Set(Object.keys(dict).filter((k) => !k.startsWith('$')).map((k) => k.replace(PLURAL, '')));
const uiDicts = {};
for (const lang of new Set(['en', ...registry.speakers])) {
  const file = `content/ui/${lang}.json`;
  if (check(`interface strings exist for ${lang} (${file})`, existsSync(resolve(ROOT, file)))) {
    uiDicts[lang] = readJSON(file);
  }
}

const enKeys = baseKeys(uiDicts.en || {});
for (const [lang, dict] of Object.entries(uiDicts)) {
  if (lang === 'en') continue;
  const keys = baseKeys(dict);
  for (const key of keys) check(`${lang} key ${key} exists in en`, enKeys.has(key));
  for (const key of enKeys) {
    if (!EN_ONLY.test(key)) check(`en key ${key} has a ${lang} translation`, keys.has(key));
  }
}
for (const [lang, dict] of Object.entries(uiDicts)) {
  for (const [key, value] of Object.entries(dict)) {
    check(`${lang}:${key} is a non-empty string`, typeof value === 'string' && value.length > 0);
  }
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
console.log(`  ${Object.keys(uiDicts).join(', ')}: ${enKeys.size} keys, ${literalKeys} uses checked`);

// Keys built at runtime (t(`pos.${…}`)) can't be found by the scan above.
for (const pos of POS) check(`pos.${pos} has an interface string`, enKeys.has(`pos.${pos}`));
for (const form of FORMS) check(`forms.${form} has an interface string`, enKeys.has(`forms.${form}`));
// A rejected backup says why: t(`data.${reason}`).
for (const reason of ['notBackup', 'newer']) check(`data.${reason} has an interface string`, enKeys.has(`data.${reason}`));
for (const verdict of ['right', 'ok', 'wrong']) check(`drill.${verdict} has an interface string`, enKeys.has(`drill.${verdict}`));
for (const dir of Object.values(srs.DIR)) {
  check(`dir.${dir} has an interface string`, enKeys.has(`dir.${dir}`));
  check(`settings.dirHelp.${dir} has an interface string`, enKeys.has(`settings.dirHelp.${dir}`));
}

/* ---------- service worker ---------- */

console.log('\nService worker');

// Every module the app imports must be in the precached shell, or a cold
// offline launch fails on the first screen that needs the missing one.
const swSource = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
const shell = new Set([...(swSource.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]));
const modules = readdirSync(resolve(ROOT, 'js')).filter((f) => f.endsWith('.js'));
for (const file of modules) check(`sw.js precaches js/${file}`, shell.has(`./js/${file}`));
for (const entry of shell) check(`sw.js shell entry ${entry} exists`, entry === './' || existsSync(resolve(ROOT, entry)));
console.log(`  ${shell.size} shell files, ${modules.length} modules`);

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
