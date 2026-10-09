/**
 * integration-test.mjs — drives the real end-to-end loop headlessly.
 *
 * Imports the actual app modules (content → quiz → deck → srs) with just
 * enough of a browser shimmed in: fetch backed by the filesystem, and a
 * localStorage shim so store.js exercises its fallback path.
 *
 * This is the check that the loop the README cares about — browse →
 * placement quiz → study → SRS review — actually holds together, without
 * needing a browser.
 *
 *   node tools/integration-test.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- browser shims (must be installed before importing app code) ---------- */

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
  const file = resolve(ROOT, String(path));
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};

const { loadContent } = await import('../js/content.js');
const deck = await import('../js/deck.js');
const srs = await import('../js/srs.js');
const quiz = await import('../js/quiz.js');

/* ---------- harness ---------- */

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ---------- 1. content loads ---------- */

console.log('\n1. Content layer');

const content = await loadContent();
check('manifest + all categories load', content.categories.length === content.manifest.categories.length,
  `${content.categories.length} categories`);
check('no category failed to load', content.categories.every((c) => !c.missing));
check('phrase index is populated', content.phrases.size > 100, `${content.phrases.size} phrases`);
check('categories are in manifest order',
  content.categories.every((c, i, all) => i === 0 || all[i - 1].order < c.order),
  content.categories.map((c) => c.id).join(' → '));
check('every phrase is labelled polite or casual',
  content.categories.every((c) => c.phrases.every((p) => ['polite', 'casual'].includes(p.register))));
const casual = content.categories.find((c) => c.id === 'casual');
check('the casual set is casual, each with its polite version',
  casual?.phrases.length > 30 && casual.phrases.every((p) => p.register === 'casual' && p.polite?.target && p.polite.audio),
  `${casual?.phrases.length} phrases`);
check('…while the other categories stay polite',
  content.categories.filter((c) => c.id !== 'casual').every((c) => c.phrases.every((p) => p.register === 'polite')));

/* ---------- 2. placement quiz ---------- */

console.log('\n2. Placement quiz (§6a)');

const items = await quiz.buildPlacementSet();
const phraseItems = items.filter((i) => i.kind !== 'character');
const charItems = items.filter((i) => i.kind === 'character');

check('quiz pulls two phrase cards per category (§6a, A5)',
  phraseItems.length === 2 * content.categories.length, `${phraseItems.length} phrase cards`);
check('quiz also samples two characters per set',
  charItems.length === 2 * content.characterSets.length, `${charItems.length} character cards`);

const covered = new Set(phraseItems.map((i) => i.categoryId));
check('quiz spans every phrase category', covered.size === content.categories.length, `${covered.size} covered`);

const charCovered = new Set(charItems.map((i) => i.categoryId));
check('quiz spans every character set', charCovered.size === content.characterSets.length, [...charCovered].join(', '));

check('quiz samples both ends of each category',
  content.categories.every((cat) => {
    const picks = items.filter((i) => i.categoryId === cat.id);
    return picks.length === 2 && picks[0].difficulty <= picks[1].difficulty;
  }));
check('quiz samples both ends of each character set',
  content.characterSets.every((set) => {
    const picks = items.filter((i) => i.categoryId === set.id);
    return picks.length === 2 && picks[0].difficulty <= picks[1].difficulty;
  }));

// Simulate an anime-derived learner: strong on greetings/small talk,
// weak on the functional categories. Exactly the lopsidedness §6a describes.
const answers = {};
for (const item of items) {
  const strong = ['greetings', 'smalltalk'].includes(item.categoryId);
  answers[item.id] = strong
    ? quiz.ANSWERS.KNOWN
    : item.difficulty <= 2 ? quiz.ANSWERS.RECOGNISED : quiz.ANSWERS.UNKNOWN;
}

const result = await quiz.applyPlacement(items, answers);
check('placement is recorded as done', result.done === true);
check('scores computed for every category and character set',
  Object.keys(result.perCategory).length === content.categories.length + content.characterSets.length,
  `${Object.keys(result.perCategory).length} buckets`);
check('strong category scores high', result.perCategory.greetings.score === 1, String(result.perCategory.greetings.score));
check('weak category scores low', result.perCategory.airport.score < 0.5, String(result.perCategory.airport.score));
check('onboarding gate now passes', await deck.isOnboarded());

/* ---------- 3. deck seeding ---------- */

console.log('\n3. Deck seeding (§7 — starter categories only)');

const settings = await deck.getSettings();
// Starters are phrase categories and word/sentence decks alike.
const everyDeck = [...content.categories, ...content.decks];
const starters = everyDeck.filter((c) => c.starter);
check('only the starter decks are activated',
  [...settings.activeCategories].sort().join(',') === starters.map((c) => c.id).sort().join(','),
  settings.activeCategories.join(', '));
check('starters are a handful, not everything', starters.length >= 2 && starters.length < everyDeck.length,
  starters.map((c) => c.id).join(', '));
check('a new learner starts with words as well as phrases',
  starters.some((d) => d.type === 'words') && starters.some((d) => d.type === 'phrases'));

const allCards = await deck.getDeck();
const starterItems = starters.reduce((n, c) => n + c.items.length, 0);
check('deck populated from the starter decks', allCards.length >= starterItems, `${allCards.length} cards`);

const knownGreeting = items.find((i) => i.categoryId === 'greetings');
const seededCard = await deck.getCard(knownGreeting.id);
check('"I know this" card was seeded forward, not queued today',
  seededCard.state === 'review' && seededCard.due > Date.now(),
  `due in ${Math.round((seededCard.due - Date.now()) / srs.DAY)} days`);

const greetingCards = allCards.filter((c) => c.categoryId === 'greetings');
const seededByCategory = greetingCards.filter((c) => c.state === 'review');
check('a strong category seeds its easy cards forward too',
  seededByCategory.length > 2, `${seededByCategory.length} of ${greetingCards.length} seeded`);

const airportCards = allCards.filter((c) => c.categoryId === 'airport');
check('a weak category starts entirely from scratch',
  airportCards.every((c) => c.state === 'new'), `${airportCards.length} cards, all new`);

/* ---------- 4. study session ---------- */

console.log('\n4. Study / review loop');

const queue = await deck.queue();
check('queue is capped by the new-card limit',
  queue.length <= settings.newPerDay + 5, `${queue.length} cards, limit ${settings.newPerDay}`);
check('queue is non-empty on day one', queue.length > 0);

const first = queue[0];
const graded = await deck.grade(first.id, srs.GRADE.GOOD);
check('grading advances the card', graded.reps === 1 && graded.interval === 1, `interval ${graded.interval}d`);
check('graded card is no longer due today', graded.due > Date.now());

const lapse = await deck.grade(queue[1].id, srs.GRADE.AGAIN);
check('failing a card keeps it in today\'s session', lapse.due - Date.now() < srs.DAY, `back in ${Math.round((lapse.due - Date.now()) / 60000)} min`);

const stats = await deck.todayStats();
check('daily stats recorded', stats.reviews === 2 && stats.again === 1, `${stats.reviews} reviews, ${stats.again} again`);

/* ---------- 5. persistence ---------- */

console.log('\n5. Persistence');

const reread = await deck.getCard(first.id);
check('graded state survives a re-read', reread.reps === 1 && reread.interval === 1);
check('storage fell back to localStorage cleanly', mem.size > 0, `${mem.size} keys written`);

/* ---------- 6. adding a category later ---------- */

console.log('\n6. Progressive rollout');

const before = (await deck.getDeck()).length;
const added = await deck.activateCategory('hotel');
const after = (await deck.getDeck()).length;
check('adding a category grows the deck', after === before + added.added, `+${added.added} cards`);
check('newly added category is active', await deck.isActive('hotel'));

// deckSummary() is deliberately scoped to *active* categories, while
// getDeck() returns every card — the placement quiz seeds two cards from
// each of the ten categories, including ones not yet rolled out (§7).
const active = new Set((await deck.getSettings()).activeCategories);
const activeCount = (await deck.getDeck()).filter((c) => active.has(c.categoryId)).length;

const summary = await deck.deckSummary();
check('deck summary is scoped to active categories only',
  summary.total === activeCount && summary.total < after,
  `${summary.total} active of ${after} stored`);
check('cards for not-yet-rolled-out categories are parked, not queued',
  (await deck.queue()).every((c) => active.has(c.categoryId)));

/* ---------- 7. scenario trees ---------- */

console.log('\n7. Scenario dialogue trees');

const { loadScenario, scenariosFor } = await import('../js/content.js');

check('scenarios are listed in the manifest', (content.manifest.scenarios || []).length === 6,
  `${(content.manifest.scenarios || []).length} scenarios`);

for (const entry of content.manifest.scenarios || []) {
  const sc = await loadScenario(entry.id);

  // Walk the tree picking the first "good" option at every node, which is
  // the path a competent speaker would take. It must reach a terminal node.
  let node = sc.nodes[sc.start];
  let steps = 0;
  let usedPhrases = 0;
  while (node && !node.end && steps < 25) {
    const opt = node.options.find((o) => o.quality === 'good') || node.options[0];
    if (opt.phraseId) {
      if (content.phrases.has(opt.phraseId)) usedPhrases++;
      else { check(`${entry.id}: option references a real phrase`, false, opt.phraseId); }
    }
    node = sc.nodes[opt.next];
    steps++;
  }
  check(`${entry.id}: the natural path reaches an ending`, Boolean(node?.end), `${steps} turns`);
  check(`${entry.id}: reuses phrases from the deck rather than duplicating text`, usedPhrases > 0,
    `${usedPhrases} phrase references on that path`);

  // Every branch, including the awkward and wrong ones, must lead somewhere.
  const dangling = Object.entries(sc.nodes).flatMap(([id, n]) =>
    (n.options || []).filter((o) => !sc.nodes[o.next]).map((o) => `${id}→${o.next}`));
  check(`${entry.id}: no dangling branches`, dangling.length === 0, dangling.join(', '));
}

const shoppingScenarios = await scenariosFor('shopping');
check('scenarios resolve by category', shoppingScenarios.length === 1 && shoppingScenarios[0].id === 'conbini');

/* ---------- 8. characters ---------- */

console.log('\n8. Characters — separate deck');

check('every character set loads',
  content.characterSets.length === content.manifest.characterSets.length && content.characterSets.every((s) => !s.missing),
  content.characterSets.map((s) => `${s.id}:${s.characters.length}`).join(' '));

const hira = content.bySet.get('hiragana');
const kata = content.bySet.get('katakana');
const kanji = content.bySet.get('kanji-common');
const kanjiWords = content.bySet.get('kanji-words');

check('hiragana has the full functional set', hira.characters.length === 104, `${hira.characters.length}`);
check('katakana has the full functional set', kata.characters.length === 116, `${kata.characters.length}`);
check('kanji set is curated, not exhaustive',
  kanji.characters.length >= 60 && kanji.characters.length <= 120, `${kanji.characters.length} kanji`);
check('the word decks have a kanji set of their own', kanjiWords?.characters.length >= 50,
  `${kanjiWords?.characters.length} kanji`);
check('…every one of which appears in a word', kanjiWords.characters.every((c) =>
  (c.seenIn || []).some((id) => content.phrases.get(id)?.kind === 'word')));

check('hiragana covers the 46 base characters',
  hira.characters.filter((c) => c.group === 'base').length === 46);
check('hiragana includes dakuten/handakuten',
  hira.characters.filter((c) => c.group === 'dakuten' || c.group === 'handakuten').length === 25);
check('hiragana includes yōon combinations',
  hira.characters.filter((c) => c.group === 'yoon').length === 33);

check('characters are phrase-shaped so the flashcard UI needs no branching',
  hira.characters.every((c) => c.japanese && c.romaji && c.english && Array.isArray(c.furigana)));
check('characters are indexed alongside phrases for card lookup',
  content.phrases.has('hira-a') && content.phrases.has('kan-deguchi'));

// Cross-referencing is the point: reinforcement, not a second vocab list.
const withRefs = kanji.characters.filter((c) => (c.seenIn || []).length);
check('kanji cross-reference existing phrase content', withRefs.length >= 25,
  `${withRefs.length}/${kanji.characters.length} kanji appear in phrases`);
check('every cross-reference resolves to a real phrase',
  withRefs.every((c) => c.seenIn.every((id) => content.phrases.has(id))));
check('cross-references are accurate — the phrase really contains the character',
  [...withRefs, ...kanjiWords.characters].every((c) =>
    c.seenIn.every((id) => content.phrases.get(id).japanese.includes(c.character))));

// Deck separation.
const phraseQueueBefore = (await deck.queue()).length;
const charsAdded = await deck.activateCharacterSet('hiragana');
check('activating a set adds its characters', charsAdded.added > 100, `+${charsAdded.added}`);
check('character set is now active', await deck.isSetActive('hiragana'));

const charQueue = await deck.characterQueue();
check('character queue is non-empty', charQueue.length > 0, `${charQueue.length} cards`);
check('character queue contains only characters',
  charQueue.every((c) => c.kind === 'character'));
check('character queue respects its own daily cap',
  charQueue.length <= (await deck.getSettings()).newCharsPerDay + 5, `${charQueue.length} cards`);
check('new characters arrive easiest-first — base kana before yōon',
  charQueue.every((c) => (c.difficulty ?? 3) === 1),
  `difficulties: ${[...new Set(charQueue.map((c) => c.difficulty))].join(',')}`);

check('phrase queue is unchanged by adding characters',
  (await deck.queue()).length === phraseQueueBefore, `${phraseQueueBefore} before and after`);
check('phrase queue contains no characters',
  (await deck.queue()).every((c) => (c.kind ?? 'phrase') === 'phrase'));

const phraseSummaryAfter = await deck.deckSummary();
const charSummary = await deck.characterSummary();
check('deck summary excludes characters', phraseSummaryAfter.total === summary.total,
  `phrases still ${phraseSummaryAfter.total}`);
check('character summary counts only characters', charSummary.total >= 104, `${charSummary.total}`);

// Review counts must not bleed across decks.
const statsBefore = await deck.todayStats();
await deck.grade(charQueue[0].id, srs.GRADE.GOOD);
const statsAfter = await deck.todayStats();
check('grading a character bumps the character counter',
  statsAfter.charReviews === statsBefore.charReviews + 1,
  `${statsBefore.charReviews} → ${statsAfter.charReviews}`);
check('grading a character does NOT bump the phrase counter',
  statsAfter.reviews === statsBefore.reviews, `phrase reviews still ${statsAfter.reviews}`);

// Per-set scoping. Katakana is NOT active, but the placement quiz sampled
// two of its characters, so cards for it exist in storage.
const parkedKatakana = (await deck.getDeck()).filter((c) => c.categoryId === 'katakana');
check('placement-sampled cards exist for an inactive set', parkedKatakana.length > 0,
  `${parkedKatakana.length} parked`);
check('an inactive set stays out of the aggregate character queue',
  (await deck.characterQueue()).every((c) => c.categoryId !== 'katakana'));
check('asking for an inactive set explicitly still scopes to it',
  (await deck.characterQueue('katakana')).every((c) => c.categoryId === 'katakana'));
await deck.activateCharacterSet('kanji-common');
const kanjiQueue = await deck.characterQueue('kanji-common');
check('a second set queues independently',
  kanjiQueue.length > 0 && kanjiQueue.every((c) => c.categoryId === 'kanji-common'),
  `${kanjiQueue.length} kanji cards`);

/* ---------- 9. words, sentences and card directions ---------- */

console.log('\n9. Words, sentences, card directions, your own words');

check('word and sentence decks load',
  content.decks.length === content.manifest.decks.length && content.decks.every((d) => !d.missing && d.items.length > 0),
  `${content.decks.length} decks, ${content.decks.reduce((n, d) => n + d.items.length, 0)} items`);
check('the course knows it has words and sentences', content.features.words && content.features.sentences);

const iku = content.phrases.get('w-iku');
check('a word gets the same generic fields as a phrase',
  iku?.kind === 'word' && iku.target === '行く' && Boolean(iku.meaning) && iku.ruby?.[0]?.r === 'い',
  `${iku?.target} = ${iku?.meaning}`);
check('a verb carries its ます and て forms, each with furigana',
  iku.forms?.map((f) => f.key).join(',') === 'masu,te' && iku.forms.every((f) => f.target && f.ruby?.some((s) => s.r)),
  iku.forms?.map((f) => f.target).join(' · '));
check('katakana words carry a hiragana reading aid', content.phrases.get('w-koohii')?.ruby?.[0]?.r === 'こーひー');

const s01 = content.phrases.get('s-01');
check('a sentence is cut into chunks that rebuild it',
  s01?.kind === 'sentence' && s01.chunks.map((c) => c.target).join('') === s01.target,
  s01?.chunks.map((c) => c.target).join(' | '));
check('…each linked chunk naming a real word', s01.chunks.every((c) => !c.w || content.phrases.get(c.w)?.kind === 'word'));
check('each word knows the sentences it appears in', (content.usage.get('w-tomodachi') || []).includes('s-01'),
  (content.usage.get('w-tomodachi') || []).join(', '));

// Directions.
const startSettings = await deck.getSettings();
check('recognition and production are on by default, listening off',
  startSettings.directions.recognition && startSettings.directions.production && !startSettings.directions.listening);

const cardsNow = await deck.getDeck();
const peopleDeck = content.byCategory.get('words-people');
check('each word gets a recognition and a production card',
  peopleDeck.items.every((w) => cardsNow.some((c) => c.id === w.id) &&
    cardsNow.some((c) => c.id === `${w.id}~p` && c.dir === 'production' && c.itemId === w.id)),
  `${cardsNow.filter((c) => c.categoryId === 'words-people').length} cards for ${peopleDeck.items.length} words`);
check('…and no listening card while listening is off', !cardsNow.some((c) => srs.dirOf(c) === srs.DIR.LISTENING));

// The sibling rule, end to end: with no daily cap in the way, a deck's queue
// offers a new production card only once its recognition card has been seen.
await deck.saveSettings({ newPerDay: 1000 });
const recognitionState = (cards) =>
  new Map(cards.filter((c) => srs.dirOf(c) === srs.DIR.RECOGNITION).map((c) => [srs.itemIdOf(c), c.state]));
const verbsBefore = await deck.queue('words-verbs');
const statesBefore = recognitionState(await deck.getDeck());
check('a new production card waits for its recognition card',
  verbsBefore.length > 0 && verbsBefore.every((c) =>
    srs.dirOf(c) !== srs.DIR.PRODUCTION || c.state !== 'new' || statesBefore.get(srs.itemIdOf(c)) !== 'new'),
  `${verbsBefore.length} cards offered`);
const firstVerb = verbsBefore.find((c) => srs.dirOf(c) === srs.DIR.RECOGNITION && c.state === 'new');
await deck.grade(firstVerb.id, srs.GRADE.GOOD);
check('…and is offered once the word has been seen',
  (await deck.queue('words-verbs')).some((c) => c.id === srs.cardId(firstVerb.itemId, srs.DIR.PRODUCTION)),
  firstVerb.itemId);

// With recognition switched off there is nothing to wait for.
await deck.saveSettings({ directions: { recognition: false, production: true, listening: false } });
const foodAdded = await deck.activateCategory('words-food');
const productionOnly = await deck.queue('words-food');
check('with recognition off, a deck is added as production cards only',
  foodAdded.added === content.byCategory.get('words-food').items.length, `+${foodAdded.added}`);
check('…and they are offered straight away rather than waiting forever',
  productionOnly.length === foodAdded.added && productionOnly.every((c) => srs.dirOf(c) === srs.DIR.PRODUCTION),
  `${productionOnly.length} offered`);
await deck.saveSettings({ directions: { recognition: true, production: true, listening: false } });
check('switching recognition back on adds the missing recognition cards',
  (await deck.syncDirections()) === foodAdded.added);
await deck.saveSettings({ newPerDay: startSettings.newPerDay });

// Listening on: every active item with audio gains a listening card.
await deck.saveSettings({ directions: { recognition: true, production: true, listening: true } });
const addedListening = await deck.syncDirections();
const activeItems = (await deck.getSettings()).activeCategories.flatMap((id) => content.byCategory.get(id)?.items || []);
check('switching listening on adds a card for every active item with audio',
  addedListening > 0 && addedListening === activeItems.filter((i) => deck.hasAudio(i)).length, `+${addedListening}`);
check('…and syncing again adds nothing', (await deck.syncDirections()) === 0);

// "I can read this".
const { furiganaMode } = await import('../js/render.js');
await deck.setReadable('w-iku', true);
const withReadable = { ...(await deck.getSettings()), readable: await deck.getReadable() };
check('"I can read this" drops one item\'s furigana to tap-to-show',
  furiganaMode(withReadable, iku) === 'tap' && furiganaMode(withReadable, content.phrases.get('w-miru')) === 'always');
check('…unless furigana is hidden altogether', furiganaMode({ ...withReadable, furiganaMode: 'hidden' }, iku) === 'hidden');
await deck.setReadable('w-iku', false);
check('…and unmarking it brings the furigana back', !(await deck.getReadable()).has('w-iku'));

// Your own words.
const { USER_DECK } = await import('../js/content.js');
await deck.saveUserItem({
  id: 'u-test', kind: 'sentence', target: '今日は暑いね', reading: 'きょうはあついね',
  furigana: '{今日|きょう}は{暑|あつ}いね', meaning: 'Hot today, isn\'t it', note: 'Every summer morning', audioMode: 'none',
});
const withMine = await loadContent();
check('your own sentence joins the content as the "mine" deck',
  withMine.phrases.get('u-test')?.source === 'user' && withMine.byCategory.get(USER_DECK).items.length === 1);
check('…its furigana is parsed like any other', withMine.phrases.get('u-test').ruby?.[0]?.r === 'きょう');
check('…the deck is switched on by the first add', (await deck.getSettings()).activeCategories.includes(USER_DECK));
check('…it gets recognition and production cards',
  Boolean(await deck.getCard('u-test')) && Boolean(await deck.getCard('u-test~p')));
check('…but no listening card: it has no audio', !(await deck.getCard('u-test~l')));
await deck.setRecording('u-test', 'data:audio/webm;base64,AAAA');
await deck.saveUserItem({ id: 'u-test', audioMode: 'recording' });
check('recording it adds the listening card', Boolean(await deck.getCard('u-test~l')));
check('the recording is kept with the course', (await deck.getRecording('u-test')) === 'data:audio/webm;base64,AAAA');
await deck.setRecording('u-test', null);
await deck.saveUserItem({ id: 'u-test', audioMode: 'none' });
check('removing the audio removes the listening card again', !(await deck.getCard('u-test~l')));
check('your own words are studied like any other deck', (await deck.queue(USER_DECK)).some((c) => c.id === 'u-test'));
await deck.deleteUserItem('u-test');
check('deleting one removes its cards and recording',
  !(await deck.getCard('u-test')) && !(await deck.getCard('u-test~p')) && !(await deck.getRecording('u-test')));
check('…and it leaves the content', !(await loadContent()).phrases.has('u-test'));

// Listening off again: its cards are parked, not deleted.
await deck.saveSettings({ directions: { recognition: true, production: true, listening: false } });
check('switching listening off parks its cards rather than deleting them',
  (await deck.queue()).every((c) => srs.dirOf(c) !== srs.DIR.LISTENING) &&
  (await deck.getDeck()).some((c) => srs.dirOf(c) === srs.DIR.LISTENING));

/* ---------- 10. connectors ---------- */

console.log('\n10. Connectors — lessons, drills, misses into the deck');

const drills = await import('../js/drills.js');
const lessons = content.lessons;
check('every connector lesson loads', lessons.length === content.manifest.lessons.length && lessons.every((l) => !l.missing),
  lessons.map((l) => l.connector).join(' '));
check('the course knows it has connectors', content.features.lessons === true);
check('the sixteen connectors asked for are all there',
  ['〜て', 'から', 'ので', 'けど', 'が', 'でも', 'だから', 'それから', 'そして', 'と', 'たら', 'ば', 'し', 'ために', 'とき', 'ながら']
    .every((c) => lessons.some((l) => l.connector === c)));
check('each lesson explains itself and says when it sounds natural or stiff',
  lessons.every((l) => l.explanation && l.natural && l.stiff && l.pattern));
check('each lesson has 3–5 example sentences with audio, and furigana on every kanji',
  lessons.every((l) => l.items.length >= 3 && l.items.length <= 5 &&
    l.items.every((x) => x.kind === 'sentence' && x.audio &&
      (x.ruby || [{ b: x.target }]).every((seg) => seg.r || !/[㐀-鿿豈-﫿々]/u.test(seg.b)))));
check('examples reuse the word decks\' words', (content.usage.get('w-ame') || []).includes('cx-kara-1'),
  (content.usage.get('w-ame') || []).join(', '));

const kara = content.byCategory.get('con-kara');
const kara1 = kara.items[0];
check('a fill-in gap is the sentence around the connector',
  kara1.gap.before.target + kara1.gap.answer.target + kara1.gap.after.target === kara1.target,
  `${kara1.gap.before.target}［${kara1.gap.answer.target}］${kara1.gap.after.target}`);
check('…its options carry their verdicts: one right, ので also right, the rest wrong',
  kara1.gap.options.filter((o) => o.verdict === 'right').length === 1 &&
  kara1.gap.options.find((o) => o.target === 'ので')?.verdict === 'ok' &&
  kara1.gap.options.find((o) => o.target === 'けど')?.verdict === 'wrong');

const karaDrills = drills.drillsFor(kara);
check('a lesson makes all three kinds of drill',
  drills.DEFAULT_DRILLS.every((type) => karaDrills.some((d) => d.type === type)),
  Object.values(drills.DRILL).map((type) => `${type} ${karaDrills.filter((d) => d.type === type).length}`).join(', '));
check('…and no say-it drills: this course\'s manifest doesn\'t ask for them',
  !content.manifest.drills && !karaDrills.some((d) => d.type === drills.DRILL.SAY));
const session = drills.buildSession([kara]);
check('a lesson session uses every drill once', session.length === karaDrills.length);
// Every lesson, many shuffles: the same sentence is never asked twice in a row.
const spreadOk = lessons.every((l) => Array.from({ length: 25 }, (_, i) => {
  let seed = i + 1;
  const s = drills.buildSession([l], { random: () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) });
  return s.every((d, j) => j === 0 || d.ex.id !== s[j - 1].ex.id);
}).every(Boolean));
check('…and never the same sentence twice in a row', spreadOk);
check('a mixed session is capped', drills.buildSession(lessons, { size: 12 }).length === 12);

const orderDrill = karaDrills.find((d) => d.type === drills.DRILL.ORDER);
const tiles = drills.tilesFor(orderDrill);
const ordered = [...tiles].sort((a, b) => a.chunk - b.chunk);
check('order tiles never start out already in order',
  Array.from({ length: 30 }, () => drills.tilesFor(orderDrill)).every((ts) => !drills.checkTiles(orderDrill, ts)));
check('putting the pieces in order is right', drills.checkTiles(orderDrill, ordered));
check('…leaving one out is wrong', !drills.checkTiles(orderDrill, ordered.slice(1)));
const shi = content.byCategory.get('con-shi').items[0];
const shiDrill = { type: drills.DRILL.ORDER, ex: shi };
check('a sentence that allows two orders accepts both',
  drills.checkTiles(shiDrill, [0, 1, 2, 3].map((chunk) => ({ chunk }))) &&
  drills.checkTiles(shiDrill, [0, 2, 1, 3].map((chunk) => ({ chunk }))) &&
  !drills.checkTiles(shiDrill, [1, 0, 2, 3].map((chunk) => ({ chunk }))));
const combineDrill = karaDrills.find((d) => d.type === drills.DRILL.COMBINE);
const combineTiles = drills.tilesFor(combineDrill);
check('combine tiles include the traps', combineTiles.some((tile) => tile.trap !== undefined));
const realPieces = combineTiles.filter((tile) => tile.trap === undefined).sort((a, b) => a.chunk - b.chunk);
check('combining with the real pieces is right', drills.checkTiles(combineDrill, realPieces));
check('…and using a trap is wrong',
  !drills.checkTiles(combineDrill, [combineTiles.find((tile) => tile.trap !== undefined), ...realPieces.slice(1)]));

// A missed drill puts its sentence in the deck, due again within minutes.
check('a sentence is not in the deck before it is missed', !(await deck.getCard('cx-kara-2')));
const missed = await deck.recordMiss('cx-kara-2', 'con-kara');
check('missing it adds its cards, the "say it" one failed',
  missed?.id === 'cx-kara-2~p' && missed.state === 'learning' && Boolean(await deck.getCard('cx-kara-2')),
  `${missed?.id} ${missed?.state}`);
check('…so it comes back within the hour, not days later',
  missed.due - Date.now() <= srs.DAY / 24 && srs.dueCards([missed], Date.now() + srs.DAY / 24).length === 1);
check('…and the lesson counts as a deck you study', (await deck.getSettings()).activeCategories.includes('con-kara'));
check('only the missed sentence was added, not the whole lesson', !(await deck.getCard('cx-kara-3')));
const karaRest = await deck.activateCategory('con-kara');
check('"Study as cards" then adds the rest of the lesson',
  karaRest.added === (kara.items.length - 1) * 2 && Boolean(await deck.getCard('cx-kara-3')), `+${karaRest.added}`);

const drillsBefore = (await deck.todayStats()).drills;
await deck.recordPractice({ 'con-kara': { right: 7, total: 10 }, 'con-node': { right: 4, total: 4 } });
await deck.recordPractice({ 'con-kara': { right: 9, total: 10 } });
const lessonStats = await deck.getLessonStats();
check('practice is recorded per lesson, keeping the best session',
  lessonStats['con-kara'].sessions === 2 && lessonStats['con-kara'].best.right === 9 && lessonStats['con-node'].best.total === 4,
  JSON.stringify(lessonStats['con-kara']));
check('drills count toward the day', (await deck.todayStats()).drills === drillsBefore + 24);

/* ---------- 11. reading progression ---------- */

console.log('\n11. Reading progression — kana mastery and the daily drill');

const kana = await import('../js/kana.js');
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const hiraSet = content.bySet.get('hiragana');
const kataSet = content.bySet.get('katakana');
const hiraCore = kana.coreOf(hiraSet);

const fresh = kana.kanaProgress(content.characterSets, {});
check('each script has 71 core kana: the 46 base and 25 with ゛ or ゜',
  fresh.hiragana.total === 71 && fresh.katakana.total === 71, `${fresh.hiragana.total}/${fresh.katakana.total}`);
check('a new learner starts on hiragana', kana.focusScript(fresh) === 'hiragana' && fresh.hiragana.mastered === 0);

const firstDrill = kana.buildKanaDrill(hiraSet, {}, { random: seeded(1) });
check('the first drill meets one row of new kana, in teaching order',
  firstDrill.intros.map((c) => c.character).join('') === 'あいうえお', firstDrill.intros.map((c) => c.character).join(''));
check('…and asks each of them', firstDrill.questions.length === 5 &&
  firstDrill.intros.every((c) => firstDrill.questions.some((q) => q.char.id === c.id)));
const allQuestions = Array.from({ length: 40 }, (_, i) => kana.buildKanaDrill(hiraSet, {}, { random: seeded(i + 2) }).questions).flat();
check('every question has four different options, one of them right',
  allQuestions.every((q) => q.options.length === 4 && new Set(q.options.map((o) => o.id)).size === 4 &&
    q.options.filter((o) => o.id === q.char.id).length === 1));
check('both kinds of question come up: what it says, and which one you heard',
  allQuestions.some((q) => q.type === 'read') && allQuestions.some((q) => q.type === 'listen'));
const wo = hiraCore.find((c) => c.character === 'を');
const woDrills = Array.from({ length: 60 }, (_, i) => kana.buildKanaDrill(hiraSet,
  Object.fromEntries(hiraCore.map((c) => [c.id, { right: 1, wrong: 0, streak: 1, days: ['2026-10-01'], last: i }])),
  { random: seeded(100 + i), size: 71 }).questions).flat();
check('no question offers two kana that sound the same (お/を, じ/ぢ, ず/づ)',
  woDrills.every((q) => new Set(q.options.map((o) => (o.romaji === 'wo' ? 'o' : o.romaji))).size === q.options.length),
  `${woDrills.length} questions, を asked ${woDrills.filter((q) => q.char.id === wo.id).length} times`);

let record = kana.nextStat(null, true, '2026-10-01');
record = kana.nextStat(record, true, '2026-10-01');
record = kana.nextStat(record, true, '2026-10-01');
check('three right on the same day is not mastery yet', record.streak === 3 && !kana.drillMastered(record));
record = kana.nextStat(record, true, '2026-10-02');
check('…a fourth the next day is', kana.drillMastered(record), JSON.stringify(record.days));
record = kana.nextStat(record, false, '2026-10-03');
check('one miss starts it over', record.streak === 0 && record.days.length === 0 && !kana.drillMastered(record));
const matureCard = { ...srs.newCard('hira-ka', 'hiragana', Date.now(), { kind: srs.KIND.CHARACTER }), state: 'review', interval: 9 };
check('a character card at a week-long interval counts as mastered',
  kana.masteryOf({}, new Map([['hira-ka', matureCard]]))(hiraCore.find((c) => c.id === 'hira-ka')));

// Pacing: half speed until most answers are right, then a row or two at a time — never too many half-learned.
const goodRun = Object.fromEntries(hiraCore.slice(0, 5).map((c) => [c.id, { right: 3, wrong: 0, streak: 1, days: ['2026-10-01'], last: 1 }]));
check('once the answers are mostly right, new kana come in faster',
  kana.buildKanaDrill(hiraSet, goodRun, { random: seeded(7) }).intros.length === 10);
const halfLearned = Object.fromEntries(hiraCore.slice(0, 20).map((c) => [c.id, { right: 3, wrong: 0, streak: 1, days: ['2026-10-01'], last: 1 }]));
check('with twenty half-learned, nothing new is added', kana.buildKanaDrill(hiraSet, halfLearned, { random: seeded(8) }).intros.length === 0);
const mostlyKnown = Object.fromEntries(hiraCore.slice(0, 60).map((c) => [c.id, { right: 4, wrong: 0, streak: 4, days: ['2026-10-01', '2026-10-02'], last: 1 }]));
const lateDrill = kana.buildKanaDrill(hiraSet, mostlyKnown, { random: seeded(9) });
check('mastered kana still come up now and then, so they stay mastered',
  lateDrill.questions.some((q) => mostlyKnown[q.char.id]) && lateDrill.intros.length > 0,
  `${lateDrill.intros.length} new, ${lateDrill.questions.filter((q) => mostlyKnown[q.char.id]).length} refreshers`);

const masteredAll = (chars) => Object.fromEntries(chars.map((c) => [c.id, { right: 4, wrong: 0, streak: 4, days: ['2026-10-01', '2026-10-02'], last: 1 }]));
const hiraDone = kana.kanaProgress(content.characterSets, masteredAll(hiraCore.slice(0, 64)));
check('90% of the core masters a script', hiraDone.hiragana.done && hiraDone.hiragana.mastered === 64);
check('…and the drill moves on to katakana', kana.focusScript(hiraDone) === 'katakana');
check('with both mastered there is no daily drill',
  kana.focusScript(kana.kanaProgress(content.characterSets, masteredAll([...hiraCore, ...kana.coreOf(kataSet)]))) === null);
check('a hiragana reading over katakana is recognised as a reading aid',
  kana.isKatakanaAid({ b: 'コーヒー', r: 'こーひー' }) && !kana.isKatakanaAid({ b: '今日', r: 'きょう' }) &&
  !kana.isKatakanaAid({ b: 'こーひー' }));

// Stored per course, and counted toward the day.
await deck.recordKana('hira-a', true);
await deck.recordKana('hira-i', false);
const storedKana = await deck.getKanaStats();
check('kana answers are stored', storedKana['hira-a'].streak === 1 && storedKana['hira-i'].wrong === 1);
const drillsBeforeKana = (await deck.todayStats()).drills;
check('no kana drill done today yet', !(await deck.kanaDrillToday()).done);
await deck.finishKanaDrill(15, 'hiragana');
check('finishing one marks the day, and which script', (await deck.kanaDrillToday()).script === 'hiragana' &&
  (await deck.todayStats()).drills === drillsBeforeKana + 15);

/* ---------- 12. a second course ---------- */

console.log('\n12. Second course — English for Japanese speakers (ja-en)');

const course = await import('../js/course.js');
const store = await import('../js/store.js');
const i18n = await import('../js/i18n.js');

const enJaCards = (await deck.getDeck()).length;
const enJaReviews = (await deck.todayStats()).reviews;

await course.setCourse('ja-en');
check('switching course switches storage', store.namespace() === 'ja-en');
check('switching course switches the interface to the speaker\'s language', i18n.getLang() === 'ja');

const en = await loadContent();
check('ja-en loads its own manifest', en.manifest.language === 'en' && en.categories.length === 10,
  `${en.categories.length} categories, ${en.phrases.size} phrases`);
check('every ja-en category loaded with phrases', en.categories.every((c) => !c.missing && c.phrases.length > 0));

const wake = en.phrases.get('hot-03');
check('the text being learned is English', wake.target === 'Could I get a wake-up call at seven?' && wake.targetLang === 'en',
  wake.target);
check('the meaning is Japanese', wake.meaning.includes('モーニングコール') && wake.meaningLang === 'ja', wake.meaning);
check('English carries no furigana or romaji', wake.ruby === null && wake.reading === null);
check('notes use this course\'s own labels', wake.notes.map((n) => n.label).join(',') === '使い方,よくある間違い',
  wake.notes.map((n) => n.label).join(', '));
check('features: scenarios, word decks and phrase patterns yes; characters, furigana, romaji no',
  en.features.scenarios && en.features.words && en.features.lessons &&
  !en.features.characters && !en.features.ruby && !en.features.reading);

const flatWhite = en.phrases.get('w-flat-white');
check('ja-en word decks hold English words with Japanese meanings',
  flatWhite?.kind === 'word' && flatWhite.target === 'flat white' && flatWhite.targetLang === 'en' &&
  flatWhite.meaning.startsWith('フラットホワイト') && flatWhite.pos === 'noun', flatWhite?.target);
check('…with their notes under the course\'s own labels', flatWhite.notes[0]?.label === '使い方',
  flatWhite.notes.map((n) => n.label).join(', '));
check('every ja-en word and sentence deck loads',
  en.decks.length === en.manifest.decks.length && en.decks.every((d) => !d.missing && d.items.length > 0) &&
    en.decks.filter((d) => d.type === 'words').length === 8 && en.decks.some((d) => d.type === 'sentences'),
  en.decks.map((d) => `${d.id} ${d.items.length}`).join(', '));
check('…the everyday words among them', ['w-get', 'w-pick-up', 'w-gst', 'w-power-point', 'w-kia-ora']
  .every((id) => en.phrases.get(id)?.kind === 'word'));
check('a word that means something else in katakana says so',
  en.phrases.get('w-complaint')?.notes.some((n) => n.label === 'よくある間違い' && n.text.includes('クレーム')));
const everyday = en.byCategory.get('sentences-everyday');
check('everyday sentences are cut into pieces linked to the words they use',
  everyday.items.every((s) => s.kind === 'sentence' && s.chunks.map((c) => c.target).join('') === s.target &&
    s.chunks.some((c) => c.w && en.phrases.get(c.w)?.kind === 'word')),
  `${everyday.items.length} sentences`);

const patterns = en.lessons;
check('the lessons load — patterns, polite phrasing, linking words, word order — each with 3–5 examples with audio',
  patterns.length === en.manifest.lessons.length && patterns.length === 30 &&
    patterns.every((l) => !l.missing && l.items.length >= 3 && l.items.length <= 5 &&
      l.items.every((x) => x.audio && x.targetLang === 'en')),
  patterns.map((l) => l.connector).join(' '));
check('…in the five groups the manifest names',
  en.lessonGroups.map((g) => g.id).join(',') === 'ask,question,polite,link,order' &&
    en.lessonGroups.every((g) => patterns.some((l) => l.group === g.id)));
const like1 = en.byCategory.get('pat-like').items[0];
check('a pattern gap is the English sentence around it',
  like1.gap.before.target + like1.gap.answer.target + like1.gap.after.target === like1.target,
  `${like1.gap.before.target}［${like1.gap.answer.target}］${like1.gap.after.target}`);
check('…its options carry their verdicts', like1.gap.options.filter((o) => o.verdict === 'right').length === 1 &&
  like1.gap.options.find((o) => o.target === 'I like')?.verdict === 'wrong');
check('pattern examples link the words they use', (en.usage.get('w-flat-white') || []).includes('px-like-1'),
  (en.usage.get('w-flat-white') || []).join(', '));
const likeDrills = drills.drillsFor(en.byCategory.get('pat-like'));
const like = en.byCategory.get('pat-like');
check('a pattern lesson makes fill-in, order and say-it drills — one say-it per example',
  [drills.DRILL.FILL, drills.DRILL.ORDER, drills.DRILL.SAY].every((type) => likeDrills.some((d) => d.type === type)) &&
    likeDrills.filter((d) => d.type === drills.DRILL.SAY).length === like.items.length,
  Object.values(drills.DRILL).map((type) => `${type} ${likeDrills.filter((d) => d.type === type).length}`).join(', '));
const likeOrder = likeDrills.find((d) => d.type === drills.DRILL.ORDER);
check('English pieces put in order are right',
  drills.checkTiles(likeOrder, [...drills.tilesFor(likeOrder)].sort((a, b) => a.chunk - b.chunk)));
const soDrills = drills.drillsFor(en.byCategory.get('con-so'));
check('a linking-word lesson makes all four kinds of drill, joining sentences with "so" among them',
  Object.values(drills.DRILL).every((type) => soDrills.some((d) => d.type === type)),
  Object.values(drills.DRILL).map((type) => `${type} ${soDrills.filter((d) => d.type === type).length}`).join(', '));
const soCombine = soDrills.find((d) => d.type === drills.DRILL.COMBINE);
const soTiles = drills.tilesFor(soCombine);
check('…where "because" is the trap',
  soTiles.some((tile) => tile.trap !== undefined && tile.target.trim() === 'because') &&
    drills.checkTiles(soCombine, soTiles.filter((tile) => tile.trap === undefined).sort((a, b) => a.chunk - b.chunk)));
const nonegative = en.byCategory.get('con-negative').items[0];
check('a yes/no answer to a negative question is a gap of its own, with the reason given',
  nonegative.gap.answer.target === 'No' && nonegative.gap.options.find((o) => o.target === 'Yes')?.verdict === 'wrong' &&
    nonegative.gap.why.includes('否定'));
check('a course nobody has opened is not onboarded', !(await deck.isOnboarded()));
check('…and starts with an empty deck', (await deck.getDeck()).length === 0);

const enItems = await quiz.buildPlacementSet();
check('placement samples every ja-en category', new Set(enItems.map((i) => i.categoryId)).size === 10,
  `${enItems.length} items`);
check('placement has no character items', enItems.every((i) => i.kind === 'phrase'));
await quiz.applyPlacement(enItems, Object.fromEntries(enItems.map((i) => [i.id, quiz.ANSWERS.UNKNOWN])));
check('ja-en is onboarded on its own', await deck.isOnboarded());
check('week-1 categories activated in ja-en',
  (await deck.getSettings()).activeCategories.join(',') === 'greetings,numbers,restaurant,shopping,words-cafe,words-shopping,words-verbs',
  (await deck.getSettings()).activeCategories.join(','));

const enQueue = await deck.queue();
check('ja-en has its own review queue', enQueue.length > 0 && enQueue.every((c) => en.phrases.has(c.id)),
  `${enQueue.length} cards`);
await deck.grade(enQueue[0].id, srs.GRADE.GOOD);
check('grading in ja-en counts in ja-en', (await deck.todayStats()).reviews === 1);
check('ja-en writes under its own storage prefix', [...mem.keys()].some((k) => k.startsWith('ww-ja-en:srs:')));

// Listening: lines said back and sound pairs, drilled daily, mastered over days.
const listening = await import('../js/listening.js');
const listenItems = listening.listeningItems(en.listening);
check('the listening content loads: lines said back, and pairs of sounds',
  en.features.listening && listenItems.filter((i) => i.kind === 'reply').length === 30 &&
    listenItems.filter((i) => i.kind === 'contrast').length === 36,
  `${listenItems.length} items`);
const takeaway = listenItems.find((i) => i.id === 'lr-01');
check('a line said back is English, with its meaning and something to say in return',
  takeaway.target === 'Eat in or takeaway?' && takeaway.meaningLang === 'ja' &&
    takeaway.reply?.target === 'Takeaway, please.' && takeaway.reply.meaningLang === 'ja');
const fifteen = listenItems.find((i) => i.id === 'lc-teen-fifteen-dollars');
check('a word in a sound pair knows its partner', fifteen.partner.target === "That's fifty dollars." && fifteen.pair.includes(fifteen));
check('listening items are not flashcards', !en.phrases.has('lr-01') && !en.phrases.has('lc-lr-light'));
let listenSeed = 11;
const listenRandom = () => ((listenSeed = (listenSeed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const firstListen = listening.buildListeningDrill(listenItems, {}, { random: listenRandom });
check('a first listening drill is a handful of new items, of both kinds',
  firstListen.length === 6 && firstListen.some((q) => q.type === 'reply') && firstListen.some((q) => q.type === 'contrast'),
  firstListen.map((q) => q.item.id).join(' '));
check('…a reply offering its own meaning among two others',
  firstListen.filter((q) => q.type === 'reply').every((q) => q.options.length === 3 &&
    q.options.filter((o) => o.id === q.item.id).length === 1 && new Set(q.options.map((o) => o.meaning)).size === 3));
check('…a sound offering the two words of its pair',
  firstListen.filter((q) => q.type === 'contrast').every((q) => q.options.length === 2 && q.options.includes(q.item)));
await deck.recordListen('lr-01', true);
await deck.recordListen('lr-02', false);
const listenStats = await deck.getListenStats();
check('listening answers are recorded per item — a miss starts over',
  listenStats['lr-01'].streak === 1 && listenStats['lr-02'].streak === 0 && listenStats['lr-02'].wrong === 1);
const nextListen = listening.buildListeningDrill(listenItems, listenStats, { random: listenRandom });
check('…and the next drill brings them back, with new ones beside them',
  ['lr-01', 'lr-02'].every((id) => nextListen.some((q) => q.item.id === id)) && nextListen.length === 8,
  `${nextListen.length} questions`);
const masteredListen = { 'lr-03': { right: 3, wrong: 0, streak: 3, days: ['2026-10-01', '2026-10-02'], last: Date.now() } };
check('three right in a row, on two different days, masters an item',
  listening.listeningProgress(listenItems, masteredListen).mastered === 1 &&
    listening.listeningProgress(listenItems, { 'lr-03': { ...masteredListen['lr-03'], days: ['2026-10-02'] } }).mastered === 0);
check('…and a mastered item still comes up now and then',
  listening.buildListeningDrill(listenItems, masteredListen, { random: listenRandom }).some((q) => q.item.id === 'lr-03'));
const listenDrillsBefore = (await deck.todayStats()).drills;
await deck.finishListenDrill(8);
check('a finished listening drill marks today done, and counts toward the day',
  (await deck.listenDrillToday()) && (await deck.todayStats()).drills === listenDrillsBefore + 8);

const imm = await loadScenario('immigration');
check('ja-en scenario NPC lines are English with Japanese meanings',
  imm.nodes.n1.target === 'Next, please. Good afternoon.' && imm.nodes.n1.meaning.startsWith('次の方'),
  imm.nodes.n1.target);
const bus = await loadScenario('bus');
check('scenario narration is in the learner\'s language', bus.nodes.n1.target === '' && /[ぁ-ん]/.test(bus.nodes.n1.meaning));
const enScenarios = await Promise.all(en.manifest.scenarios.map((s) => loadScenario(s.id)));
check('every ja-en scenario option resolves to text or a deck phrase',
  enScenarios.every((s) => Object.values(s.nodes).every((n) =>
    n.options.every((o) => (o.phraseId ? en.phrases.has(o.phraseId) : Boolean(o.target))))),
  enScenarios.map((s) => s.id).join(', '));
check('the customer-side scenarios are there', ['cafe', 'clothes', 'bakery'].every((id) => enScenarios.some((s) => s.id === id)));

await course.setCourse('en-ja');
check('switching back restores storage and interface', store.namespace() === 'en-ja' && i18n.getLang() === 'en');
check('the Japanese deck is untouched by English study', (await deck.getDeck()).length === enJaCards,
  `${enJaCards} cards before and after`);
check('the Japanese course\'s stats exclude the English review', (await deck.todayStats()).reviews === enJaReviews,
  `${enJaReviews} before and after`);
check('the Japanese course is still onboarded', await deck.isOnboarded());
check('the Japanese course still uses the legacy nt: storage prefix', [...mem.keys()].some((k) => k.startsWith('nt:srs:')));

const snap = await deck.courseSnapshot('ja-en');
check('the home page can read a course without switching to it',
  snap.onboarded && snap.total > 0 && store.namespace() === 'en-ja', JSON.stringify(snap));
const keysBefore = mem.size;
const empty = await deck.courseSnapshot('en-id');
check('a snapshot of an unopened course is empty and writes nothing',
  !empty.onboarded && empty.due === 0 && empty.total === 0 && mem.size === keysBefore);

await course.setCourse('ja-en');
await deck.resetEverything();
check('resetting ja-en clears it', !(await deck.isOnboarded()) && (await deck.getDeck()).length === 0);
await course.setCourse('en-ja');
check('…and leaves the Japanese course alone',
  (await deck.getDeck()).length === enJaCards && (await deck.isOnboarded()));

/* ---------- 13. data safety ---------- */

console.log('\n13. Data safety — backup and restore');

const backup = await import('../js/backup.js');
// A little of everything worth keeping: one of your own words with a recording, progress in a second course.
await deck.saveUserItem({ id: 'u-keep', kind: 'word', target: '猫', reading: 'ねこ', furigana: '{猫|ねこ}', meaning: 'cat', audioMode: 'recording' });
await deck.setRecording('u-keep', 'data:audio/webm;base64,KEEP');
await course.setCourse('ja-en');
await deck.saveSettings({ newPerDay: 7 });
await course.setCourse('en-ja');
const cardsBeforeBackup = (await deck.getDeck()).length;

const saved = JSON.parse(JSON.stringify(await backup.exportAll())); // as it would come back from a file
const enJa = saved.namespaces['en-ja'];
check('a backup is one object, marked as a Wayword backup', saved.format === 'wayword-backup' && saved.version === 1 &&
  backup.validateBackup(saved).ok);
check('it holds every course with progress', Boolean(enJa) && Boolean(saved.namespaces['ja-en']),
  Object.keys(saved.namespaces).join(', '));
check('…every card', Object.keys(enJa.srs).length === cardsBeforeBackup, `${Object.keys(enJa.srs).length} cards`);
check('…settings, placement, stats, readings marked, connector and kana records',
  ['settings', 'placement', 'stats', 'lessonStats', 'kanaStats'].every((k) => k in enJa.meta),
  Object.keys(enJa.meta).filter((k) => !k.startsWith('rec:')).join(', '));
check('…and your own words with their recordings',
  enJa.meta.userItems.some((u) => u.id === 'u-keep') && enJa.meta['rec:u-keep'] === 'data:audio/webm;base64,KEEP');
check('it is named for the day it was made', backup.fileName(saved) === `wayword-backup-${saved.exportedAt.slice(0, 10)}.json`);
check('the restore prompt can say what is in it',
  backup.summarise(saved).find((x) => x.course === 'en-ja')?.cards === cardsBeforeBackup &&
  backup.summarise(saved).find((x) => x.course === 'en-ja')?.mine === 1);

// Files that aren't backups are turned away before anything is touched.
const verdict = (data) => backup.validateBackup(data).reason;
check('a file that isn\'t a backup is refused', verdict(null) === 'notBackup' && verdict({ hello: 1 }) === 'notBackup' &&
  verdict({ ...saved, namespaces: {} }) === 'notBackup' &&
  verdict({ ...saved, namespaces: { '../x': { meta: {}, srs: {} } } }) === 'notBackup' &&
  verdict({ ...saved, namespaces: { 'en-ja': { meta: {}, srs: { a: { noId: true } } } } }) === 'notBackup');
check('a backup from a newer version is refused, with its own reason', verdict({ ...saved, version: 2 }) === 'newer');

// Lose the course, then restore it.
await deck.resetEverything();
check('after a reset the Japanese course is empty', (await deck.getDeck()).length === 0 && !(await deck.isOnboarded()));
await course.setCourse('ja-en');
await deck.saveSettings({ newPerDay: 9 }); // changed since the backup — but the backup holds ja-en too
await course.setCourse('en-ja');
await backup.importBackup(saved);
check('restoring brings every card back', (await deck.getDeck()).length === cardsBeforeBackup);
check('…and placement, so there\'s no quiz again', await deck.isOnboarded());
check('…and your own words and recordings',
  (await deck.getUserItems()).some((u) => u.id === 'u-keep') && (await deck.getRecording('u-keep')) === 'data:audio/webm;base64,KEEP');
check('…and the other course, as it was in the backup', (await store.get('meta', 'settings', 'ja-en')).newPerDay === 7);

const undo = await backup.undoInfo();
check('the restore can be undone', Boolean(undo?.at) && undo.restored === saved.exportedAt);
await backup.undoRestore();
check('undoing puts back what was there before it', (await deck.getDeck()).length === 0 &&
  (await store.get('meta', 'settings', 'ja-en')).newPerDay === 9 && !(await backup.undoInfo()));

// A backup that holds one course leaves the others alone.
const onlyJapanese = { ...saved, namespaces: { 'en-ja': saved.namespaces['en-ja'] } };
await backup.importBackup(onlyJapanese);
check('a course the backup doesn\'t hold is left as it is',
  (await deck.getDeck()).length === cardsBeforeBackup && (await store.get('meta', 'settings', 'ja-en')).newPerDay === 9);

/* ---------- result ---------- */

console.log(
  failures
    ? `\n✗ ${failures} of ${checks} integration checks failed\n`
    : `\n✓ all ${checks} integration checks passed — browse → quiz → study → review → scenarios → characters loop is intact, in both courses\n`
);
process.exit(failures ? 1 : 0);
