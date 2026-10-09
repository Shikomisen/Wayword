/**
 * generate-audio.mjs — build-time TTS pass (README §3-audio).
 *
 * This is a ONE-TIME build step, not a runtime dependency. It walks every
 * course in content/courses.json, synthesises every phrase to an mp3 in that
 * course's target language, and writes it to the path already declared in
 * that phrase's `audio` field. The app then just plays a file — no
 * speechSynthesis call, no dependency on the end user's device having a
 * Japanese (or English) voice installed.
 *
 * Usage:
 *   node tools/generate-audio.mjs                 # only missing clips
 *   node tools/generate-audio.mjs --force         # re-synthesise everything
 *   node tools/generate-audio.mjs --only greetings,numbers
 *   node tools/generate-audio.mjs --course ja-en  # one course only
 *   node tools/generate-audio.mjs --check         # report coverage, generate nothing
 *   node tools/generate-audio.mjs --course ja-en --samples
 *        # a few sample clips in the course's Azure voices, into tmp/voice-samples/
 *   node tools/generate-audio.mjs --course ja-en --set-engine azure
 *        # switch the course to its Azure voices for good, and remake every clip
 *        # (npm run voice:nz)
 *   node tools/generate-audio.mjs --course ja-en --engine azure --only cafe --force
 *        # one run in another engine, without switching the course
 *
 * Category ids repeat across courses (both have "greetings"), so pair
 * --only with --course when forcing a re-synthesis.
 *
 * Voices. A course's manifest can name its voice:
 *   "voice": { "engine": "google",
 *              "azure": { "default": "en-NZ-MollyNeural", "speakers": "en-NZ-MitchellNeural" } }
 * `engine` is what its clips are made with. Without a `voice`, it's Google
 * Translate's public TTS endpoint (the one gTTS wraps), fine for a few
 * hundred short phrases. `azure` is Microsoft's neural voices: `default`
 * speaks everything the learner says, `speakers` the people they talk to
 * (scenario lines) — one voice, or one per speaker with "*" for the rest. It
 * needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (free tier is plenty); the
 * key is read at build time only and never goes in the repo or the app. With
 * no key, an Azure run stops before doing anything and says how to set one —
 * it never falls back to another voice, which would mix two voices in one
 * course.
 *
 * For tools/voice-test.mjs, which runs this against a stand-in for Azure:
 * AZURE_SPEECH_ENDPOINT replaces Azure's URL, WAYWORD_AUDIO_OUT writes the
 * clips under another folder instead of over the real ones, and
 * WAYWORD_AUDIO_THROTTLE_MS replaces the pause between requests.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { toSegments } from '../js/ruby.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const FORCE = flag('--force');
const CHECK = flag('--check');
const SAMPLES = flag('--samples');
const ONLY = option('--only') ? new Set(option('--only').split(',')) : null;
const COURSE = option('--course');
const SET_ENGINE = option('--set-engine');
const ENGINE = option('--engine');
const ENGINES = ['google', 'azure'];
if (ENGINE && !ENGINES.includes(ENGINE)) {
  console.error(`unknown engine "${ENGINE}" (${ENGINES.join(', ')})`);
  process.exit(1);
}

// Where clips are written: the project, or (for the voice test) somewhere harmless.
const OUT_ROOT = process.env.WAYWORD_AUDIO_OUT ? resolve(ROOT, process.env.WAYWORD_AUDIO_OUT) : ROOT;

const THROTTLE_MS = { google: 350, azure: 3100 }; // Azure's free tier allows 20 requests a minute
const throttle = (engine) => Number(process.env.WAYWORD_AUDIO_THROTTLE_MS ?? (THROTTLE_MS[engine] ?? THROTTLE_MS.google));
const MAX_RETRIES = 3;
const MIN_VALID_BYTES = 800; // anything smaller is an error page, not audio

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJSON(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), 'utf8'));
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/* ---------- engines ---------- */

/**
 * Azure's key and region: from the environment — or, on Windows, from the
 * user's saved environment, so a key set with `setx` works in a terminal
 * opened before it was set. A variable set but empty means no key.
 */
function azureCredentials() {
  const read = (name) => {
    if (name in process.env) return process.env[name].trim() || null;
    if (process.platform !== 'win32') return null;
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`))?.[1]?.trim() || null;
    } catch {
      return null;
    }
  };
  const key = read('AZURE_SPEECH_KEY');
  const region = read('AZURE_SPEECH_REGION');
  return key && region ? { key, region } : null;
}

const NO_AZURE_KEY = `No Azure Speech key found, so nothing was generated.
  The ${'`azure`'} voice needs a Speech resource (the free F0 tier is plenty):
    1. portal.azure.com → Create a resource → "Speech" → pricing tier Free F0.
    2. Its "Keys and Endpoint" page shows KEY 1 and the Location/Region (e.g. australiaeast).
    3. Save them for your user (Windows):
         setx AZURE_SPEECH_KEY "<key 1>"
         setx AZURE_SPEECH_REGION "<region>"
  Then run this again. The key stays on this PC: it never goes in the repo or the app.`;

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

class RateLimited extends Error {
  constructor(wait) { super(`rate limited, waiting ${wait}s`); this.wait = wait; }
}

/**
 * Synthesise one line to mp3 bytes. The whole TTS-vendor decision is
 * contained here: `job.engine` picks the service, `job.voice` the voice.
 */
async function synthesise(job) {
  let res;
  if (job.engine === 'azure') {
    const { key, region } = azureCredentials();
    const lang = job.voice.split('-').slice(0, 2).join('-'); // en-NZ-MollyNeural → en-NZ
    const endpoint = process.env.AZURE_SPEECH_ENDPOINT || `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'wayword-generate-audio',
      },
      body: `<speak version="1.0" xml:lang="${lang}"><voice name="${job.voice}">${escapeXml(job.text)}</voice></speak>`,
    });
    if (res.status === 429) throw new RateLimited(Number(res.headers.get('retry-after')) || 30);
    if (res.status === 401) fail('Azure refused the key (401): check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.');
  } else {
    const url =
      'https://translate.google.com/translate_tts' +
      `?ie=UTF-8&q=${encodeURIComponent(job.text)}&tl=${encodeURIComponent(job.lang)}&client=tw-ob&ttsspeed=1`;
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: 'https://translate.google.com/',
      },
    });
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_VALID_BYTES) throw new Error(`suspiciously small response (${buf.length}B)`);
  return buf;
}

async function synthesiseWithRetry(job) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await synthesise(job);
    } catch (err) {
      lastErr = err;
      if (err instanceof RateLimited) {
        await sleep(err.wait * 1000); // the free tier's per-minute cap: wait it out, it doesn't count as a failure
        attempt--;
      } else if (attempt < MAX_RETRIES) {
        await sleep(1200 * attempt); // back off
      }
    }
  }
  throw lastErr;
}

/* ---------- which voice a course uses ---------- */

/** A course's voice: its manifest's, unless this run asked for another engine. */
function voiceConfig(manifest) {
  const voice = manifest.voice || {};
  return { engine: ENGINE || voice.engine || 'google', azure: voice.azure || null };
}

/** The voice for a line: the learner's own lines, or one of the people they talk to. */
function azureVoice(azure, speaker) {
  if (!speaker) return azure.default;
  if (typeof azure.speakers === 'string') return azure.speakers;
  return azure.speakers?.[speaker] || azure.speakers?.['*'] || azure.default;
}

/* ---------- collect work ---------- */

const jobs = [];
const problems = [];

const courses = readJSON('content/courses.json').courses
  .filter((c) => c.manifest && (!COURSE || c.id === COURSE));
if (COURSE && !courses.length) problems.push(`no course "${COURSE}" with content in content/courses.json`);

if (SET_ENGINE) setEngine();
if (SAMPLES) await samples();

for (const course of courses) collect(course);

/**
 * Switch a course's voice for good: write the engine into its manifest, so
 * every clip from now on — new content included — uses it. Checks the
 * engine can actually run first, so a failed switch changes nothing.
 */
function setEngine() {
  if (!COURSE) fail('--set-engine needs --course, e.g. --course ja-en');
  if (!ENGINES.includes(SET_ENGINE)) fail(`unknown engine "${SET_ENGINE}" (${ENGINES.join(', ')})`);
  const course = courses[0];
  if (!course) fail(`no course "${COURSE}"`);
  const path = resolve(ROOT, course.manifest);
  const text = readFileSync(path, 'utf8');
  const manifest = JSON.parse(text);
  if (SET_ENGINE === 'azure' && !manifest.voice?.azure) fail(`${course.manifest} has no "voice.azure" to switch to`);
  if (SET_ENGINE === 'azure' && !azureCredentials()) fail(NO_AZURE_KEY);
  // A targeted edit, so the manifest's own layout survives.
  const pattern = /("voice"\s*:\s*\{[\s\S]*?"engine"\s*:\s*")([a-z]+)(")/;
  if (!pattern.test(text)) fail(`${course.manifest} has no "voice": { "engine": … } to change`);
  writeFileSync(path, text.replace(pattern, `$1${SET_ENGINE}$3`));
  console.log(`${course.id}: voice engine is now "${SET_ENGINE}" (${course.manifest}).`);
}

/**
 * A handful of clips to judge a voice by before switching a whole course to
 * it: a plain phrase, a question and a scenario line, in each voice.
 */
async function samples() {
  if (!COURSE) fail('--samples needs --course, e.g. --course ja-en');
  const course = courses[0];
  const manifest = readJSON(course.manifest);
  const { azure } = voiceConfig(manifest);
  if (!azure) fail(`${course.manifest} has no "voice.azure" to sample`);
  if (!azureCredentials()) fail(NO_AZURE_KEY);

  const target = manifest.fields?.target || 'english';
  const phrases = manifest.categories.flatMap((c) => readJSON(c.file).phrases || []);
  const statement = phrases.find((p) => /\.$/.test(p[target]) && p[target].split(' ').length >= 4);
  const question = phrases.find((p) => /\?$/.test(p[target]) && p[target].split(' ').length >= 5);
  const scene = manifest.scenarios?.[0] && readJSON(manifest.scenarios[0].file);
  const npc = scene && Object.values(scene.nodes).find((n) => n[target] && n.speaker !== 'narration');
  const lines = [statement?.[target], question?.[target], npc?.[target]].filter(Boolean);
  const voices = [...new Set([azure.default, azureVoice(azure, npc?.speaker || '*')])];

  const outDir = join(OUT_ROOT, 'tmp', 'voice-samples');
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const voice of voices) {
    for (const [i, text] of lines.entries()) {
      const out = join(outDir, `${voice}-${i + 1}.mp3`);
      const bytes = await synthesiseWithRetry({ engine: 'azure', voice, text, lang: manifest.language });
      writeFileSync(out, bytes);
      n++;
      console.log(`✓ ${voice}: ${text}  →  tmp/voice-samples/${voice}-${i + 1}.mp3`);
      await sleep(throttle('azure'));
    }
  }
  console.log(`\n${n} samples in tmp/voice-samples/. Listen, then: npm run voice:nz`);
  process.exit(0);
}

function collect(course) {
  const manifest = readJSON(course.manifest);
  const lang = manifest.language || course.target;
  const { engine, azure } = voiceConfig(manifest);
  if (!ENGINES.includes(engine)) problems.push(`${course.id}: unknown voice engine "${engine}"`);
  if (engine === 'azure' && !azure) {
    problems.push(`${course.id}: voice engine is azure but "voice.azure" is missing — skipped`);
    return;
  }
  // The text being learned: `japanese` for en-ja, `english` for ja-en.
  const targetField = manifest.fields?.target || 'japanese';
  const rubyField = manifest.fields?.ruby;
  // `speaker`: someone the learner talks to (a scenario line), else the learner's own words.
  const job = (id, category, text, out, speaker = null) =>
    jobs.push({
      id: `${course.id}/${id}`, category, text, lang, out: resolve(OUT_ROOT, out), engine,
      voice: engine === 'azure' && azure ? azureVoice(azure, speaker) : lang,
    });

  // What to synthesise for an item. For Japanese the kana reading is far more
  // reliable than raw kanji: an explicit audioHint wins, else the text with
  // every annotated kanji run swapped for its reading. Kana stays as written,
  // so a katakana loanword carrying a hiragana reading aid ({コーヒー|こーひー})
  // is still spoken from its katakana.
  const KANA_ONLY = /^[぀-ヿー]+$/;
  const spoken = (item) => {
    if (item.audioHint) return item.audioHint;
    const segments = rubyField && toSegments(item[rubyField]);
    if (!segments) return item[targetField];
    return segments.map((seg) => (seg.r && !KANA_ONLY.test(seg.b) ? seg.r : seg.b)).join('');
  };

  for (const entry of manifest.categories) {
    if (ONLY && !ONLY.has(entry.id)) continue;
    const path = resolve(ROOT, entry.file);
    if (!existsSync(path)) {
      problems.push(`missing content file: ${entry.file}`);
      continue;
    }
    const cat = JSON.parse(readFileSync(path, 'utf8'));
    for (const p of cat.phrases || []) {
      if (!p.audio) { problems.push(`${p.id}: no audio path declared`); continue; }
      job(p.id, entry.id, spoken(p), p.audio);
      // A casual phrase's polite counterpart has its own clip.
      if (p.polite?.audio) job(`${p.id}/polite`, entry.id, spoken(p.polite), p.polite.audio);
    }
  }

  // Word and sentence decks: one clip per item, at the item's declared path.
  for (const entry of manifest.decks || []) {
    if (ONLY && !ONLY.has(entry.id)) continue;
    const path = resolve(ROOT, entry.file);
    if (!existsSync(path)) {
      problems.push(`missing deck file: ${entry.file}`);
      continue;
    }
    const deck = JSON.parse(readFileSync(path, 'utf8'));
    for (const item of deck.items || []) {
      if (!item.audio) { problems.push(`${item.id}: no audio path declared`); continue; }
      job(item.id, entry.id, spoken(item), item.audio, item.speaker);
    }
  }

  // Connector lessons: one clip per example sentence. The drills reuse them.
  for (const entry of manifest.lessons || []) {
    if (ONLY && !ONLY.has(entry.id)) continue;
    const path = resolve(ROOT, entry.file);
    if (!existsSync(path)) {
      problems.push(`missing lesson file: ${entry.file}`);
      continue;
    }
    const lesson = JSON.parse(readFileSync(path, 'utf8'));
    for (const ex of lesson.examples || []) {
      if (!ex.audio) { problems.push(`${ex.id}: no audio path declared`); continue; }
      job(ex.id, entry.id, spoken(ex), ex.audio, ex.speaker);
    }
  }

  // Character sets (kana / kanji) use the same declared-path convention as
  // phrases, so they need no special handling beyond reading a different key.
  for (const entry of manifest.characterSets || []) {
    if (ONLY && !ONLY.has(entry.id)) continue;
    const path = resolve(ROOT, entry.file);
    if (!existsSync(path)) {
      problems.push(`missing character set file: ${entry.file}`);
      continue;
    }
    const set = JSON.parse(readFileSync(path, 'utf8'));
    for (const c of set.characters || []) {
      if (!c.audio) { problems.push(`${c.id}: no audio path declared`); continue; }
      // For kanji the hint is the kana reading — synthesising the bare kanji
      // gives whichever reading the engine guesses, which is often the wrong one.
      job(c.id, entry.id, c.audioHint || c.character, c.audio);
    }
  }

  // Scenario NPC lines are content in their own right and aren't present in
  // the category files, so they get their own clips (ASSUMPTIONS A15), in
  // the voice of the people the learner talks to. Player options reuse the
  // referenced phrase's existing clip.
  for (const entry of manifest.scenarios || []) {
    if (ONLY && !ONLY.has(entry.id)) continue;
    const path = resolve(ROOT, entry.file);
    if (!existsSync(path)) {
      problems.push(`missing scenario file: ${entry.file}`);
      continue;
    }
    const scenario = JSON.parse(readFileSync(path, 'utf8'));
    for (const [nodeId, node] of Object.entries(scenario.nodes || {})) {
      if (!node.audio) continue; // narration and learner-language nodes have none
      const text = node.audioHint || node[targetField];
      if (!text) { problems.push(`${entry.id}/${nodeId}: audio declared but no text`); continue; }
      job(`${entry.id}/${nodeId}`, entry.id, text, node.audio, node.speaker || '*');
    }
  }
}

const existing = jobs.filter((j) => existsSync(j.out) && statSync(j.out).size >= MIN_VALID_BYTES);
// Switching voice remakes every clip of the course, whatever else was asked.
const todo = FORCE || SET_ENGINE ? jobs : jobs.filter((j) => !existing.includes(j));

console.log(`Clips: ${jobs.length}  ·  already generated: ${existing.length}  ·  to generate: ${todo.length}`);
for (const course of courses) {
  const { engine, azure } = voiceConfig(readJSON(course.manifest));
  if (engine === 'azure' && !azure) continue;
  const voices = engine === 'azure' ? `${azure.default}, ${typeof azure.speakers === 'string' ? azure.speakers : 'per speaker'}` : 'Google TTS';
  console.log(`  ${course.id}: ${engine} (${voices})`);
}
if (problems.length) {
  console.log('\nContent problems:');
  problems.forEach((p) => console.log(`  ! ${p}`));
}

if (CHECK) {
  const missing = jobs.filter((j) => !existsSync(j.out));
  if (missing.length) {
    console.log(`\n${missing.length} clips missing:`);
    missing.slice(0, 20).forEach((m) => console.log(`  - ${m.id} (${m.category})`));
    if (missing.length > 20) console.log(`  … and ${missing.length - 20} more`);
  } else {
    console.log('\nEvery clip is there. ✅');
  }
  process.exit(missing.length ? 1 : 0);
}

if (!todo.length) {
  console.log('Nothing to do. Use --force to re-synthesise.');
  process.exit(0);
}

// Stop before any work rather than mix voices within a course.
if (todo.some((j) => j.engine === 'azure') && !azureCredentials()) fail(NO_AZURE_KEY);

/* ---------- run ---------- */

let ok = 0;
const failed = [];

for (const [i, job] of todo.entries()) {
  mkdirSync(dirname(job.out), { recursive: true });
  const label = `[${String(i + 1).padStart(3)}/${todo.length}] ${job.id}`;
  try {
    const bytes = await synthesiseWithRetry(job);
    writeFileSync(job.out, bytes);
    ok++;
    console.log(`${label}  ✓  ${job.text}  (${(bytes.length / 1024).toFixed(1)} KB${job.engine === 'azure' ? `, ${job.voice}` : ''})`);
  } catch (err) {
    failed.push({ ...job, error: err.message });
    // Mid-switch, the old clip is in the old voice: gone is better than mixed. A plain run makes it.
    if (SET_ENGINE) rmSync(job.out, { force: true });
    console.log(`${label}  ✗  ${job.text}  — ${err.message}`);
  }
  await sleep(throttle(job.engine));
}

console.log(`\nDone. ${ok} generated, ${failed.length} failed.`);
if (failed.length) {
  console.log(SET_ENGINE
    ? `The failed clips were removed: run "npm run audio -- --course ${COURSE}" to make them in the new voice.`
    : FORCE
      ? 'Re-run the same command to remake them all.'
      : 'Re-run the script to retry just the failures:');
  failed.forEach((f) => console.log(`  - ${f.id}: ${f.error}`));
  process.exit(1);
}
