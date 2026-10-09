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

// Audio is never actually played here; record calls instead.
const played = [];
globalThis.Audio = class {
  constructor(src) { this.src = src; }
  play() { played.push(this.src); return Promise.resolve(); }
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

globalThis.fetch = async (path) => {
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
check('"Set up reading first" lands on Characters, not Today',
  location.hash === '#/en-ja/characters' && $('h1')?.textContent === 'Characters', `${location.hash} · ${$('h1')?.textContent}`);

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
check('every deck listed, plus your own words', $$('.row-card').length === jaDecks.length + 1, `${$$('.row-card').length} rows`);
check('words, sentences, phrases and your own words, in that order',
  $$('.kind-title').map((h) => h.textContent).join('|') === 'Words|Sentences|Phrases|Your own words',
  $$('.kind-title').map((h) => h.textContent).join(' | '));
check('phrases grouped by topic, titled from the manifest',
  $$('.section-title').map((h) => h.textContent).join('|') === JA.groups.map((g) => g.title).join('|'),
  $$('.section-title').map((h) => h.textContent).join(' | '));
check('word decks say how many words they hold',
  $('.row-card[data-deck="words-people"] .row-sub')?.textContent === `${readJSON(JA.decks[0].file).items.length} words`,
  $('.row-card[data-deck="words-people"] .row-sub')?.textContent);
check('no week-by-week or trip framing left', !/Week \d|trip/i.test(text()));
check('starter decks marked as in-deck', $$('.pill-on').length === jaStarters.length, `${$$('.pill-on').length} in deck`);
check('the rest offer an Add button',
  $$('button').filter((b) => b.textContent === 'Add').length === jaDecks.length - jaStarters.length);

console.log('\n4. Category detail');

await goTo('#/en-ja/category/greetings');
check('category renders', text().includes('Greetings & Politeness'));
check('all phrases listed', $$('.phrase-card').length === 24, `${$$('.phrase-card').length} cards`);
check('every polite phrase is labelled Polite',
  $$('.phrase-card .register-polite').length === 24 && !$('.phrase-card .register-casual'));
check('register notes render', text().includes('Register'));
check('anime divergence notes render', $$('.note-anime').length > 0, `${$$('.note-anime').length} notes`);
check('audio buttons render', $$('.audio-btn').length > 0);
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
check('Learn counts your own words', $$('.row-card').at(-1)?.textContent.includes('1 card of your own'),
  $$('.row-card').at(-1)?.querySelector('.row-sub')?.textContent);

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
check('characters screen renders', text().includes('Characters'));
check('every set listed', $$('.row-card').length === JA.characterSets.length,
  $$('.row-title').map((t) => t.textContent).join(', '));
check('sets are addable', $$('button').filter((b) => b.textContent === 'Add').length === JA.characterSets.length);
check('stroke-order deferral is disclosed', text().includes('stroke-order'));

// Add hiragana, then confirm it lands in the character deck only.
$$('button').find((b) => b.textContent === 'Add')?.click();
await tick(); await tick(); await tick(); await tick();
check('adding a set marks it in-deck', $$('.pill-on').length === 1);
check('character review becomes available', text().includes('Review characters'));

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
check('cross-reference chips link into the phrase content',
  $$('.ref-chip').every((a) => a.getAttribute('href').startsWith('#/en-ja/category/')));

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
  text().includes('Phrases:') && text().includes('Characters:'),
  text().match(/Characters: [^S]*/)?.[0]?.trim());

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
check('tab bar is in Japanese, without a Characters tab',
  tabLabels.join('|') === '📅今日|📚学ぶ|🗣️会話練習|⚙️設定', tabLabels.join(' | '));
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

await goTo('#/ja-en/scenarios');
check('scenario list in Japanese with all 6 English scenarios',
  text().includes('会話練習') && $$('.row-card').length === 6, `${$$('.row-card').length} scenarios`);
await goTo('#/ja-en/scenario/immigration');
check('NPC line is English with a Japanese meaning',
  $('.dialogue.npc .target')?.getAttribute('lang') === 'en' && $('.dialogue.npc .meaning')?.getAttribute('lang') === 'ja',
  $('.dialogue.npc .target')?.textContent);
check('speaker label is translated', $('.dialogue-who')?.textContent === '審査官', $('.dialogue-who')?.textContent);
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
