/**
 * make-translator.mjs — the offline translator's files (README §6.15).
 *
 * Downloads Mozilla's Bergamot translation engine (WebAssembly) and the
 * Firefox Translations models for every language pair the available courses
 * need, both directions, from the same Remote Settings collections Firefox
 * uses. Checks every file against Mozilla's sha256, writes them under mt/,
 * and records them in mt/translator.json. The app then serves them itself:
 * nothing is fetched from Mozilla at runtime.
 *
 * Last of all it loads the engine in Node and translates a sentence each way,
 * so a set that doesn't work together is never written as finished.
 *
 *   node tools/make-translator.mjs           # fetch what's missing or changed
 *   node tools/make-translator.mjs --check   # report what would change; write nothing
 *
 * The engine's JavaScript loader isn't in Remote Settings: it ships with
 * Firefox's source, at the revision named in LOADER below, and must match the
 * engine. Both are MPL-2.0, like the models (mt/LICENSE).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translatorSmokeTest } from './translator-node.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SETTINGS = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections';
const ATTACHMENTS = 'https://firefox-settings-attachments.cdn.mozilla.net/';
const ENGINE = { name: 'bergamot-translator', version: '3.0' };
const LOADER = {
  url: 'https://raw.githubusercontent.com/mozilla-firefox/firefox/main/toolkit/components/translations/bergamot-translator/bergamot-translator.js',
  licence: 'https://raw.githubusercontent.com/mozilla-firefox/firefox/main/toolkit/components/translations/bergamot-translator/LICENSE',
};

const readJSON = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const versionKey = (v) => String(v).split(/[.a-z]+/i).map(Number);
const newer = (a, b) => {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return !/a\d*$/.test(a) && /a\d*$/.test(b); // a release beats its alpha
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function getBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// The pairs: each available course's speaker → target, and back.
const courses = readJSON('content/courses.json').courses.filter((c) => c.manifest);
const wanted = [...new Set(courses.flatMap((c) => [`${c.speaker}-${c.target}`, `${c.target}-${c.speaker}`]))].sort();

const models = (await getJSON(`${SETTINGS}/translations-models/records`)).data;
const wasms = (await getJSON(`${SETTINGS}/translations-wasm/records`)).data;

const previous = existsSync(resolve(ROOT, 'mt/translator.json')) ? readJSON('mt/translator.json') : null;
const plan = []; // { path, url, sha256, size }
const pairs = {};

for (const pair of wanted) {
  const [from, to] = pair.split('-');
  const records = models.filter((r) => r.fromLang === from && r.toLang === to);
  if (!records.length) { console.log(`  ${pair}: no model from Mozilla — the translator won't offer this direction`); continue; }
  // The newest version; its files are the same format on every platform.
  const version = records.map((r) => r.version).reduce((a, b) => (newer(b, a) ? b : a));
  const files = {};
  for (const r of records.filter((x) => x.version === version)) {
    const path = `mt/${pair}/${r.name}`;
    files[r.fileType] = { path, size: r.attachment.size, sha256: r.attachment.hash };
    plan.push({ path, url: ATTACHMENTS + r.attachment.location, sha256: r.attachment.hash, size: r.attachment.size });
  }
  if (!files.model || !files.lex || !(files.vocab || (files.srcvocab && files.trgvocab))) throw new Error(`${pair} ${version}: incomplete (${Object.keys(files)})`);
  pairs[pair] = { version, files };
}

const engineRecord = wasms.filter((r) => r.name === ENGINE.name && r.version === ENGINE.version)[0];
if (!engineRecord) throw new Error(`no ${ENGINE.name} ${ENGINE.version} in translations-wasm`);
const wasm = { path: 'mt/bergamot-translator.wasm', size: engineRecord.attachment.size, sha256: engineRecord.attachment.hash };
plan.push({ ...wasm, url: ATTACHMENTS + engineRecord.attachment.location });

// The loader and the licence come from Firefox's source; they have no published hash to check against.
const loaderText = await getBytes(LOADER.url);
const licenceText = await getBytes(LOADER.licence);
const loaderVersion = /BERGAMOT_VERSION_FULL = "([^"]+)"/.exec(loaderText.toString('utf8'))?.[1];
if (!loaderVersion) throw new Error('the loader has no BERGAMOT_VERSION_FULL');
const loader = { path: 'mt/bergamot-translator.js', size: loaderText.length, sha256: sha256(loaderText) };

const changed = plan.filter((f) => !existsSync(resolve(ROOT, f.path)) || sha256(readFileSync(resolve(ROOT, f.path))) !== f.sha256);
const loaderChanged = !existsSync(resolve(ROOT, loader.path)) || sha256(readFileSync(resolve(ROOT, loader.path))) !== loader.sha256;
const total = plan.reduce((n, f) => n + f.size, 0) + loader.size;
console.log(`Pairs: ${Object.entries(pairs).map(([p, x]) => `${p} ${x.version}`).join(', ')}; engine ${ENGINE.version} (loader ${loaderVersion}); ${(total / 1e6).toFixed(1)} MB in all`);
console.log(`${changed.length + (loaderChanged ? 1 : 0)} file(s) new or changed`);
if (CHECK) { console.log('--check: nothing written.'); process.exit(0); }

for (const f of changed) {
  const bytes = await getBytes(f.url);
  if (sha256(bytes) !== f.sha256) throw new Error(`${f.path}: checksum mismatch`);
  mkdirSync(dirname(resolve(ROOT, f.path)), { recursive: true });
  writeFileSync(resolve(ROOT, f.path), bytes);
  console.log(`  ${f.path} ${(f.size / 1e6).toFixed(1)} MB ✓`);
}
mkdirSync(resolve(ROOT, 'mt'), { recursive: true });
if (loaderChanged) writeFileSync(resolve(ROOT, loader.path), loaderText);
writeFileSync(resolve(ROOT, 'mt/LICENSE'), licenceText);

const registry = {
  schemaVersion: 1,
  name: 'Firefox Translations',
  credit: 'Offline translation by Mozilla’s Bergamot engine and Firefox Translations models.',
  licence: 'MPL-2.0',
  licenceFile: 'mt/LICENSE',
  source: 'https://github.com/mozilla/translations',
  madeAt: previous && !changed.length && !loaderChanged ? previous.madeAt : new Date().toISOString().slice(0, 10),
  engine: { version: ENGINE.version, loaderVersion, loader, wasm },
  pairs,
};

// Translate a sentence each way with exactly these files before calling them done.
const results = await translatorSmokeTest(ROOT, registry);
for (const r of results) console.log(`  ${r.pair}: “${r.text}” → “${r.out}” (${r.ms} ms)`);

writeFileSync(resolve(ROOT, 'mt/translator.json'), `${JSON.stringify(registry, null, 2)}\n`);
console.log('Wrote mt/translator.json');
