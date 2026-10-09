/**
 * voice-test.mjs — the Azure voice path, run against a stand-in for Azure.
 *
 * Nobody has an Azure key on a fresh checkout, and the real service is the
 * worst place to find out a request was malformed. So this runs the real
 * tools/generate-audio.mjs against a local server that answers like Azure's
 * text-to-speech endpoint, and checks what it was asked:
 *   - the key and output-format headers, and well-formed SSML with the text escaped;
 *   - the learner's lines in the course's default voice, scenario lines in the speakers' voice;
 *   - a rate-limited request (429) waited out and retried, not counted as a failure;
 *   - clips written where asked — a folder in tmp/, never over the real ones;
 *   - `npm run voice:nz` switching the manifest with a targeted edit, and remaking every clip;
 *   - with no key, an Azure run or a switch stopping before it changes anything.
 *
 *   node tools/voice-test.mjs
 */

import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'tmp/voice-test';
const MANIFEST = resolve(ROOT, 'content/en/manifest.json');

let failures = 0;
let checks = 0;
function check(label, ok, detail = '') {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail !== '' ? ` — ${detail}` : ''}`);
}

/* ---------- a stand-in for Azure's text-to-speech endpoint ---------- */

const requests = [];
let rateLimitNext = 0;
const FAKE_MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2000, 0xff)]);
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    requests.push({ url: req.url, method: req.method, headers: req.headers, body });
    if (rateLimitNext > 0) {
      rateLimitNext--;
      res.writeHead(429, { 'retry-after': '1' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.end(FAKE_MP3);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ENDPOINT = `http://127.0.0.1:${server.address().port}/cognitiveservices/v1`;

/** Run the generator; resolves to { code, out }. */
function generate(args, env = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['tools/generate-audio.mjs', ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        AZURE_SPEECH_KEY: 'test-key', AZURE_SPEECH_REGION: 'test-region',
        AZURE_SPEECH_ENDPOINT: ENDPOINT, WAYWORD_AUDIO_OUT: OUT, WAYWORD_AUDIO_THROTTLE_MS: '0',
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('close', (code) => done({ code, out }));
  });
}

/** What a request asked for: its voice, language and text, if the SSML is well formed. */
function parsed(r) {
  const m = r.body.match(/^<speak version="1\.0" xml:lang="([a-z]{2}-[A-Z]{2})"><voice name="([\w-]+)">([^<]*)<\/voice><\/speak>$/);
  if (!m) return null;
  const raw = m[3];
  const clean = !/[<>"']|&(?!(?:lt|gt|amp|apos|quot);)/.test(raw);
  const text = raw.replace(/&(lt|gt|amp|apos|quot);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' })[e]);
  return { lang: m[1], voice: m[2], text, clean };
}

const headersOk = (r) => r.method === 'POST' && r.headers['ocp-apim-subscription-key'] === 'test-key' &&
  r.headers['content-type'] === 'application/ssml+xml' && r.headers['x-microsoft-outputformat'] === 'audio-24khz-48kbitrate-mono-mp3';

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const { default: LEARNER, speakers: OTHERS } = manifest.voice.azure;
const realClip = resolve(ROOT, 'audio/en/words/w-menu.mp3');
const realBefore = statSync(realClip).mtimeMs;
const manifestBefore = readFileSync(MANIFEST, 'utf8');
rmSync(resolve(ROOT, OUT), { recursive: true, force: true });

try {
  console.log('\n1. Sample clips, to listen to before switching (npm run voice:samples)');
  rateLimitNext = 1;
  const samples = await generate(['--course', 'ja-en', '--samples']);
  const sampleDir = resolve(ROOT, OUT, 'tmp/voice-samples');
  const sampleFiles = existsSync(sampleDir) ? readdirSync(sampleDir) : [];
  const asked = requests.filter((r) => r.headers['ocp-apim-subscription-key']);
  check('six samples: three lines in each of the two voices', samples.code === 0 && sampleFiles.length === 6,
    `${sampleFiles.length} files, exit ${samples.code}`);
  check('the first request was rate-limited, waited out and retried', asked.length === 7, `${asked.length} requests`);
  check('every request carries the key and asks for mp3', asked.every(headersOk));
  const sampleLines = asked.map(parsed);
  check('every request is well-formed SSML in New Zealand English, its text escaped',
    sampleLines.every((p) => p && p.clean && p.lang === 'en-NZ'), sampleLines.find((p) => !p?.clean)?.text);
  check('the samples use both voices', new Set(sampleLines.map((p) => p?.voice)).size === 2 &&
    sampleLines.some((p) => p?.voice === LEARNER) && sampleLines.some((p) => p?.voice === OTHERS));

  console.log('\n2. One run in Azure without switching the course (--engine azure)');
  requests.length = 0;
  const run = await generate(['--course', 'ja-en', '--engine', 'azure', '--only', 'cafe,words-cafe', '--force']);
  const lines = requests.map(parsed);
  const words = JSON.parse(readFileSync(resolve(ROOT, 'content/en/words/cafe.json'), 'utf8')).items;
  const scene = JSON.parse(readFileSync(resolve(ROOT, 'content/en/scenarios/cafe.json'), 'utf8'));
  const npcLines = Object.values(scene.nodes).filter((n) => n.audio);
  check('every clip asked for, and written', run.code === 0 && requests.length === words.length + npcLines.length &&
    [...words, ...npcLines].every((x) => existsSync(resolve(ROOT, OUT, x.audio))), `${requests.length} requests, exit ${run.code}`);
  check('the learner\'s words are in the default voice', words.every((w) => lines.some((p) => p?.voice === LEARNER && p.text === w.english)));
  check('the barista speaks in the other voice', npcLines.every((n) => lines.some((p) => p?.voice === OTHERS && p.text === (n.audioHint || n.english))));
  check('the real clips are untouched', statSync(realClip).mtimeMs === realBefore);
  check('…and so is the manifest', readFileSync(MANIFEST, 'utf8') === manifestBefore);

  console.log('\n3. No key: nothing happens');
  requests.length = 0;
  const noKey = await generate(['--course', 'ja-en', '--engine', 'azure', '--only', 'words-cafe', '--force'], { AZURE_SPEECH_KEY: '' });
  check('an Azure run stops before any request, and says how to get a key',
    noKey.code === 1 && requests.length === 0 && noKey.out.includes('No Azure Speech key') && noKey.out.includes('setx AZURE_SPEECH_KEY'));
  const noKeySwitch = await generate(['--course', 'ja-en', '--set-engine', 'azure'], { AZURE_SPEECH_KEY: '' });
  check('a switch stops too, leaving the manifest as it was',
    noKeySwitch.code === 1 && requests.length === 0 && readFileSync(MANIFEST, 'utf8') === manifestBefore);
  const samplesNoKey = await generate(['--course', 'ja-en', '--samples'], { AZURE_SPEECH_KEY: '' });
  check('…and so do the samples', samplesNoKey.code === 1 && requests.length === 0);

  console.log('\n4. The switch itself (npm run voice:nz)');
  requests.length = 0;
  const switched = await generate(['--course', 'ja-en', '--set-engine', 'azure']);
  const after = readFileSync(MANIFEST, 'utf8');
  const total = Number(switched.out.match(/Clips: (\d+)/)?.[1]);
  check('the manifest now says azure — one word changed, its layout kept',
    switched.code === 0 && JSON.parse(after).voice.engine === 'azure' &&
    after === manifestBefore.replace(/("engine"\s*:\s*")google(")/, '$1azure$2'));
  check('every clip of the course was remade in Azure, none skipped', total > 200 && requests.length === total,
    `${requests.length} of ${total}`);
  check('…every line well-formed, apostrophes and all (I&apos;d like…)',
    requests.map(parsed).every((p) => p?.clean) && requests.some((r) => r.body.includes('I&apos;d like')));
  const theirLines = manifest.scenarios.flatMap((s) => Object.values(JSON.parse(readFileSync(resolve(ROOT, s.file), 'utf8')).nodes))
    .filter((n) => n.audio).length +
    (manifest.listening || []).filter((l) => l.kind === 'replies')
      .reduce((n, l) => n + JSON.parse(readFileSync(resolve(ROOT, l.file), 'utf8')).items.length, 0);
  check('the course\'s other voice is only used for the people the learner talks to — scenario lines and what\'s said back',
    requests.map(parsed).filter((p) => p?.voice === OTHERS).length === theirLines, `${theirLines} lines`);
} finally {
  writeFileSync(MANIFEST, manifestBefore);
  server.close();
  rmSync(resolve(ROOT, OUT), { recursive: true, force: true });
}
check('the real manifest is back as it was', readFileSync(MANIFEST, 'utf8') === manifestBefore);

console.log(failures ? `\n✗ ${failures} of ${checks} voice checks failed\n` : `\n✓ all ${checks} voice checks passed\n`);
process.exit(failures ? 1 : 0);
