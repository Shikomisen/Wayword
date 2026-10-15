/**
 * make-dictionary.mjs — builds the Japanese course's offline dictionary
 * (content/ja/dictionary.json) from JMdict (README §6.14).
 *
 * The source is jmdict-simplified's "jmdict-eng-common" release: JMdict's
 * common words with English glosses, as JSON, rebuilt every week from the
 * Electronic Dictionary Research and Development Group's files. This keeps
 * what the app's lookups need — every spelling, every reading, the word's
 * class, and its first few senses — in a compact form, one entry per line so
 * a refresh diffs readably.
 *
 * JMdict is licensed CC BY-SA 4.0. The output carries the credit and the
 * licence, and stays under that licence. The EDRDG licence also asks for
 * regular updates: re-run this every month or so, then release.
 *
 *   npm run dictionary                       # the latest release
 *   node tools/make-dictionary.mjs --from <jmdict-eng-common.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'content/ja/dictionary.json';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

// How much of each entry the app shows: enough to choose a meaning, small enough to download with the course.
const MAX_SENSES = 4;
const MAX_GLOSSES = 4;

// The word classes the app uses: to recognise inflected verbs and adjectives
// (js/dictionary.js), and to say what kind of word it is. Transitivity
// (vt, vi) and the rest are left out.
const KEEP_POS = new Set([
  'v1', 'v1-s', 'v5aru', 'v5b', 'v5g', 'v5k', 'v5k-s', 'v5m', 'v5n', 'v5r', 'v5r-i', 'v5s', 'v5t', 'v5u', 'v5u-s',
  'vk', 'vs', 'vs-i', 'vs-s', 'vs-c', 'vz', 'adj-i', 'adj-ix', 'adj-na', 'adj-no', 'adj-pn', 'adj-t', 'adj-f',
  'adv', 'adv-to', 'n', 'n-suf', 'n-pref', 'pn', 'prt', 'conj', 'int', 'exp', 'ctr', 'num', 'pref', 'suf',
  'aux', 'aux-v', 'aux-adj', 'cop', 'unc',
]);

/** The one JSON file inside a .tgz (a gzipped tar: 512-byte headers, the size in octal). */
function jsonFromTgz(tgz) {
  const tar = gunzipSync(tgz);
  for (let at = 0; at + 512 <= tar.length;) {
    const name = tar.subarray(at, at + 100).toString('utf8').replace(/\0[\s\S]*$/, '');
    if (!name) break;
    const size = parseInt(tar.subarray(at + 124, at + 136).toString('utf8').replace(/\0[\s\S]*$/, '').trim(), 8);
    if (name.endsWith('.json')) return JSON.parse(tar.subarray(at + 512, at + 512 + size).toString('utf8'));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('no JSON file in the archive');
}

async function latestRelease() {
  const headers = { 'user-agent': 'wayword-make-dictionary' };
  const release = await (await fetch('https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest', { headers })).json();
  const asset = release.assets?.find((a) => /^jmdict-eng-common-.*\.json\.tgz$/.test(a.name));
  if (!asset) throw new Error(`no jmdict-eng-common asset in release ${release.tag_name}`);
  console.log(`jmdict-simplified ${release.tag_name}: ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)`);
  const tgz = Buffer.from(await (await fetch(asset.browser_download_url, { headers })).arrayBuffer());
  return { tag: release.tag_name, data: jsonFromTgz(tgz) };
}

const from = arg('--from');
const { tag, data } = from
  ? { tag: `local file ${from}`, data: JSON.parse(readFileSync(resolve(from), 'utf8')) }
  : await latestRelease();
if (!data.commonOnly || !data.languages?.includes('eng')) throw new Error('expected jmdict-eng-common (common words, English)');

/** Common spellings first, search-only ones last; order kept otherwise. */
const ordered = (forms) => [...forms]
  .map((f, i) => ({ f, i, rank: f.tags?.includes('sK') || f.tags?.includes('sk') ? 2 : f.common ? 0 : 1 }))
  .sort((a, b) => a.rank - b.rank || a.i - b.i)
  .map(({ f }) => f.text);

const clean = (s) => s.replace(/\|/g, '/').trim();

const entries = [];
for (const word of data.words) {
  const kanji = ordered(word.kanji || []);
  const kana = ordered(word.kana || []);
  const senses = word.sense.filter((s) => s.gloss.some((g) => g.lang === 'eng'));
  if (!kana.length || !senses.length) continue;
  const pos = [...new Set(senses.flatMap((s) => s.partOfSpeech).filter((p) => KEEP_POS.has(p)))];
  // "Usually written using kana alone": shown in kana, like ありがとう rather than 有難う. So is a word
  // whose kanji are all uncommon while its kana is common: the particle の, not 乃.
  const kanaUsually = senses[0].misc?.includes('uk') ||
    ((word.kanji || []).length > 0 && !word.kanji.some((k) => k.common) && word.kana.some((k) => k.common));
  if (kanaUsually) pos.push('uk');
  const glosses = senses.slice(0, MAX_SENSES)
    .map((s) => s.gloss.filter((g) => g.lang === 'eng').slice(0, MAX_GLOSSES).map((g) => clean(g.text)).join('; '));
  entries.push([kanji.join('|'), kana.join('|'), pos.join(' '), glosses.join('|')]);
}

const header = {
  schemaVersion: 1,
  kind: 'jmdict',
  language: 'ja',
  meaningLanguage: 'en',
  source: 'JMdict: common words, English glosses (jmdict-simplified, jmdict-eng-common)',
  sourceVersion: tag,
  dictDate: data.dictDate,
  // The acknowledgement the EDRDG licence asks for (its sample wording, for
  // this app). The course manifest's "dictionary" entry repeats these fields
  // for the screens that show it; npm test holds the two to the same values.
  name: 'JMdict',
  owner: 'EDRDG',
  ownerUrl: 'https://www.edrdg.org/',
  url: 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
  licence: 'CC BY-SA 4.0',
  licenceUrl: 'https://www.edrdg.org/edrdg/licence.html',
  credit: 'This app uses the JMdict dictionary files. These files are the property of the Electronic Dictionary Research and Development Group, and are used in conformance with the Group\'s licence.',
  fields: ['kanji', 'kana', 'pos', 'senses'],
  note: 'Each entry: kanji spellings, kana readings and senses are |-separated (most common first); pos is space-separated JMdict word-class codes, plus "uk" for words usually written in kana. Built by tools/make-dictionary.mjs.',
};

// One entry per line, so a monthly refresh shows up as a readable diff.
const body = JSON.stringify(header, null, 2).replace(/\n}$/, ',\n  "entries": [\n');
const text = `${body}${entries.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]\n}\n`;
JSON.parse(text); // it must still be one valid JSON file
writeFileSync(resolve(ROOT, OUT), text);
console.log(`${OUT}: ${entries.length} entries, ${(Buffer.byteLength(text) / 1048576).toFixed(2)} MB (JMdict of ${data.dictDate})`);
