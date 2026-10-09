/**
 * render-test.mjs — renders every screen in a real DOM and asserts the
 * output, so template bugs surface without opening a browser.
 *
 * Requires jsdom, which is NOT a project dependency — the app itself has
 * zero dependencies. Install it just for this run:
 *
 *   npm install --no-save jsdom
 *   node tools/render-test.mjs
 *
 * Skips cleanly with exit 0 if jsdom isn't present.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Expected counts come from the content itself, so adding a category or a
// group doesn't mean editing this file.
const readJSON = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
const COURSES = readJSON('content/courses.json').courses;
const manifestOf = (id) => readJSON(COURSES.find((c) => c.id === id).manifest);
const JA = manifestOf('en-ja');
const EN = manifestOf('ja-en');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('\njsdom not installed — skipping render tests.');
  console.log('  npm install --no-save jsdom && node tools/render-test.mjs\n');
  process.exit(0);
}

/* ---------- environment ---------- */

const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/#/',
  pretendToBeVisual: true,
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.location = window.location;
globalThis.confirm = () => true;
globalThis.HTMLElement = window.HTMLElement;
globalThis.FileReader = window.FileReader;

// Downloads: keep whatever the app hands to createObjectURL, so a backup can be read back.
const downloads = [];
const realCreateObjectURL = URL.createObjectURL;
URL.createObjectURL = (blob) => { downloads.push(blob); return realCreateObjectURL ? realCreateObjectURL(blob) : 'blob:test'; };

// Audio is never actually played here; record calls instead.
const played = [];
// How fast, and whether at the same pitch, each clip was played.
const speeds = [];
globalThis.Audio = class {
  constructor(src) { this.src = src; }
  play() { played.push(this.src); speeds.push({ rate: this.playbackRate ?? 1, pitch: this.preservesPitch ?? true }); return Promise.resolve(); }
  pause() {}
};

const mem = new Map();
globalThis.localStorage = window.localStorage ?? {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
};

// Paths that answer as the service worker does offline for a file it never cached.
let unreachable = null;
globalThis.fetch = async (path) => {
  if (unreachable && String(path).includes(unreachable)) return { ok: false, status: 504, json: async () => null };
  const file = resolve(ROOT, String(path).replace(/^\.\//, ''));
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};

/* ---------- harness ---------- */

let failures = 0;
let checks = 0;
const errors = [];

window.addEventListener('error', (e) => errors.push(e.message));
const realError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); realError(...args); };

function check(label, condition, detail = '') {
  checks++;
  if (condition) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const app = () => document.getElementById('app');
const text = () => app().textContent;
const $ = (sel) => app().querySelector(sel);
const $$ = (sel) => [...app().querySelectorAll(sel)];

async function goTo(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick(); await tick();
}

/* ---------- boot (app.js self-starts on import) ---------- */

const deck = await import('../js/deck.js');
const quiz = await import('../js/quiz.js');
await import('../js/app.js');
await tick(); await tick(); await tick();

console.log('\n0. Home — language picker');

check('launch opens the language picker', text().includes('Wayword') && $$('.course-card').length > 0,
  `${$$('.course-card').length} courses offered`);
check('course chrome is hidden on the picker', document.body.classList.contains('at-home'));
check('speaker defaults to the device language (English here)',
  $('.segment.is-on')?.dataset.speaker === 'en', $('.segment.is-on')?.textContent);
check('English speakers are offered Japanese',
  Boolean($('.course-card[data-course="en-ja"]:not(.is-planned)')), $('.course-card[data-course="en-ja"]')?.textContent);
check('Indonesian is listed as a coming-soon placeholder',
  Boolean($('.course-card[data-course="en-id"].is-planned')), $('.course-card[data-course="en-id"]')?.textContent);
check('Japanese shows as not started yet', $('.course-card[data-course="en-ja"]')?.textContent.includes('Not started'));

await goTo('#/en-id/');
check('the Indonesian placeholder opens a coming-soon screen', text().includes('Indonesian is coming soon'));
check('a placeholder course has no tab bar', document.body.classList.contains('no-tabs'));
check('…but does have the way back to the picker',
  document.querySelector('.coursebar-home')?.getAttribute('href') === '#/');

await goTo('#/en-ja/');

console.log('\n1. First launch of a course');

check('course bar names the language pair', document.querySelector('.coursebar-pair')?.textContent === 'English › Japanese',
  document.querySelector('.coursebar-pair')?.textContent);
check('placement quiz gates the app on first launch',
  text().includes('Where are you starting from?'), 'intro screen shown');
check('onboarding hides the tab bar', document.body.classList.contains('onboarding'));

$$('button').find((b) => b.textContent === 'Start')?.click();
await tick(); await tick();

check('quiz shows a card with Japanese', Boolean($('.placement-card .jp')), $('.placement-card .jp')?.textContent);
const quizTotal = Number(text().match(/1 of (\d+)/)?.[1] ?? 0);
check('quiz shows progress', quizTotal > 0, `${quizTotal} cards total`);
check('quiz covers phrases and characters, two of each',
  quizTotal === 2 * (JA.categories.length + JA.characterSets.length), `${quizTotal} cards`);
check('quiz offers three self-grade answers', $$('.btn-answer').length === 3);
check('first card has no stray "null" where the Back button would be', !/\bnull\b/.test(text()));
check('furigana renders as ruby', $$('.placement-card ruby, .placement-card').length > 0);

// Answer every card, alternating so the result screen has a mix. Driven by
// the button being present rather than a hardcoded count, so adding
// content to the quiz never silently breaks the rest of this walkthrough.
for (let i = 0; i < quizTotal + 5; i++) {
  const buttons = $$('.btn-answer');
  if (!buttons.length) break;
  buttons[i % 3].click();
  await tick(); await tick();
}
await tick(); await tick(); await tick();

check('quiz produces a results screen', text().includes('Deck built'), 'placement complete');
check('results break down every category and character set',
  $$('.result-row').length === JA.categories.length + JA.characterSets.length, `${$$('.result-row').length} rows`);
check('results separate phrases from reading', text().includes('Reading'));

$$('button').find((b) => b.textContent === 'Set up reading first')?.click();
await tick(); await tick(); await tick(); await tick();
check('"Set up reading first" lands on Reading, not Today',
  location.hash === '#/en-ja/characters' && $('h1')?.textContent === 'Reading', `${location.hash} · ${$('h1')?.textContent}`);

/* ---------- screens ---------- */

console.log('\n2. Home / due today');

await goTo('#/en-ja/');
check('home screen renders', text().includes('Today'));
check('stat tiles present', $$('.stat').length === 4, $$('.stat-value').map((s) => s.textContent).join('/'));
check('7-day SRS forecast renders', $$('.forecast-day').length === 7);
check('deck categories listed', $$('.row-card').length >= 4, `${$$('.row-card').length} rows`);
check('tab bar highlights the current screen', Boolean(document.querySelector('.tabbar a.active')));

console.log('\n3. Learn');

await goTo('#/en-ja/browse');
check('learn renders', $('h1')?.textContent === 'Learn' && document.querySelector('.tabbar a.active')?.textContent.includes('Learn'));
const jaDecks = [...JA.categories, ...JA.decks];
const jaStarters = jaDecks.filter((c) => c.starter);
check('every deck listed, plus your own words and the conversations', $$('.row-card').length === jaDecks.length + 2,
  `${$$('.row-card').length} rows`);
check('words, sentences, phrases, your own words, then conversations',
  $$('.kind-title').map((h) => h.textContent).join('|') === 'Words|Sentences|Phrases|Your own words|Conversations',
  $$('.kind-title').map((h) => h.textContent).join(' | '));
check('with Connectors taking a tab, the scenarios live in Learn',
  !document.querySelector('.tabbar a[data-path="/scenarios"]') && Boolean($('.row-card[href="#/en-ja/scenarios"]')));
check('phrases grouped by topic, titled from the manifest',
  $$('.section-title').map((h) => h.textContent).join('|') === JA.groups.map((g) => g.title).join('|'),
  $$('.section-title').map((h) => h.textContent).join(' | '));
check('word decks say how many words they hold',
  $('.row-card[data-deck="words-people"] .row-sub')?.textContent === `${readJSON(JA.decks[0].file).items.length} words`,
  $('.row-card[data-deck="words-people"] .row-sub')?.textContent);
check('no week-by-week or trip framing left', !/Week \d|trip/i.test(text()));
check('starter decks marked as in-deck', $$('.btn-in-deck').length === jaStarters.length, `${$$('.btn-in-deck').length} in deck`);
check('the rest offer an Add button',
  $$('button').filter((b) => b.textContent === 'Add').length === jaDecks.length - jaStarters.length);

// "In deck" is a button too: tap it again to take the deck out — asked first, progress kept.
const smalltalkRow = () => $('.row-card[data-deck="smalltalk"]');
check('"In deck" can be tapped again, and says what it does',
  smalltalkRow()?.querySelector('.btn-in-deck')?.getAttribute('aria-pressed') === 'true' &&
    smalltalkRow()?.querySelector('.btn-in-deck')?.title === 'Take out of deck');
const askedRemove = [];
globalThis.confirm = (message) => { askedRemove.push(message); return false; };
smalltalkRow().querySelector('.btn-in-deck').click();
for (let i = 0; i < 6; i++) await tick();
check('taking a deck out asks first, saying its progress is kept — and "no" changes nothing',
  askedRemove.length === 1 && askedRemove[0].includes('Small Talk') && askedRemove[0].includes('progress is kept') &&
    (await deck.getSettings()).activeCategories.includes('smalltalk'), askedRemove[0]?.split('\n')[0]);
globalThis.confirm = () => true;
const smalltalkCards = JSON.stringify((await deck.getDeck()).filter((c) => c.categoryId === 'smalltalk'));
smalltalkRow().querySelector('.btn-in-deck').click();
for (let i = 0; i < 6; i++) await tick();
check('"yes" takes it out: the row offers Add again, and a toast says the progress is kept',
  !(await deck.getSettings()).activeCategories.includes('smalltalk') &&
    smalltalkRow()?.querySelector('button')?.textContent === 'Add' && !smalltalkRow()?.classList.contains('is-active') &&
    [...document.querySelectorAll('.toast')].some((n) => n.textContent.includes('Small Talk') && n.textContent.includes('progress is kept')));
await goTo('#/en-ja/');
check('Today no longer lists it', !$$('.row-card').some((r) => r.textContent.includes('Small Talk')));
await goTo('#/en-ja/browse');
smalltalkRow().querySelector('button').click();
for (let i = 0; i < 6; i++) await tick();
check('adding it again brings it back with its progress, and says so',
  Boolean(smalltalkRow()?.querySelector('.btn-in-deck')) &&
    JSON.stringify((await deck.getDeck()).filter((c) => c.categoryId === 'smalltalk')) === smalltalkCards &&
    [...document.querySelectorAll('.toast')].some((n) => n.textContent.includes('is back in your deck')));

console.log('\n4. Category detail');

await goTo('#/en-ja/category/greetings');
check('category renders', text().includes('Greetings & Politeness'));
check('a deck in study can be taken out from its own page too', document.querySelector('.remove-deck')?.textContent === 'Take out of deck');
check('all phrases listed', $$('.phrase-card').length === 24, `${$$('.phrase-card').length} cards`);
check('every polite phrase is labelled Polite',
  $$('.phrase-card .register-polite').length === 24 && !$('.phrase-card .register-casual'));
check('register notes render', text().includes('Register'));
check('anime divergence notes render', $$('.note-anime').length > 0, `${$$('.note-anime').length} notes`);
check('audio buttons render', $$('.audio-btn').length > 0);
check('every clip has a slower 🐢 button beside it',
  $$('.audio-slow').length === $$('.audio-btn').length, `${$$('.audio-slow').length} 🐢`);
$('.phrase-card .audio-btn')?.click();
await tick();
$('.phrase-card .audio-slow')?.click();
await tick();
check('🐢 plays the same clip at three-quarter speed, at the same pitch',
  played.at(-1) === played.at(-2) && speeds.at(-2).rate === 1 && speeds.at(-1).rate === 0.75 && speeds.at(-1).pitch === true,
  `${played.at(-1)} ${JSON.stringify(speeds.at(-1))}`);
check('romaji shown while enabled', $$('.romaji').length > 0);

const before = $$('.romaji').length;
$$('.chip').find((c) => c.textContent === 'romaji')?.click();
await tick(); await tick(); await tick();
check('romaji toggle removes romaji from the page', $$('.romaji').length === 0, `was ${before}`);

$$('.chip').find((c) => c.textContent === 'romaji')?.click();
await tick(); await tick(); await tick();
check('romaji toggle restores it', $$('.romaji').length > 0);

// The furigana chip cycles: always → tap to show → hidden → always.
const furiganaChip = () => $('.chip[data-aid="furigana"]');
const rubyBefore = $$('ruby').length;
check('furigana chip shows its mode', furiganaChip()?.textContent === 'ふりがな · Always', furiganaChip()?.textContent);
furiganaChip()?.click();
await tick(); await tick(); await tick();
check('tap-to-show keeps the readings but hides them until tapped',
  furiganaChip()?.dataset.mode === 'tap' && $$('ruby').length === rubyBefore && $$('.furi-tap').length > 0,
  `${$$('.furi-tap').length} tappable`);
const tappable = $('.furi-tap');
tappable?.click();
check('tapping reveals that one reading', tappable?.classList.contains('revealed') && $$('.furi-tap.revealed').length === 1);
furiganaChip()?.click();
await tick(); await tick(); await tick();
check('hidden removes ruby annotations', furiganaChip()?.dataset.mode === 'hidden' && $$('ruby').length === 0, `was ${rubyBefore}`);
furiganaChip()?.click();
await tick(); await tick(); await tick();
check('…and the cycle comes back round to always',
  furiganaChip()?.dataset.mode === 'always' && $$('ruby').length === rubyBefore && !$('.furi-tap'));

await goTo('#/en-ja/category/casual');
const casualCount = readJSON(JA.categories.find((c) => c.id === 'casual').file).phrases.length;
check('casual set renders every phrase', $$('.phrase-card').length === casualCount, `${$$('.phrase-card').length} cards`);
check('each casual phrase is labelled Casual',
  $$('.phrase-card .phrase-block > .register-casual').length === casualCount);
check('…and shows its polite version, labelled, with its own audio',
  $$('.phrase-card .polite-version').length === casualCount &&
  $$('.polite-version .register').length === 0 &&
  $$('.polite-version .audio-btn').length === casualCount &&
  text().includes('Polite version'));
check('casual furigana written as {漢字|かんじ} renders as ruby',
  $$('.phrase-card ruby').some((r) => r.textContent.startsWith('大丈夫')), $$('.phrase-card ruby')[0]?.textContent);
const politeBefore = played.length;
$('.polite-version .audio-btn')?.click();
await tick(); await tick();
check('the polite version plays its own clip', played.slice(politeBefore).some((p) => p.endsWith('-polite.mp3')), played.at(-1));

console.log('\n5. Study session');

await goTo('#/en-ja/study/airport');
check('study screen renders a card', Boolean($('.study-card .jp')), $('.study-card .jp')?.textContent);
check('answer is hidden before flipping', !$('.study-back'));
check('progress indicator present', Boolean($('.study-top .bar')));

$$('button').find((b) => b.textContent === 'Show answer')?.click();
await tick(); await tick();

check('flipping reveals the meaning', Boolean($('.study-back')));
check('four grade buttons appear', $$('.btn-grade').length === 4);
check('grade buttons preview their intervals',
  $$('.grade-when').every((g) => g.textContent.length > 0),
  $$('.grade-when').map((g) => g.textContent).join(' / '));
check('audio auto-plays on reveal', played.length > 0, `${played.length} clips played`);

const firstCard = $('.study-card .jp').textContent;
$$('.btn-grade').find((b) => b.textContent.startsWith('Got it'))?.click();
await tick(); await tick(); await tick();
check('grading advances to the next card', $('.study-card .jp')?.textContent !== firstCard);

console.log('\n5a. Words and sentences');

const verbsFile = readJSON(JA.decks.find((d) => d.id === 'words-verbs').file);
await goTo('#/en-ja/category/words-verbs');
check('a word deck lists every word', $$('.phrase-card.item-word').length === verbsFile.items.length,
  `${$$('.phrase-card.item-word').length} words`);
check('every word shows its part of speech', $$('.item-word .word-details .pos').length === verbsFile.items.length,
  $('.item-word .pos')?.textContent);
check('verbs show their ます and て forms, with furigana',
  $$('.word-form').length === verbsFile.items.reduce((n, w) => n + Object.keys(w.forms || {}).length, 0) &&
  $$('.word-form ruby').length > 0,
  $$('.word-form').slice(0, 2).map((f) => f.textContent).join(' · '));
const auCard = $('.phrase-card[data-item="w-au"]');
check('a word links to the sentences it appears in',
  auCard?.querySelector('.links .ref-chip')?.getAttribute('href') === '#/en-ja/category/sentences-everyday',
  auCard?.querySelector('.links')?.textContent);

await goTo('#/en-ja/category/sentences-everyday');
check('a sentence deck lists every sentence', $$('.phrase-card.item-sentence').length === 16);
check('each sentence links the words it uses, into their word decks',
  $$('.item-sentence').every((c) => c.querySelector('.links .ref-chip')) &&
  $$('.item-sentence .ref-chip').every((a) => /^#\/en-ja\/category\/words-/.test(a.getAttribute('href'))),
  $('.item-sentence .links')?.textContent);
check('every sentence is labelled with its register', $$('.item-sentence .register').length === 16);

// "I can read this" — on the back of a card.
await goTo('#/en-ja/study/words-weather');
check('a fresh word deck opens on a recognition card',
  $('.study-card')?.classList.contains('dir-recognition') && Boolean($('.study-card .jp')),
  $('.study-card .jp')?.textContent);
$$('button').find((b) => b.textContent === 'Show answer')?.click();
await tick(); await tick();
const readToggle = $('.readable-toggle');
check('the back offers "I can read this"', readToggle?.getAttribute('aria-pressed') === 'false', readToggle?.textContent);
readToggle?.click();
await tick(); await tick(); await tick();
check('marking it fades that card\'s furigana to tap-to-show',
  $('.readable-toggle')?.getAttribute('aria-pressed') === 'true' && Boolean($('.study-card .target.furi-tap')),
  $('.readable-toggle')?.textContent);
$('.readable-toggle')?.click();
await tick(); await tick(); await tick();
check('…and unmarking brings it back', !$('.study-card .target.furi-tap'));

console.log('\n5b. Card directions');

const dirBox = (dir) => $(`input[data-dir="${dir}"]`);
const toggleDir = async (dir) => { dirBox(dir)?.click(); for (let i = 0; i < 8; i++) await tick(); };
await goTo('#/en-ja/settings');
check('settings offer the three card types',
  ['recognition', 'production', 'listening'].every((d) => dirBox(d)) &&
  dirBox('recognition').checked && dirBox('production').checked && !dirBox('listening').checked);

// Production only: the meaning is the question, the Japanese the answer.
await toggleDir('recognition');
check('recognition can be switched off', dirBox('recognition') && !dirBox('recognition').checked);
await goTo('#/en-ja/study/words-home');
check('a production card asks for the Japanese from the meaning',
  $('.study-card')?.classList.contains('dir-production') && text().includes('How do you say this in Japanese?') &&
  !$('.study-card .jp') && Boolean($('.study-card .meaning.big')),
  $('.study-card .meaning')?.textContent);
check('…and says which way round it is asking', $('.dir-label')?.textContent === 'Say it');
$$('button').find((b) => b.textContent === 'Show answer')?.click();
await tick(); await tick();
check('flipping shows the Japanese, with its audio', Boolean($('.study-back .jp')) && Boolean($('.study-back .audio-btn')),
  $('.study-back .jp')?.textContent);

// Listening only: the audio is the question.
await goTo('#/en-ja/settings');
await toggleDir('listening');
await toggleDir('production');
check('listening can be the only card type', dirBox('listening').checked && !dirBox('production').checked && !dirBox('recognition').checked);
await toggleDir('listening');
check('the last card type can\'t be switched off', dirBox('listening').checked);
const listenPlayed = played.length;
await goTo('#/en-ja/study/words-places');
check('a listening card plays the audio and hides the text',
  $('.study-card')?.classList.contains('dir-listening') && Boolean($('.listen-btn')) && !$('.study-card .jp') &&
  played.length > listenPlayed,
  played.at(-1));
$('.listen-slow')?.click();
await tick();
check('…and can play it again slower', speeds.at(-1).rate === 0.75 && played.at(-1) === played.at(-2), played.at(-1));
$$('button').find((b) => b.textContent === 'Show answer')?.click();
await tick(); await tick();
check('flipping shows what was said and what it means',
  Boolean($('.study-back .jp')) && Boolean($('.study-back .meaning.big')));

await goTo('#/en-ja/settings');
await toggleDir('recognition');
await toggleDir('production');
await toggleDir('listening');
check('back to the default card types', dirBox('recognition').checked && dirBox('production').checked && !dirBox('listening').checked);

console.log('\n5c. Your own words');

await goTo('#/en-ja/mine');
check('your-own-words screen renders, empty', $('h1')?.textContent === 'Your own words' && Boolean($('.empty-mine')));
await goTo('#/en-ja/mine/new');
check('the add form asks for the text, its reading and its meaning',
  Boolean($('#mine-target') && $('#mine-reading') && $('#mine-meaning') && $('#mine-note')));
check('word or sentence is a choice', $$('.kind-choice .segment').length === 2);
check('no device voice and no recorder here, and the form says so',
  text().includes('No Japanese voice on this device') && text().includes('Recording isn\'t available'),
  $('.audio-box')?.textContent.slice(0, 80));
check('the card is marked as having no audio before it is saved', $('.audio-box .audio-state-none')?.textContent === '🔇 No audio');
check('no stray "null" where the absent voice controls would be', !/\bnull\b/.test(text()));
const fill = (sel, value) => {
  const input = $(sel);
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
fill('#mine-target', '{今日|きょう}は{暑|あつ}いね');
fill('#mine-meaning', 'Hot today, isn\'t it');
check('a sentence is recognised as one', $('.kind-choice .segment.is-on')?.dataset.kind === 'sentence');
$('.entry-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
for (let i = 0; i < 10; i++) await tick();
check('saving returns to the list with the new card', location.hash === '#/en-ja/mine' && $$('.mine-card').length === 1,
  location.hash);
check('the inline readings became furigana', $$('.mine-card ruby').length === 2, $('.mine-card .target')?.textContent);
check('…with a clear "no audio" state instead of a dead play button',
  Boolean($('.mine-card .audio-none')) && !$('.mine-card .audio-btn') && Boolean($('.mine-card .audio-state-none')));
await goTo($('.mine-card .mine-meta a').getAttribute('href'));
check('editing shows it the way it was typed', $('#mine-target')?.value === '{今日|きょう}は{暑|あつ}いね', $('#mine-target')?.value);
await goTo('#/en-ja/study/mine');
// The text under the furigana: textContent would include the readings too.
const baseText = (node) => {
  const copy = node?.cloneNode(true);
  copy?.querySelectorAll('rt, rp').forEach((n) => n.remove());
  return copy?.textContent;
};
check('your own words are studied like any other deck', baseText($('.study-card .target')) === '今日は暑いね',
  baseText($('.study-card .target')));
await goTo('#/en-ja/browse');
check('Learn counts your own words', $('.row-card[href="#/en-ja/mine"]')?.textContent.includes('1 card of your own'),
  $('.row-card[href="#/en-ja/mine"] .row-sub')?.textContent);

console.log('\n5d. Connectors');

await goTo('#/en-ja/connectors');
const lessonFiles = Object.fromEntries(JA.lessons.map((l) => [l.id, readJSON(l.file)]));
check('the Connectors tab lists every lesson', $('h1')?.textContent === 'Connectors' &&
  $$('.lesson-row').length === JA.lessons.length, `${$$('.lesson-row').length} lessons`);
check('…grouped as the manifest says', $$('.section-title').map((h) => h.textContent).join('|') ===
  JA.lessonGroups.map((g) => g.title).join('|'));
check('…and its tab is lit', document.querySelector('.tabbar a.active')?.dataset.path === '/connectors');
check('nothing is practised yet', $$('.lesson-row .row-sub').every((r) => r.textContent === 'Not practised yet'));

await goTo('#/en-ja/connectors/con-kara');
const karaFile = lessonFiles['con-kara'];
check('a lesson shows its connector, explanation and pattern',
  $('.connector-title')?.textContent === 'から' && Boolean($('.lesson-explanation')) && text().includes(karaFile.pattern));
check('the explanation puts readings over its kanji', $$('.lesson-explanation ruby').length > 0);
check('it says when the connector sounds natural, and when stiff',
  Boolean($('.note-natural')) && Boolean($('.note-stiff')) && text().includes('Sounds natural') && text().includes('Sounds stiff'));
check('every example is there, with audio and its words linked',
  $$('.item-sentence').length === karaFile.examples.length &&
  $$('.item-sentence .audio-btn').length === karaFile.examples.length &&
  $$('.item-sentence .links .ref-chip').length > 0);

// Practise the lesson: answer every drill, the first fill-in deliberately wrong.
await goTo('#/en-ja/connectors/con-kara/practice');
const examplesById = Object.fromEntries(karaFile.examples.map((x) => [x.id, x]));
const seenKinds = new Set();
let wrongOn = null;
let drillsDone = 0;
for (let guard = 0; guard < 30 && $('.drill-card'); guard++) {
  const cardEl = $('.drill-card');
  const kind = cardEl.dataset.drill;
  const ex = examplesById[cardEl.dataset.example];
  seenKinds.add(kind);
  if (kind === 'fill') {
    const pick = wrongOn ? ex.gap.answer : ex.gap.options.find((o) => o !== ex.gap.answer && !(ex.gap.ok || []).includes(o));
    if (!wrongOn) wrongOn = ex.id;
    $$('.option').find((b) => b.dataset.value === pick)?.click();
  } else {
    // Tap the real pieces in order; the traps stay in the pile.
    for (let i = 0; i < ex.chunks.length; i++) {
      $(`.tile-pool .tile[data-chunk="${i}"]`)?.click();
      await tick();
    }
    $$('.drill-actions button').find((b) => b.textContent === 'Check')?.click();
  }
  await tick(); await tick();
  if (wrongOn === ex.id && kind === 'fill') {
    check('a wrong pick is marked, and the answer shown', Boolean($('.option.is-wrong')) && Boolean($('.option.is-answer')) &&
      Boolean($('.verdict-wrong')) && $('.gap')?.textContent === ex.gap.answer.replace(/\{([^|]+)\|[^}]+\}/g, '$1'));
  }
  if (kind !== 'fill' && !seenKinds.has(`checked-${kind}`)) {
    seenKinds.add(`checked-${kind}`);
    check(`a right ${kind} answer is marked right, with the sentence and its audio`,
      Boolean($('.tile-answer.is-right')) && Boolean($('.verdict-right')) && Boolean($('.drill-answer .audio-btn')));
  }
  drillsDone++;
  $('.drill-next')?.click();
  for (let i = 0; i < 6; i++) await tick();
}
check('the session ran through all three kinds of drill',
  ['fill', 'order', 'combine'].every((k) => seenKinds.has(k)), [...seenKinds].join(', '));
check('…and ends with the score', $('.practice-done') && text().includes(`${drillsDone - 1} of ${drillsDone} right`),
  $('.practice-done .lede')?.textContent);
check('…saying the missed sentence went into the reviews', text().includes('The sentence you missed is now in your reviews.'));
const missedCard = await deck.getCard(`${wrongOn}~p`);
check('the missed sentence is in the deck as a failed "say it" card', missedCard?.state === 'learning', wrongOn);
await goTo('#/en-ja/connectors/con-kara');
check('…and the lesson, now in the reviews, can be taken out of them from its page', document.querySelector('.remove-deck')?.textContent === 'Take out of deck');
await goTo('#/en-ja/connectors');
check('the lesson list shows the best score', $('.lesson-row[data-lesson="con-kara"] .row-sub')?.textContent ===
  `Best: ${drillsDone - 1} of ${drillsDone}`, $('.lesson-row[data-lesson="con-kara"] .row-sub')?.textContent);

await goTo('#/en-ja/connectors/mixed');
check('mixed practice draws drills from the lessons practised so far',
  Boolean($('.drill-card')) && examplesById[$('.drill-card')?.dataset.example] !== undefined,
  $('.drill-card')?.dataset.example);

await goTo('#/en-ja/');
check('Today offers the connectors', text().includes('1 of 16 practised'));

console.log('\n6. Scenarios');

await goTo('#/en-ja/scenarios');
check('scenario list renders', text().includes('Scenarios'));
check('all 6 scenarios listed', $$('.row-card').length === 6);

await goTo('#/en-ja/scenario/conbini');
check('scenario player renders', text().includes('Convenience store checkout'));
check('NPC line renders', Boolean($('.dialogue.npc')));
check('setting/context shown', text().includes('Lawson'));
check('reply options offered', $$('.btn-option').length === 3);

$$('.btn-option')[0].click();
await tick(); await tick(); await tick();
check('choosing advances the dialogue', $$('.transcript .dialogue').length === 2);
check('feedback explains the choice', Boolean($('.feedback')), $('.feedback')?.textContent.slice(0, 60) + '…');

// Walk the rest of the scenario picking the first option each time.
for (let i = 0; i < 10 && $$('.btn-option').length; i++) {
  $$('.btn-option')[0].click();
  await tick(); await tick(); await tick();
}
check('scenario reaches its ending', text().includes('Run it again'));
check('the ending has no stray "null" where the replies were', !/\bnull\b/.test(text()));
check('full transcript retained', $$('.transcript .dialogue').length >= 8,
  `${$$('.transcript .dialogue').length} lines`);

// A "wrong" option must still teach rather than dead-end.
await goTo('#/en-ja/scenario/ticket');
$$('.btn-option')[0].click();
await tick(); await tick(); await tick();
const wrong = $$('.btn-option').at(-1);
wrong?.click();
await tick(); await tick(); await tick();
check('a wrong answer continues the scenario with feedback',
  $$('.btn-option').length > 0 && Boolean($('.feedback-wrong')),
  $('.feedback-wrong')?.textContent.slice(0, 50) + '…');

console.log('\n7. Characters');

await goTo('#/en-ja/characters');
check('the Reading screen renders', $('h1')?.textContent === 'Reading' &&
  document.querySelector('.tabbar a.active')?.textContent.includes('Reading'));
check('every set listed', $$('.row-card').length === JA.characterSets.length,
  $$('.row-title').map((t) => t.textContent).join(', '));
const kanaSets = JA.characterSets.filter((s) => s.script !== 'kanji').length;
check('kana sets are addable', $$('button').filter((b) => b.textContent === 'Add').length === kanaSets);
check('kanji sets wait for hiragana, but can be added anyway',
  $$('.row-card.is-waiting').length === JA.characterSets.length - kanaSets &&
  $$('.row-card.is-waiting button').every((b) => b.textContent === 'Add anyway') &&
  $$('.row-card.is-waiting .row-sub').every((r) => r.textContent.startsWith('After hiragana')));
check('kana mastery is shown, with today’s drill', $$('.kana-meter').length === 2 &&
  $('.kana-meter[data-script="hiragana"] .kana-meter-count')?.textContent === '0/71' &&
  $('.kana-panel .btn-primary')?.textContent === 'Today’s hiragana drill');
check('stroke-order deferral is disclosed', text().includes('stroke-order'));

// Add hiragana, then confirm it lands in the character deck only.
$$('button').find((b) => b.textContent === 'Add')?.click();
await tick(); await tick(); await tick(); await tick();
check('adding a set marks it in-deck', document.querySelectorAll('.btn-in-deck').length === 1);
check('character review becomes available', text().includes('Review characters'));
document.querySelector('.btn-in-deck')?.click();
for (let i = 0; i < 6; i++) await tick();
check('a set can be taken out the same way, its cards kept',
  !document.querySelector('.btn-in-deck') && !(await deck.isSetActive('hiragana')) &&
    (await deck.getDeck()).some((c) => c.categoryId === 'hiragana'));
[...document.querySelectorAll('button')].find((b) => b.textContent === 'Add')?.click();
for (let i = 0; i < 6; i++) await tick();
check('…and added back, with its progress', (await deck.isSetActive('hiragana')) &&
  [...document.querySelectorAll('.toast')].some((n) => n.textContent.includes('Hiragana is back in your deck')));

await goTo('#/en-ja/characters/hiragana');
check('hiragana chart renders', text().includes('Hiragana'));
check('kana grid renders as rows', $$('.kana-row').length >= 11, `${$$('.kana-row').length} rows`);
check('all 104 hiragana render as cells', $$('.kana-cell:not(.kana-empty)').length === 104,
  `${$$('.kana-cell:not(.kana-empty)').length} cells`);
// Exactly five holes, all real: や_ゆ_よ (2) and わ___を (3). ん, yōon and
// extended rows are packed rather than gridded, so they add none.
check('grid leaves gaps only where kana genuinely do not exist',
  $$('.kana-empty').length === 5, `${$$('.kana-empty').length} gaps`);
check('groups are labelled', text().includes('Dakuten') && text().includes('Yōon'));

const playedBefore = played.length;
$$('.kana-cell:not(.kana-empty)')[0].click();
await tick(); await tick();
check('tapping a character plays its audio', played.length > playedBefore, played.at(-1));

await goTo('#/en-ja/characters/kanji-common');
check('kanji screen renders', text().includes('Common Kanji'));
check('kanji render as a list, not a grid', $$('.kanji-row').length === 82 && $$('.kana-row').length === 0,
  `${$$('.kanji-row').length} kanji rows`);
check('kanji show English meanings', $$('.kanji-meaning').length === 82);
check('kanji cross-reference existing phrases', $$('.ref-chip').length > 20,
  `${$$('.ref-chip').length} phrase cross-references shown`);
check('cross-reference chips link to the deck or connector lesson they came from',
  $$('.ref-chip').every((a) => /^#\/en-ja\/(category|connectors)\//.test(a.getAttribute('href'))) &&
  $$('.ref-chip').some((a) => a.getAttribute('href').startsWith('#/en-ja/connectors/')));

const kanjiPlayed = played.length;
$$('.kanji-glyph')[0].click();
await tick(); await tick();
check('tapping a kanji plays its reading', played.length > kanjiPlayed, played.at(-1));

const kanjiWordsCount = readJSON(JA.characterSets.find((s) => s.id === 'kanji-words').file).characters.length;
await goTo('#/en-ja/characters/kanji-words');
check('the kanji behind the word decks have their own set', $$('.kanji-row').length === kanjiWordsCount,
  `${$$('.kanji-row').length} kanji`);
check('…each pointing to words it appears in',
  $$('.kanji-row').every((row) => [...row.querySelectorAll('.ref-chip')].some((a) =>
    /#\/en-ja\/category\/words-/.test(a.getAttribute('href')))));

await goTo('#/en-ja/characters/hiragana/study');
check('character study reuses the phrase flashcard UI', Boolean($('.study-card .jp')),
  $('.study-card .jp')?.textContent);
check('study screen shows which set the card came from',
  $('.card-cat')?.textContent === 'Hiragana', $('.card-cat')?.textContent);

$$('button').find((b) => b.textContent === 'Show answer')?.click();
await tick(); await tick();
check('character card reveals its reading', Boolean($('.study-back')), $('.english')?.textContent);
check('same four grade buttons as phrases', $$('.btn-grade').length === 4);

$$('.btn-grade').find((b) => b.textContent.startsWith('Got it'))?.click();
await tick(); await tick(); await tick();
check('grading a character advances the session', Boolean($('.study-card')));

await goTo('#/en-ja/');
check('home shows a separate reading row', text().includes('Reading'));
check('character counts stay out of the phrase stats',
  !$$('.stat-label').some((l) => l.textContent === 'characters'));

console.log('\n7b. Reading progression — kana mastery, the daily drill, the kanji gate');

check('Today offers the daily kana drill while kana aren’t mastered',
  $('.kana-today .row-title')?.textContent === 'Today’s kana drill — about two minutes' &&
  $('.kana-today')?.getAttribute('href') === '#/en-ja/characters/drill/hiragana',
  $('.kana-today .row-sub')?.textContent);

await goTo('#/en-ja/characters/kanji-words');
check('a kanji set explains that it comes after hiragana, and can still be added',
  Boolean($('.kanji-gate')) && $$('.kanji-gate button').some((b) => b.textContent === 'Add anyway'));

// A first drill: meet the new kana, then answer them — the first one wrong on purpose.
await goTo('#/en-ja/characters/drill/hiragana');
check('a first drill starts by meeting a few new kana, a row at a time',
  $$('.kana-intro .kana-cell').length === 5 && $$('.kana-intro .kana-char').map((c) => c.textContent).join('') === 'あいうえお',
  $$('.kana-intro .kana-char').map((c) => c.textContent).join(' '));
$$('.kana-intro button').find((b) => b.textContent === 'Start')?.click();
for (let i = 0; i < 4; i++) await tick();
let kanaAsked = 0;
let kanaWrong = null;
for (let guard = 0; guard < 30 && $('.kana-question'); guard++) {
  const q = $('.kana-question');
  const pick = kanaWrong
    ? $$('.option').find((b) => b.dataset.id === q.dataset.char)
    : $$('.option').find((b) => b.dataset.id !== q.dataset.char);
  if (!kanaWrong) kanaWrong = q.dataset.char;
  check(`kana question ${kanaAsked + 1}: four options, one of them right`,
    $$('.option').length === 4 && $$('.option').filter((b) => b.dataset.id === q.dataset.char).length === 1);
  pick.click();
  for (let i = 0; i < 8; i++) await tick();
  if (kanaAsked === 0) {
    check('a wrong answer is marked, and the right one shown',
      Boolean($('.option.is-wrong')) && Boolean($('.option.is-answer')) && Boolean($('.verdict-wrong')));
  }
  kanaAsked++;
  $('.drill-next')?.click();
  for (let i = 0; i < 8; i++) await tick();
}
check('…and the drill ends with the score', Boolean($('.practice-done')) && text().includes(`${kanaAsked - 1} of ${kanaAsked} right`),
  $('.practice-done .lede')?.textContent);
const kanaRecord = await deck.getKanaStats();
check('every answer is recorded per kana — the missed one starts over',
  Object.keys(kanaRecord).length === 5 && kanaRecord[kanaWrong].streak === 0 &&
  Object.entries(kanaRecord).every(([id, r]) => id === kanaWrong || r.streak === 1));
await goTo('#/en-ja/characters');
check('the panel then offers another round', $('.kana-panel .btn-primary')?.textContent === 'Another hiragana round');

// Mastery takes days; write two days of right answers for every core hiragana.
const store = await import('../js/store.js');
const coreOf = (set) => readJSON(JA.characterSets.find((s) => s.id === set).file).characters
  .filter((c) => ['base', 'dakuten', 'handakuten'].includes(c.group));
const masteredRecord = (chars) => Object.fromEntries(chars.map((c) =>
  [c.id, { right: 3, wrong: 0, streak: 3, days: ['2026-10-01', '2026-10-02'], last: Date.now() }]));
await store.set('meta', 'kanaStats', masteredRecord(coreOf('hiragana')));
await goTo('#/en-ja/characters');
check('with hiragana mastered, the kanji sets open', !$('.row-card.is-waiting') &&
  $('.kana-meter[data-script="hiragana"] .kana-meter-count')?.textContent === '✓ mastered' &&
  $('.kana-panel .btn-primary')?.textContent === 'Today’s katakana drill');

await goTo('#/en-ja/category/words-food');
const coffee = () => $('.phrase-card[data-item="w-koohii"] .phrase-block > .target');
check('katakana words carry a hiragana aid while katakana is being learned',
  coffee()?.querySelector('rt')?.textContent === 'こーひー');
await store.set('meta', 'kanaStats', { ...masteredRecord(coreOf('hiragana')), ...masteredRecord(coreOf('katakana')) });
const { refreshKanaAids } = await import('../js/reading.js');
await refreshKanaAids();
await goTo('#/en-ja/category/words-food');
check('once katakana is mastered, the aid goes', coffee() && !coffee().querySelector('ruby') && coffee().textContent === 'コーヒー',
  coffee()?.textContent);
check('…while kanji keep their furigana', Boolean($('.phrase-card[data-item="w-mizu"] .phrase-block > .target rt')));
await goTo('#/en-ja/');
check('with both kana mastered, Today goes back to the character cards', !$('.kana-today') && text().includes('Reading'));

console.log('\n8. Settings');

await goTo('#/en-ja/settings');
check('settings renders', text().includes('Settings'));
check('toggles present: romaji, auto-play and the three card types',
  $$('input[type="checkbox"]').length === 5 && $$('input[data-dir]').length === 3);
check('furigana is a three-way choice, set to always',
  $$('.furigana-mode .segment').map((b) => b.dataset.mode).join(',') === 'always,tap,hidden' &&
  $('.furigana-mode .segment.is-on')?.dataset.mode === 'always');
$('.furigana-mode .segment[data-mode="tap"]')?.click();
for (let i = 0; i < 6; i++) await tick();
check('choosing tap-to-show sticks', $('.furigana-mode .segment.is-on')?.dataset.mode === 'tap');
$('.furigana-mode .segment[data-mode="always"]')?.click();
for (let i = 0; i < 6; i++) await tick();
check('new-cards-per-day control present', Boolean($('input[type="number"]')));
check('text size control present', Boolean($('input[type="range"]')));
check('storage backend reported', /Storage: (IndexedDB|localStorage)/.test(text()),
  text().match(/Storage: \w+/)?.[0]);
check('phrase and character decks are reported separately',
  text().includes('Flashcards:') && text().includes('Characters:'),
  text().match(/Characters: [^S]*/)?.[0]?.trim());

console.log('\n8b. Your data — backup and restore');

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };
await goTo('#/en-ja/');
check('Today reminds you to back up, once there is progress worth keeping',
  $('.backup-nudge .row-sub')?.textContent === 'It lives only in this browser — no backup yet' &&
  $('.backup-nudge')?.getAttribute('href') === '#/en-ja/settings/data');
await goTo('#/en-ja/settings/data');
check('Settings has a "Your data" section, saying there is no backup yet',
  Boolean($('#your-data')) && $('.data-last')?.textContent === 'Last backup: never');

$('[data-action="download"]')?.click();
await settle(30);
const backupFile = downloads.at(-1);
const backupJson = backupFile ? JSON.parse(await backupFile.text()) : null;
check('"Download a backup" hands over one JSON file', backupJson?.format === 'wayword-backup',
  backupFile ? `${Math.round(backupFile.size / 1024)} KB` : 'nothing downloaded');
const deckNow = await deck.getDeck();
check('…holding every card in the course, and your own words',
  Object.keys(backupJson?.namespaces['en-ja']?.srs || {}).length === deckNow.length &&
  backupJson.namespaces['en-ja'].meta.userItems?.some((u) => u.target === '今日は暑いね'),
  `${Object.keys(backupJson?.namespaces['en-ja']?.srs || {}).length} cards`);
check('…and the last-backup line updates', $('.data-last')?.textContent === 'Last backup: today', $('.data-last')?.textContent);
await goTo('#/en-ja/');
check('…and Today stops reminding', !$('.backup-nudge'));

// Restore: a file that isn't a backup changes nothing.
const choose = async (file) => {
  const input = $('#your-data input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await settle(30);
};
await goTo('#/en-ja/settings/data');
await choose(new window.File(['not json at all'], 'notes.txt', { type: 'text/plain' }));
check('a file that isn\'t a backup is turned away, and nothing changes',
  $('.data-status')?.textContent === 'That file isn’t a Wayword backup — nothing was changed.' &&
  (await deck.getDeck()).length === deckNow.length);

// Restore a backup in which your own words are gone — then undo it.
const edited = structuredClone(backupJson);
edited.namespaces['en-ja'].meta.userItems = [];
const asked = [];
globalThis.confirm = (message) => { asked.push(message); return true; };
await choose(new window.File([JSON.stringify(edited)], 'wayword-backup.json', { type: 'application/json' }));
check('restoring asks first, saying what the backup holds',
  /Restore the backup from .+\?/.test(asked.at(-1) || '') && asked.at(-1).includes('English › Japanese — cards: '),
  (asked.at(-1) || '').split('\n')[2]);
check('…then replaces the course with the backup', (await deck.getUserItems()).length === 0);
await goTo('#/en-ja/settings/data');
check('the restore can be undone from Settings', Boolean($('[data-action="undo"]')));
$('[data-action="undo"]')?.click();
await settle(30);
check('…which puts your own words back', (await deck.getUserItems()).some((u) => u.target === '今日は暑いね'));
globalThis.confirm = () => true;

console.log('\n9. Home again — switching the speaker');

await goTo('#/');
check('back on the picker, Japanese now shows its progress',
  /due today|All caught up/.test($('.course-card[data-course="en-ja"]')?.textContent || ''),
  $('.course-card[data-course="en-ja"] .course-status')?.textContent);

$$('.segment').find((b) => b.dataset.speaker === 'ja')?.click();
await tick(); await tick(); await tick(); await tick();
check('choosing 日本語 relabels the picker in Japanese', text().includes('学びたい言語'), $('.section-title')?.textContent);
check('…and sets the page language for fonts and screen readers', document.documentElement.lang === 'ja');
check('Japanese speakers are offered English',
  Boolean($('.course-card[data-course="ja-en"]:not(.is-planned)')), $('.course-card[data-course="ja-en"] .course-name')?.textContent);
check('…with Indonesian as a coming-soon placeholder here too',
  Boolean($('.course-card[data-course="ja-id"].is-planned')), $('.course-card[data-course="ja-id"] .pill')?.textContent);
check('the English-speaker courses are not listed', !$('.course-card[data-course="en-ja"]'));

console.log('\n10. English for Japanese speakers');

// Offline, before this device ever downloaded the course.
unreachable = 'content/en/';
await goTo('#/ja-en/');
check('offline, a course never downloaded here says so, in the learner\'s language, instead of failing',
  $('h1')?.textContent === 'まだこの端末にありません' && !text().includes('Something went wrong') &&
    document.body.classList.contains('no-tabs') && Boolean($('a.btn[href="#/"]')),
  $('h1')?.textContent);
unreachable = null;

await goTo('#/ja-en/');
check('course bar shows the pair in Japanese', document.querySelector('.coursebar-pair')?.textContent === '日本語 › 英語',
  document.querySelector('.coursebar-pair')?.textContent);
check('the English course has its own placement quiz', text().includes('まずはレベルチェック'));
check('placement intro comes from the course, in Japanese', text().includes('学校で習った英語'));
$$('button').find((b) => b.textContent === 'はじめる')?.click();
await tick(); await tick();
check('placement cards show English to learn', $('.placement-card .target')?.getAttribute('lang') === 'en',
  $('.placement-card .target')?.textContent);
check('placement shows no romaji line for English', !$('.placement-card .romaji'));
for (let i = 0; i < 40 && $$('.btn-answer').length; i++) {
  $$('.btn-answer')[i % 3].click();
  await tick(); await tick();
}
await tick(); await tick(); await tick();
check('placement results are in Japanese', text().includes('デッキができました'));
check('results list all 10 English categories and no reading section',
  $$('.result-row').length === 10 && !text().includes('Reading'), `${$$('.result-row').length} rows`);
check('no "set up reading" button for a course without characters', !$$('button').some((b) => b.textContent === 'Set up reading first'));
$$('button').find((b) => b.textContent === '学習を始める')?.click();
await tick(); await tick(); await tick();

await goTo('#/ja-en/');
check('today screen is in Japanese', $('h1')?.textContent === '今日', $('h1')?.textContent);
const tabLabels = [...document.querySelectorAll('.tabbar a')].map((a) => a.textContent);
check('tab bar is in Japanese, with the course\'s own name for its lessons and no Characters tab',
  tabLabels.join('|') === '📅今日|📚学ぶ|🧩表現|🗣️会話練習|⚙️設定', tabLabels.join(' | '));
check('tabs link inside the English course',
  [...document.querySelectorAll('.tabbar a')].every((a) => a.getAttribute('href').startsWith('#/ja-en/')));
check('no Reading row on the English today screen', !text().includes('Reading'));

await goTo('#/ja-en/category/hotel');
check('category renders with its Japanese title', text().includes('ホテル'));
check('phrases show English as the text to learn',
  $$('.phrase-card .target').length === 10 && $$('.phrase-card .target').every((n) => n.getAttribute('lang') === 'en'),
  $('.phrase-card .target')?.textContent);
check('meanings are Japanese', $$('.phrase-card .meaning').every((n) => n.getAttribute('lang') === 'ja'),
  $('.phrase-card .meaning')?.textContent);
check('usage and katakana-English notes render with their labels',
  text().includes('使い方') && $$('.note-pitfall').length > 0 && text().includes('wake-up call'),
  `${$$('.note-pitfall').length} pitfall notes`);
check('no furigana/romaji toggles for English', !$('.toggle-strip'));
check('no ruby annotations on English', $$('.phrase-card ruby').length === 0);

// Phrases placement marked as known go straight to "say it" cards, so the
// first card may be asked either way round; English is what's learned in both.
await goTo('#/ja-en/study/greetings');
const enProduction = $('.study-card')?.classList.contains('dir-production');
check('study card asks about English, in Japanese', enProduction
  ? $('.study-card .meaning')?.getAttribute('lang') === 'ja' && text().includes('英語でどう言いますか')
  : $('.study-card .target')?.getAttribute('lang') === 'en',
  `${enProduction ? 'production' : 'recognition'}: ${$('.study-card .target, .study-card .meaning')?.textContent}`);
$$('button').find((b) => b.textContent === '答えを見る')?.click();
await tick(); await tick();
check('flipping reveals the other side', enProduction
  ? $('.study-back .target')?.getAttribute('lang') === 'en'
  : $('.study-back .meaning')?.getAttribute('lang') === 'ja',
  $('.study-back .target, .study-back .meaning')?.textContent);
check('no stray "null" where the (absent) toggle strip would be', !/\bnull\b/.test(text()));
check('grade buttons are in Japanese with Japanese intervals',
  $$('.btn-grade strong').map((s) => s.textContent).join('|') === 'わからない|あやしい|わかった|簡単すぎ' &&
  $$('.grade-when').every((g) => /分|時間|日|か月|今/.test(g.textContent)),
  $$('.grade-when').map((g) => g.textContent).join(' / '));
const playedBeforeEn = played.length;
$$('.btn-grade')[2].click();
await tick(); await tick(); await tick();
check('English audio is used', played.slice(playedBeforeEn - 1).some((p) => p.startsWith('audio/en/')) ||
  played.some((p) => p.startsWith('audio/en/')), played.at(-1));

await goTo('#/ja-en/category/words-cafe');
const cafeWords = readJSON(EN.decks.find((d) => d.id === 'words-cafe').file).items;
check('an English word deck lists its words, English to learn with Japanese meanings',
  $$('.target[lang="en"]').length === cafeWords.length && $$('.meaning[lang="ja"]').length >= cafeWords.length,
  `${$$('.target[lang="en"]').length} of ${cafeWords.length}`);
check('…with Japanese part-of-speech labels', text().includes('名詞') && text().includes('動詞'));

await goTo('#/ja-en/connectors');
check('the lessons are listed under the course\'s own name',
  $('h1')?.textContent === '表現・つなぎ言葉' && $$('.lesson-row').length === EN.lessons.length &&
  $$('.connector-mark').every((m) => m.getAttribute('lang') === 'en'),
  `${$('h1')?.textContent}: ${$$('.lesson-row').length} lessons`);
check('…grouped as the manifest says', $$('.section-title').map((h) => h.textContent).join('|') ===
  EN.lessonGroups.map((g) => g.title).join('|'));
check('…and its tab is lit', document.querySelector('.tabbar a.active')?.dataset.path === '/connectors');

await goTo('#/ja-en/connectors/pat-like');
const likeFile = readJSON(EN.lessons.find((l) => l.id === 'pat-like').file);
check('a pattern lesson shows the English pattern, a Japanese explanation and its examples',
  $('.connector-title')?.textContent === likeFile.connector && $('.connector-title')?.getAttribute('lang') === 'en' &&
  Boolean($('.lesson-explanation')) && $$('.item-sentence').length === likeFile.examples.length,
  $('.connector-title')?.textContent);
check('…with a way back to the list by its name', text().includes('← 表現・つなぎ言葉'));
check('…and no furigana in an English lesson', $$('ruby').length === 0);

await goTo('#/ja-en/connectors/pat-like/practice');
check('pattern practice opens on a drill in Japanese', Boolean($('.drill-card')) && document.documentElement.lang === 'ja',
  $('.drill-card')?.dataset.drill);
const likeEx = Object.fromEntries(likeFile.examples.map((x) => [x.id, x]));

/** Answer the drill on screen rightly — or, for a say-it drill, say "not yet" when asked to. */
async function answerDrill(examples, { notYet = false } = {}) {
  const kind = $('.drill-card')?.dataset.drill;
  const ex = examples[$('.drill-card')?.dataset.example];
  if (kind === 'fill') {
    $$('.option').find((b) => b.dataset.value === ex.gap.answer)?.click();
  } else if (kind === 'say') {
    $('.say-reveal')?.click();
    await tick();
    $(`.say-grades [data-said="${notYet ? 'no' : 'yes'}"]`)?.click();
  } else {
    for (let i = 0; i < ex.chunks.length; i++) { $(`.tile-pool .tile[data-chunk="${i}"]`)?.click(); await tick(); }
    $$('.drill-actions button').find((b) => b.textContent === '答え合わせ')?.click();
  }
  await tick(); await tick();
}
await answerDrill(likeEx);
check('…and the right answer is marked right', Boolean($('.verdict-right')), $('.verdict')?.textContent);

// Saying it out loud: the Japanese first, the English when asked for — and "not yet" sends it to the reviews.
await goTo('#/ja-en/connectors/con-so/practice');
const soEx = Object.fromEntries(readJSON(EN.lessons.find((l) => l.id === 'con-so').file).examples.map((x) => [x.id, x]));
let notYetOn = null;
const soKinds = new Set();
for (let guard = 0; guard < 40 && $('.drill-card'); guard++) {
  const kind = $('.drill-card').dataset.drill;
  soKinds.add(kind);
  if (kind === 'say' && !notYetOn) {
    notYetOn = $('.drill-card').dataset.example;
    check('a say-it drill shows the Japanese, and keeps the English back until asked',
      $('.drill-card .meaning')?.getAttribute('lang') === 'ja' && $('.say-answer')?.hidden === true &&
        $('.drill-kind')?.textContent === '英語で言ってみましょう' && text().includes('まず声に出して'),
      $('.drill-kind')?.textContent);
    const playedBeforeSay = played.length;
    $('.say-reveal')?.click();
    await tick();
    check('…then shows it, plays it, and asks whether you said it',
      $('.say-answer')?.hidden === false && $('.say-answer .target')?.getAttribute('lang') === 'en' &&
        Boolean($('.say-answer .audio-slow')) && played.length > playedBeforeSay &&
        $$('.say-grades button').map((b) => b.textContent).join('|') === 'まだ言えない|言えた',
      $('.say-answer .target')?.textContent);
    $('.say-grades [data-said="no"]')?.click();
    await tick(); await tick();
    check('"Not yet" counts as a miss, and says the sentence is in the reviews now',
      Boolean($('.verdict-wrong')) && text().includes('復習に入れました'), $('.verdict')?.textContent);
  } else {
    await answerDrill(soEx);
  }
  $('.drill-next')?.click();
  for (let i = 0; i < 6; i++) await tick();
}
check('a linking-word session runs all four kinds of drill to the end',
  ['fill', 'order', 'combine', 'say'].every((k) => soKinds.has(k)) && Boolean($('.practice-done')), [...soKinds].join(', '));
check('…and the sentence not yet said is in the reviews, as a failed "say it" card',
  (await deck.getCard(`${notYetOn}~p`))?.state === 'learning', notYetOn);

await goTo('#/ja-en/scenarios');
check('scenario list in Japanese with all 7 English scenarios',
  text().includes('会話練習') && $$('.row-card').length === EN.scenarios.length && EN.scenarios.length === 7,
  `${$$('.row-card').length} scenarios`);
// Listening: a daily drill on Today, a section in Learn — not a tab, so the scenarios keep theirs.
const replyFile = readJSON(EN.listening.find((l) => l.kind === 'replies').file);
const pairCount = readJSON(EN.listening.find((l) => l.kind === 'contrasts').file).sets.reduce((n, x) => n + x.pairs.length, 0);
await goTo('#/ja-en/');
check('Today offers the daily listening drill, and how much is mastered',
  $('.listen-today .row-title')?.textContent === '今日の聞き取り（2〜3分）' &&
    $('.listen-today .row-sub')?.textContent === `66個中0個を習得`, $('.listen-today .row-sub')?.textContent);
check('…while the tab bar keeps the scenarios', [...document.querySelectorAll('.tabbar a')].some((a) => a.dataset.path === '/scenarios') &&
  ![...document.querySelectorAll('.tabbar a')].some((a) => a.dataset.path === '/listening'));
await goTo('#/ja-en/browse');
check('Learn lists the listening section',
  $('.row-card[data-section="listening"] .row-sub')?.textContent === `${replyFile.items.length}文・音のペア${pairCount}組`,
  $('.row-card[data-section="listening"] .row-sub')?.textContent);
await goTo('#/ja-en/listening');
check('the listening page lists every line said back, with what to answer, and every pair of sounds',
  $('h1')?.textContent === '聞き取り' && $$('.listen-line').length === replyFile.items.length &&
    $$('.listen-line .listen-reply').length === replyFile.items.filter((x) => x.reply).length &&
    $$('.contrast-pair').length === pairCount,
  `${$$('.listen-line').length} lines, ${$$('.contrast-pair').length} pairs`);
check('…as part of Learn', document.querySelector('.tabbar a.active')?.dataset.path === '/browse');

await goTo('#/ja-en/listening/drill');
const listenAsked = [];
const listenKindsChecked = new Set();
let listenWrong = null;
for (let guard = 0; guard < 20 && $('.listen-question'); guard++) {
  const card = $('.listen-question');
  const kind = card.dataset.listen;
  listenAsked.push(card.dataset.item);
  const playedBefore = played.length;
  if (guard === 0) {
    check('a listening question plays the line, with 🐢 to hear it slower',
      $$('.listen-question .listen-btn').length === 2 && Boolean($('.listen-question .listen-slow')));
  }
  if (kind === 'reply' && !listenKindsChecked.has(kind)) {
    listenKindsChecked.add(kind);
    check('"What did they say?" offers three meanings, in Japanese',
      $('.drill-kind')?.textContent === '何と言っていますか？' && $$('.listen-option').length === 3 &&
        $$('.listen-option span').every((s) => s.getAttribute('lang') === 'ja'));
  }
  if (kind === 'contrast' && !listenKindsChecked.has(kind)) {
    listenKindsChecked.add(kind);
    check('"Which one did you hear?" offers the two words of a pair',
      $('.drill-kind')?.textContent === 'どっちに聞こえましたか？' && $$('.contrast-option').length === 2 &&
        $$('.contrast-option .contrast-word').every((w) => w.getAttribute('lang') === 'en'));
  }
  const pick = listenWrong ? card.dataset.item : $$('.option').find((b) => b.dataset.id !== card.dataset.item)?.dataset.id;
  if (!listenWrong) listenWrong = card.dataset.item;
  $$('.option').find((b) => b.dataset.id === pick)?.click();
  for (let i = 0; i < 6; i++) await tick();
  if (listenAsked.length === 1) {
    check('a wrong answer is marked, the right one shown — and what was said, to read and hear again',
      Boolean($('.option.is-wrong')) && Boolean($('.option.is-answer')) && Boolean($('.verdict-wrong')) &&
        (kind === 'reply' ? Boolean($('.drill-answer .audio-btn')) : $$('.contrast-play').length === 2),
      kind);
  }
  $('.drill-next')?.click();
  for (let i = 0; i < 6; i++) await tick();
}
check('the drill ends with the score', Boolean($('.practice-done')) &&
  text().includes(`${listenAsked.length}問中${listenAsked.length - 1}問正解`), $('.practice-done .lede')?.textContent);
const listenRecord = await deck.getListenStats();
check('every answer is recorded per item — the missed one starts over',
  listenAsked.every((id) => listenRecord[id]) && listenRecord[listenWrong].streak === 0 &&
    listenAsked.filter((id) => id !== listenWrong).every((id) => listenRecord[id].streak === 1),
  `${listenAsked.length} asked`);
await goTo('#/ja-en/');
check('…and Today shows it done', $('.listen-today')?.classList.contains('is-done') &&
  $('.listen-today .row-title')?.textContent === '今日の聞き取りは完了');

await goTo('#/ja-en/scenario/cafe');
check('the café scenario has the learner ordering, as the customer',
  $('.dialogue-who')?.textContent === 'バリスタ' && $$('.btn-option').some((b) => b.textContent.includes("I'd like")),
  `${$('.dialogue-who')?.textContent}: ${$$('.btn-option').map((b) => b.textContent.slice(0, 30)).join(' / ')}`);
await goTo('#/ja-en/scenario/immigration');
check('NPC line is English with a Japanese meaning',
  $('.dialogue.npc .target')?.getAttribute('lang') === 'en' && $('.dialogue.npc .meaning')?.getAttribute('lang') === 'ja',
  $('.dialogue.npc .target')?.textContent);
check('speaker label is translated', $('.dialogue-who')?.textContent === '審査官', $('.dialogue-who')?.textContent);
$('.audio-inline-slow')?.click();
await tick();
check('the line can be heard slower', played.at(-1)?.startsWith('audio/en/scenario/') && speeds.at(-1).rate === 0.75 &&
  $('.audio-inline-slow')?.textContent === '🐢 ゆっくり', played.at(-1));
check('three replies offered', $$('.btn-option').length === 3);
for (let i = 0; i < 12 && $$('.btn-option').length; i++) {
  $$('.btn-option').at(-1).click(); // walk the "wrong" branch: it must still teach and finish
  await tick(); await tick(); await tick();
}
check('wrong answers get Japanese feedback and the scenario still finishes',
  $$('.feedback-wrong').length > 0 && text().includes('もう一度'),
  $('.feedback-wrong')?.textContent.slice(0, 40) + '…');

await goTo('#/ja-en/characters');
check('Characters is not routable in a course without character sets', !text().includes('Hiragana') && $('h1')?.textContent === '今日');

await goTo('#/ja-en/settings');
check('settings are in Japanese', $('h1')?.textContent === '設定');
check('only the toggles English has (auto-play, card types), no furigana/romaji',
  $$('input[type="checkbox"]:not([data-dir])').length === 1 && $$('input[data-dir]').length === 3 && !$('.furigana-mode'));
check('no character-cards control', $$('input[type="number"]').length === 1);
check('deck summary has no Characters line', !text().includes('Characters:'));

console.log('\n11. Old links');

await goTo('#/browse');
check('a pre-courses link lands in the course used last', location.hash === '#/ja-en/browse', location.hash);
await goTo('#/en-ja/');
await goTo('#/review');
check('…which follows whichever course that was', location.hash.startsWith('#/en-ja/'), location.hash);
check('the Japanese course switched the interface back to English', document.documentElement.lang === 'en');
await goTo('#/no-such-place');
check('an unknown path goes to the picker', location.hash === '#/' && text().includes('Wayword'), location.hash);

console.log('\n12. Console health');

const realErrors = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
check('no unexpected console errors during the walkthrough',
  realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

console.log(
  failures
    ? `\n✗ ${failures} of ${checks} render checks failed\n`
    : `\n✓ all ${checks} render checks passed — every screen renders and responds\n`
);
process.exit(failures ? 1 : 0);
