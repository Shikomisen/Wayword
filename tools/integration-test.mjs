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
check('…while elsewhere a phrase is polite, or casual with its polite version beside it',
  content.categories.filter((c) => c.id !== 'casual').every((c) => c.phrases.every((p) =>
    p.register === 'polite' || (p.register === 'casual' && p.polite?.target && p.polite.audio))));

/* ---------- 2. placement quiz ---------- */

console.log('\n2. Placement quiz (§6a)');

const items = await quiz.buildPlacementSet();
// Placement samples the levels that say so: First steps and Basic, not Intermediate (README §7.10).
const { sampled } = await import('../js/levels.js');
const sampledCats = content.categories.filter((c) => sampled(content, c.level));
const sampledSets = content.characterSets.filter((x) => sampled(content, x.level));
const phraseItems = items.filter((i) => i.kind !== 'character');
const charItems = items.filter((i) => i.kind === 'character');

check('quiz pulls two phrase cards per category (§6a, A5)',
  phraseItems.length === 2 * sampledCats.length, `${phraseItems.length} phrase cards`);
check('quiz also samples two characters per set',
  charItems.length === 2 * sampledSets.length, `${charItems.length} character cards`);
check('…from First steps and Basic only, though Intermediate has categories and a kanji set',
  sampledCats.length < content.categories.length && sampledSets.length < content.characterSets.length &&
    items.every((i) => content.byCategory.get(i.categoryId)?.level !== 'intermediate' &&
      content.characterSets.find((x) => x.id === i.categoryId)?.level !== 'intermediate'),
  `${sampledCats.length} of ${content.categories.length} categories, ${sampledSets.length} of ${content.characterSets.length} sets`);

const covered = new Set(phraseItems.map((i) => i.categoryId));
check('quiz spans every phrase category it samples', covered.size === sampledCats.length, `${covered.size} covered`);

const charCovered = new Set(charItems.map((i) => i.categoryId));
check('quiz spans every character set it samples', charCovered.size === sampledSets.length, [...charCovered].join(', '));

check('quiz samples both ends of each category',
  sampledCats.every((cat) => {
    const picks = items.filter((i) => i.categoryId === cat.id);
    return picks.length === 2 && picks[0].difficulty <= picks[1].difficulty;
  }));
check('quiz samples both ends of each character set',
  sampledSets.every((set) => {
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
  Object.keys(result.perCategory).length === sampledCats.length + sampledSets.length,
  `${Object.keys(result.perCategory).length} buckets`);
check('strong category scores high', result.perCategory.greetings.score === 1, String(result.perCategory.greetings.score));
check('weak category scores low', result.perCategory.airport.score < 0.5, String(result.perCategory.airport.score));
check('onboarding gate now passes', await deck.isOnboarded());

/* ---------- 3. deck seeding ---------- */

console.log('\n3. Deck seeding (§7 — starter categories only)');

const settings = await deck.getSettings();
// Starters are phrase categories and word/sentence decks alike. With levels
// (§7.10), placement adds the starters of the level it starts the learner at.
const levelsMod = await import('../js/levels.js');
const everyDeck = [...content.categories, ...content.decks];
const starters = levelsMod.startersIn(content, result.level);
check('placement starts the learner at a level', Boolean(result.level), result.level);
check('only that level\'s starter decks are activated',
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

// Taking a deck out again: its cards stop coming up, and keep their progress.
check('a first add is not mistaken for a return, even with placement cards already there', added.readded === false);
const hotelCards = () => deck.getDeck().then((cards) => cards.filter((c) => c.categoryId === 'hotel'));
const studiedHotel = (await hotelCards()).find((c) => c.state === 'new');
await deck.grade(studiedHotel.id, srs.GRADE.GOOD);
const hotelBefore = JSON.stringify(await hotelCards());
const totalWithHotel = (await deck.deckSummary()).total;
await deck.deactivateCategory('hotel');
check('a deck can be taken out of study', !(await deck.isActive('hotel')));
check('…its cards stop coming up — not in the queue, not in the counts',
  (await deck.queue()).every((c) => c.categoryId !== 'hotel') &&
    (await deck.deckSummary()).total === totalWithHotel - (await hotelCards()).length,
  `${totalWithHotel} → ${(await deck.deckSummary()).total}`);
check('…but every card is kept, progress and all', JSON.stringify(await hotelCards()) === hotelBefore,
  `${(await hotelCards()).length} cards`);
check('…and adding directions while it is out leaves it alone', (await deck.syncDirections()) === 0);
const hotelBack = await deck.activateCategory('hotel');
check('adding it again brings it back exactly as it was, and says so',
  hotelBack.readded && hotelBack.added === 0 && (await deck.isActive('hotel')) &&
    JSON.stringify(await hotelCards()) === hotelBefore);
check('…once: adding it again later is just adding', (await deck.activateCategory('hotel')).readded === false);

/* ---------- 7. scenario trees ---------- */

console.log('\n7. Scenario dialogue trees');

const { loadScenario, scenariosFor } = await import('../js/content.js');

check('scenarios are listed in the manifest', (content.manifest.scenarios || []).length === 13,
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

// A set can come out of study and back, keeping its cards — like a deck.
const hiraCount = (await deck.getDeck()).filter((c) => c.categoryId === 'hiragana').length;
await deck.deactivateCharacterSet('hiragana');
check('a character set can be taken out: nothing of it is queued, every card kept',
  !(await deck.isSetActive('hiragana')) && (await deck.characterQueue()).length === 0 &&
    (await deck.getDeck()).filter((c) => c.categoryId === 'hiragana').length === hiraCount);
const hiraBack = await deck.activateCharacterSet('hiragana');
check('…and comes back as it was', hiraBack.readded && hiraBack.added === 0 && (await deck.characterQueue()).length === charQueue.length);

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

// Romaji: the same three modes, faded the same way.
const { romajiMode } = await import('../js/render.js');
check('romaji has furigana\'s three modes, and starts on always',
  deck.ROMAJI_MODES.join() === 'always,tap,hidden' && withReadable.romajiMode === 'always');
check('"I can read this" drops that item\'s romaji to tap-to-show too',
  romajiMode(withReadable, iku) === 'tap' && romajiMode(withReadable, content.phrases.get('w-miru')) === 'always');
check('…unless romaji is hidden altogether', romajiMode({ ...withReadable, romajiMode: 'hidden' }, iku) === 'hidden');
check('an older record, from when romaji was on or off, reads as always or hidden',
  romajiMode({ romaji: true }, iku) === 'always' && romajiMode({ romaji: false }, iku) === 'hidden');
const beforeRetiring = await deck.getSettings();
await deck.saveSettings({ romajiMode: 'always', romajiRetired: false, installedAt: Date.now() - 8 * 86400000 });
check('after the first week, romaji set to always becomes tap to show — once, and says so',
  (await deck.maybeRetireRomaji()) === true && (await deck.getSettings()).romajiMode === 'tap' &&
    (await deck.maybeRetireRomaji()) === false);
await deck.saveSettings({ romajiMode: 'hidden', romajiRetired: false });
check('…while a mode the learner chose is left alone, with nothing to say',
  (await deck.maybeRetireRomaji()) === false && (await deck.getSettings()).romajiMode === 'hidden' &&
    (await deck.getSettings()).romajiRetired === true);
await deck.saveSettings({
  romajiMode: beforeRetiring.romajiMode, romajiRetired: beforeRetiring.romajiRetired, installedAt: beforeRetiring.installedAt,
});

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

/* ---------- 11b. levels ---------- */

console.log('\n11b. Levels (§7.10)');

check('the course declares its levels, and every entry names one of them',
  content.levels.length >= 2 && [...content.categories, ...content.decks, ...content.lessons, ...content.characterSets]
    .every((d) => content.levels.some((l) => l.id === d.level)),
  content.levels.map((l) => l.id).join(' → '));
check('placement suggested the level from its overall score',
  result.level === levelsMod.suggestedLevel(content, result.overall) && result.level === 'first-steps',
  `${Math.round(result.overall * 100)}% → ${result.level}`);
check('…and it is the learner\'s level now', (await deck.getLevel()) === 'first-steps');
check('the suggestion follows the score: low → the first level, partial → the second, strong → the third, capped at the top',
  levelsMod.suggestedLevel(content, 0.1) === content.levels[0].id &&
    levelsMod.suggestedLevel(content, 0.5) === content.levels[1].id &&
    levelsMod.suggestedLevel(content, 0.9) === content.levels[Math.min(2, content.levels.length - 1)].id);

let lvl = await deck.levelState();
const firstStepsItems = levelsMod.addableIn(content, 'first-steps').flatMap((d) => d.items);
check('a level\'s progress counts its phrases, words and sentences',
  lvl.progress.total === firstStepsItems.length && lvl.progress.total > 100, `${lvl.progress.total} items`);
check('…none of them learned on day one, not even what placement seeded forward', lvl.progress.learned === 0);
check('…and its lessons, none practised yet',
  lvl.progress.lessons === levelsMod.lessonsIn(content, 'first-steps').length && lvl.progress.lessons >= 10 && lvl.progress.practised === 0,
  `${lvl.progress.lessons} lessons`);
check('the next step is the first deck on the level\'s path that isn\'t in study',
  lvl.next?.id === 'sentences-everyday', lvl.next?.id);
check('the next lesson is the level\'s first', lvl.nextLesson?.id === 'gr-desu', lvl.nextLesson?.id);
await deck.deactivateCategory('sentences-everyday');
check('a deck taken out is skipped by the next step', (await deck.levelState()).next?.id === 'words-things',
  (await deck.levelState()).next?.id);
await deck.saveSettings({ parkedDecks: (await deck.getSettings()).parkedDecks.filter((id) => id !== 'sentences-everyday') });

// Learn the whole level: every item's recognition card at a fortnight.
const learnedAt = Date.now();
for (const d of levelsMod.addableIn(content, 'first-steps')) {
  for (const item of d.items) {
    await deck.putCard(srs.seedKnown(item.id, d.id, 14, 2.6, learnedAt, { kind: item.kind || srs.KIND.PHRASE, difficulty: item.difficulty ?? 1 }));
  }
}
lvl = await deck.levelState();
check('a recognition card at a week or more counts as learned', lvl.progress.learned === lvl.progress.total,
  `${lvl.progress.learned} of ${lvl.progress.total}`);
check('…but the level isn\'t ready while its lessons are unpractised', !lvl.progress.ready);
const fsLessons = levelsMod.lessonsIn(content, 'first-steps');
await deck.recordPractice(Object.fromEntries(fsLessons.slice(0, Math.ceil(fsLessons.length * 0.8)).map((l) => [l.id, { right: 3, total: 4 }])));
lvl = await deck.levelState();
check('with 80% of the lessons practised too, the level is ready, and the next one is offered',
  lvl.progress.ready && lvl.after?.id === 'basic', `${lvl.progress.practised} of ${lvl.progress.lessons} lessons`);
check('…and the next lesson is the first one not yet practised',
  lvl.nextLesson?.id === fsLessons[Math.ceil(fsLessons.length * 0.8)]?.id, lvl.nextLesson?.id);
const movedStarters = await deck.moveToLevel('basic');
const activeAfterMove = (await deck.getSettings()).activeCategories;
check('moving up makes it the learner\'s level, and puts its starter decks in study',
  (await deck.getLevel()) === 'basic' && movedStarters.length > 0 &&
    movedStarters.every((d) => d.level === 'basic' && activeAfterMove.includes(d.id)),
  movedStarters.map((d) => d.id).join(', '));
check('a learner from before levels gets the highest level among the decks they study, saved once',
  await (async () => {
    await deck.saveSettings({ level: null });
    const inferred = await deck.getLevel();
    return inferred === 'basic' && (await deck.getSettings()).level === 'basic';
  })());
const upTo = levelsMod.levelsUpTo(content, 'first-steps');
check('levels up to one are that level and the ones below it', upTo.has('first-steps') && !upTo.has('basic'));

// Intermediate (v19): the third level, which placement doesn't sample.
check('Japanese has a third level, Intermediate, after Basic, and placement doesn\'t sample it',
  content.levels.map((l) => l.id).join() === 'first-steps,basic,intermediate' &&
    levelsMod.levelAfter(content, 'basic')?.id === 'intermediate' && !levelsMod.sampled(content, 'intermediate') &&
    levelsMod.sampled(content, 'basic'));
check('…with decks, phrases and lessons of its own, and three starters',
  levelsMod.addableIn(content, 'intermediate').length === 18 && levelsMod.lessonsIn(content, 'intermediate').length === 26 &&
    levelsMod.startersIn(content, 'intermediate').map((d) => d.id).join() === 'words-more-verbs,aizuchi,words-reactions',
  levelsMod.startersIn(content, 'intermediate').map((d) => d.id).join());
const jaListening = (await import('../js/listening.js')).listeningItems;
const heardAt = (level) => jaListening(content.listening.filter((x) => levelsMod.levelsUpTo(content, level).has(x.level)));
check('Japanese listening: nothing at First steps, the sound pairs at Basic, and the lines said back from Intermediate',
  heardAt('first-steps').length === 0 &&
    heardAt('basic').length === 30 && heardAt('basic').every((i) => i.kind === 'contrast') &&
    heardAt('intermediate').filter((i) => i.kind === 'reply').length === 32,
  `${heardAt('basic').length} at Basic, ${heardAt('intermediate').length} at Intermediate`);
const jaReply = heardAt('intermediate').find((i) => i.id === 'lr-01');
check('a Japanese line said back has furigana, and its reply is in the course\'s own fields',
  jaReply?.ruby?.some((seg) => seg.r) && jaReply.meaning === 'Do you have a points card?' &&
    jaReply.reply?.target === 'いいえ、持っていません。' && jaReply.reply.ruby?.some((seg) => seg.r === 'も') && jaReply.reply.meaning === 'No, I don’t.',
  JSON.stringify(jaReply?.reply?.ruby));
const interStarters = await deck.moveToLevel('intermediate');
check('moving up to Intermediate puts its starters in study',
  (await deck.getLevel()) === 'intermediate' && interStarters.length === 3, interStarters.map((d) => d.id).join(', '));
await deck.saveSettings({ level: 'basic' });

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
check('ja-en loads its own manifest', en.manifest.language === 'en' && en.categories.length === 16,
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
    en.decks.filter((d) => d.type === 'words').length === 24 && en.decks.filter((d) => d.type === 'sentences').length === 3 &&
    en.decks.filter((d) => d.level === 'first-steps').length === 6 && en.decks.filter((d) => d.level === 'intermediate').length === 12,
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
check('the lessons load — first-steps grammar, patterns, polite phrasing, linking words, word order, Intermediate grammar — each with 3–5 examples with audio',
  patterns.length === en.manifest.lessons.length && patterns.length === 70 &&
    patterns.filter((l) => l.level === 'first-steps').length === 18 && patterns.filter((l) => l.level === 'intermediate').length === 22 &&
    patterns.every((l) => !l.missing && l.items.length >= 3 && l.items.length <= 5 &&
      l.items.every((x) => x.audio && x.targetLang === 'en')),
  patterns.map((l) => l.connector).join(' '));
check('…in the twelve groups the manifest names, the two First-steps ones first and the five Intermediate ones last',
  en.lessonGroups.map((g) => g.id).join(',') === 'first-sentence,first-verbs,ask,question,polite,link,order,tenses,modals,conditionals,structures,conversation' &&
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
check('knowing nothing starts ja-en at First steps, with its starter decks',
  (await deck.getLevel()) === 'first-steps' &&
    (await deck.getSettings()).activeCategories.join(',') === 'greetings,numbers,words-first-people,words-first-verbs',
  (await deck.getSettings()).activeCategories.join(','));
await deck.changeStartLevel('first-steps', 'basic');
check('picking Basic instead on the results screen swaps the untouched starters for Basic\'s',
  (await deck.getLevel()) === 'basic' &&
    (await deck.getSettings()).activeCategories.slice().sort().join(',') ===
      levelsMod.startersIn(en, 'basic').map((d) => d.id).sort().join(','),
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
check('the listening content loads: lines said back (Basic and Intermediate), and pairs of sounds',
  en.features.listening && listenItems.filter((i) => i.kind === 'reply').length === 60 &&
    listenItems.filter((i) => i.kind === 'contrast').length === 36 &&
    en.listening.filter((x) => x.kind === 'replies').map((x) => x.level).join() === 'basic,intermediate',
  `${listenItems.length} items`);
check('English has a third level, Intermediate, which placement doesn\'t sample, with its path, lessons and three starters',
  en.levels.map((l) => l.id).join() === 'first-steps,basic,intermediate' && !levelsMod.sampled(en, 'intermediate') &&
    levelsMod.addableIn(en, 'intermediate').length === 18 && levelsMod.lessonsIn(en, 'intermediate').length === 22 &&
    levelsMod.startersIn(en, 'intermediate').map((d) => d.id).join() === 'words-i-feelings,reactions,words-i-social',
  levelsMod.startersIn(en, 'intermediate').map((d) => d.id).join());
check('…and a Basic learner hears only the Basic lines said back; Intermediate adds the second set',
  listening.listeningItems(en.listening.filter((x) => levelsMod.levelsUpTo(en, 'basic').has(x.level))).filter((i) => i.kind === 'reply').length === 30 &&
    listening.listeningItems(en.listening.filter((x) => levelsMod.levelsUpTo(en, 'intermediate').has(x.level))).filter((i) => i.kind === 'reply').length === 60);
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

/* ---------- 14. paste a message: the offline dictionary ---------- */

console.log('\n14. Paste a message — the offline dictionary (en-ja)');

const dictionary = await import('../js/dictionary.js');
const uiEn = JSON.parse(readFileSync(resolve(ROOT, 'content/ui/en.json'), 'utf8'));

// Offline, before the course finished downloading: no dictionary yet, and the next try starts afresh.
const realFetch = globalThis.fetch;
globalThis.fetch = async (path) => (String(path).endsWith('dictionary.json') ? { ok: false, status: 504, json: async () => null } : realFetch(path));
check('a dictionary not on the device yet loads as none, without an error', (await dictionary.loadDictionary()) === null);
globalThis.fetch = realFetch;
const dict = await dictionary.loadDictionary();
check('…and loads once it is there: JMdict\'s common words', dict?.size > 20000, `${dict?.size} entries`);
check('it carries the credit and licence its source asks for',
  dict.licence === 'CC BY-SA 4.0' && /Electronic Dictionary Research and Development Group/.test(dict.credit) &&
    dict.licenceUrl === 'https://www.edrdg.org/edrdg/licence.html');
await course.setCourse('ja-en');
check('a course without one has none', (await dictionary.loadDictionary()) === null);
await course.setCourse('en-ja');

// Inflected forms traced back to the word on the card.
const lookup = (text) => dictionary.lookupAt(dict, text, 0);
const cardWord = (text) => { const m = lookup(text); return m ? dictionary.wordOf(m.matches[0]).target : null; };
const FORMS = {
  食べなかった: '食べる', 会いたい: '会う', 遅れてる: '遅れる', 待ってて: '待つ', 勉強した: '勉強', 来た: '来る',
  来ない: '来る', 行った: '行く', しました: 'する', 飲みません: '飲む', 寒かった: '寒い', 見られる: '見る',
  書かせる: '書く', 読んでください: '読む', 泳げる: '泳ぐ', 話しながら: '話す', 忘れちゃった: '忘れる',
  高くない: '高い', 帰りましょう: '帰る', 分かりました: '分かる', 降ってる: '降る', 美味しそう: '美味しい',
};
for (const [form, word] of Object.entries(FORMS)) check(`${form} → ${word}`, cardWord(form) === word, cardWord(form));
check('…saying what made the form: 食べなかった is negative, past',
  lookup('食べなかった').matches[0].reasons.join(', ') === 'negative, past', lookup('食べなかった').matches[0].reasons.join(', '));
check('the longest word wins: 駅前 rather than 駅 + 前', lookup('駅前で')?.surface === '駅前', lookup('駅前で')?.surface);
check('kana alone is read as the word usually written in kana: に is the particle, not 荷 ("load")',
  dictionary.isMinor(lookup('に').matches[0].entry) && lookup('に').matches[0].entry.kanji.length === 0);
check('a word usually written in kana goes on its card in kana', cardWord('ありがとう') === 'ありがとう');
check('kana for a word written in kanji goes on its card in kanji, as it usually is: たべる → 食べる', cardWord('たべる') === '食べる');

// How the text itself is read, for furigana.
const reading = (text) => dictionary.readingOf(text, lookup(text).matches[0]);
check('readings follow the text, not the dictionary form: 食べなかった is たべなかった', reading('食べなかった') === 'たべなかった',
  reading('食べなかった'));
check('…and 来る\'s changing stem: 来た きた, 来ない こない, 来れば くれば',
  reading('来た') === 'きた' && reading('来ない') === 'こない' && reading('来れば') === 'くれば',
  `${reading('来た')} ${reading('来ない')} ${reading('来れば')}`);

// A message cut into words.
const pieces = dictionary.segment(dict, '明日は7時に駅で会いたい。');
check('a message is cut into its words and the rest',
  pieces.map((p) => p.text).join('|') === '明日|は|7|時|に|駅|で|会いたい|。', pieces.map((p) => p.text).join('|'));
check('…a counter straight after a number: 7時 is じ, not とき', reading('時') !== 'じ' &&
  dictionary.readingOf('時', pieces[3].match.matches[0]) === 'じ', dictionary.readingOf('時', pieces[3].match.matches[0]));
const hello = dictionary.segment(dict, '今日は暑いね');
check('今日は in a message is 今日 + は, with "hello" still on offer',
  hello.map((p) => p.text).join('|') === '今日|は|暑い|ね' && hello[0].match.longer?.surface === '今日は',
  hello.map((p) => p.text).join('|'));
check('a sentence\'s furigana is suggested word by word',
  dictionary.sentenceFurigana(dict, '明日、駅で会いましょう。') === '{明日|あした}、{駅|えき}で{会|あ}いましょう。',
  dictionary.sentenceFurigana(dict, '明日、駅で会いましょう。'));
check('…and there is none for a sentence in kana', dictionary.sentenceFurigana(dict, 'ありがとう！') === null);

// Every label the screens build from a key has an interface string.
check(`every inflection the rules name has a label (${dictionary.REASONS.length})`,
  dictionary.REASONS.every((r) => `inflect.${r}` in uiEn), dictionary.REASONS.filter((r) => !(`inflect.${r}` in uiEn)).join(', '));
const kinds = new Set();
for (let i = 0; i < dict.size; i++) kinds.add(dictionary.wordKind(dict.entry(i)));
kinds.delete(null);
check(`every kind of word in the dictionary has a label (${kinds.size})`, [...kinds].every((k) => `pos.${k}` in uiEn),
  [...kinds].filter((k) => !(`pos.${k}` in uiEn)).join(', '));

// Saved messages, and the words added from them.
const pasted = await deck.saveMessage('明日、駅で会いましょう。');
check('a pasted message is kept on the device', (await deck.getMessage(pasted.id))?.text === '明日、駅で会いましょう。' &&
  (await deck.getMessages()).length === 1);
await deck.saveUserItem({ id: 'u-paste', kind: 'word', target: '会う', reading: 'あう', furigana: '{会|あ}う', meaning: 'to meet',
  note: 'From a message: 明日、駅で会いましょう。', audioMode: 'none' });
await deck.markAdded(pasted.id, 'u-paste');
await deck.markAdded(pasted.id, 'u-paste');
check('a word added from it is counted once', (await deck.getMessage(pasted.id)).added.join() === 'u-paste');
check('…and is one of your own words, with its cards', Boolean(await deck.getCard('u-paste')) &&
  (await deck.getUserItems()).some((u) => u.id === 'u-paste'));
check('messages are in a backup', (await backup.exportAll()).namespaces['en-ja'].meta.messages?.some((m) => m.id === pasted.id));
await deck.deleteMessage(pasted.id);
check('deleting a message forgets it, but not the words added from it',
  !(await deck.getMessage(pasted.id)) && (await deck.getUserItems()).some((u) => u.id === 'u-paste'));
await deck.deleteUserItem('u-paste');

/* ---------- 15. the translator ---------- */

console.log('\n15. Translate — the course first, then the offline translator');

const mtSearch = await import('../js/search.js');
const translatorMod = await import('../js/translator.js');
const { nodeTranslator } = await import('./translator-node.mjs');
const jaContent = await loadContent();
const jaItems = [...jaContent.phrases.values()];

check('the course has a translator both ways, from mt/translator.json',
  jaContent.features.translator && translatorMod.directionsFor(jaContent).say?.join() === 'en-ja' && translatorMod.directionsFor(jaContent).read?.join() === 'ja-en');
const mtFiles = translatorMod.filesFor(jaContent.translator, ['en-ja', 'ja-en']);
check('…its files: the engine, its loader, and both models, each once',
  mtFiles.length === 9 && new Set(mtFiles.map((f) => f.path)).size === 9 && translatorMod.bytesOf(mtFiles) > 50e6,
  `${mtFiles.length} files, ${(translatorMod.bytesOf(mtFiles) / 1e6).toFixed(1)} MB`);

const mtToilet = mtSearch.searchCourse(jaItems, 'Where is the toilet?', { side: 'meaning' });
check('what you want to say finds the course\'s phrase, word for word',
  mtToilet[0]?.exact && mtToilet[0].item.target === 'トイレはどこですか', mtToilet.map((m) => `${m.item.target} ${m.score.toFixed(2)}`).join(', '));
check('…matching whatever the punctuation and case', mtSearch.searchCourse(jaItems, 'where is THE toilet', { side: 'meaning' })[0]?.exact);
const mtWallet = mtSearch.searchCourse(jaItems, 'I lost my wallet on the train.', { side: 'meaning' });
check('a near match counts the words that matter, not "I", "my" or "the"',
  mtWallet.length === 1 && mtWallet[0].item.target === '財布をなくしました' && !mtWallet[0].exact,
  mtWallet.map((m) => `${m.item.target} ${m.score.toFixed(2)}`).join(', '));
const readBack = mtSearch.searchCourse(jaItems, 'トイレはどこですか？', { side: 'target' });
check('Japanese you want to understand finds its course item by character pairs', readBack[0]?.exact && readBack[0].item.meaning === 'Where is the toilet?');
check('a gloss with alternatives matches any of them', mtSearch.score('yes', 'Yeah. / Yes.') === 1 && mtSearch.score('受け取る', '受け取る、拾う、迎えに行く') === 1);
check('…but a sentence\'s comma doesn\'t split it', mtSearch.variants('遅れてすみません、バスが遅れました。').length === 1);
check('nothing typed, nothing found', mtSearch.searchCourse(jaItems, '  ', { side: 'meaning' }).length === 0);
check('characters aren\'t offered as translations', !mtSearch.searchCourse(jaItems, 'a', { side: 'target', min: 0 }).some((m) => m.item.kind === 'character'));
check('Japanese output gets full-width ？ and ！', translatorMod.tidy('トイレはどこですか?', 'ja') === 'トイレはどこですか？' && translatorMod.tidy('Hi!', 'en') === 'Hi!');

// The app's own worker, with the real engine and models, in Node.
const nodeMt = nodeTranslator(ROOT, jaContent.translator);
const mtEnJa = await nodeMt.translate('en-ja', 'Is there a pharmacy near here?');
check('the worker translates English into Japanese, on the device', /薬局/.test(mtEnJa.text), mtEnJa.text);
const mtJaEn = await nodeMt.translate('ja-en', '最近、日本語を勉強しています。');
check('…and Japanese into English', /Japanese/i.test(mtJaEn.text) && /stud/i.test(mtJaEn.text), mtJaEn.text);
check('…quickly, once a model is loaded', (await nodeMt.translate('en-ja', 'Thank you.')).ms < 2000);
check('…and an empty text is an empty translation, not an error', (await nodeMt.translate('en-ja', '   ')).text === '');
let mtNoModel = null;
try { await nodeMt.translate('en-xx', 'Hello'); } catch (err) { mtNoModel = err; }
check('a direction it has no model for fails cleanly', /no model/.test(mtNoModel?.message || ''), mtNoModel?.message);

// Indonesian: English ↔ Indonesian directly; Japanese ↔ Indonesian through English, since Mozilla has no model for it.
const mtPairs = jaContent.translator.pairs;
check('English ↔ Indonesian is one model each way',
  translatorMod.routeFor(mtPairs, 'en', 'id')?.join() === 'en-id' && translatorMod.routeFor(mtPairs, 'id', 'en')?.join() === 'id-en');
check('…and Japanese ↔ Indonesian goes through English',
  translatorMod.routeFor(mtPairs, 'ja', 'id')?.join() === 'ja-en,en-id' && translatorMod.routeFor(mtPairs, 'id', 'ja')?.join() === 'id-en,en-ja');
check('…with no route where there are no models', translatorMod.routeFor(mtPairs, 'ja', 'xx') === null && translatorMod.routeFor(mtPairs, 'en', 'xx') === null);
const mtJaId = await nodeMt.translate(['ja-en', 'en-id'], 'すみません、駅はどこですか。');
check('the worker translates Japanese into Indonesian through English', /stasiun/i.test(mtJaId.text), mtJaId.text);
const mtIdJa = await nodeMt.translate(['id-en', 'en-ja'], 'Di mana apotek terdekat?');
check('…and Indonesian into Japanese', /薬局/.test(mtIdJa.text), mtIdJa.text);
check('Indonesian output spells di mana, ke mana and dari mana apart',
  translatorMod.tidy('Dimana toiletnya? Kamu mau kemana? Darimana?', 'id') === 'Di mana toiletnya? Kamu mau ke mana? Dari mana?');

/* ---------- 16. the Indonesian courses ---------- */

console.log('\n16. Indonesian, both ways — and the courses built from another one');

// en-id is written new; ja-id, id-en and id-ja keep their original's target-language text exactly.
const ORIGINAL = { 'ja-id': 'en-id', 'id-en': 'ja-en', 'id-ja': 'en-ja' };
const targets = {};
for (const id of ['en-id', 'ja-id', 'id-en', 'id-ja']) {
  await course.setCourse(id);
  const c = await loadContent();
  const levels = c.levels.map((l) => l.id).join(',');
  check(`${id}: three levels, with words, phrases and lessons at each`,
    levels === 'first-steps,basic,intermediate' && c.levels.every((l) =>
      [...c.categories, ...c.decks, ...c.lessons].some((d) => d.level === l.id && d.items.length)), levels);
  targets[id] = new Map([...c.phrases.values()].map((p) => [p.id, p.target]));
  const set = await quiz.buildPlacementSet();
  check(`${id}: placement samples First steps and Basic, two cards a category`,
    set.length > 0 && set.every((x) => ['first-steps', 'basic'].includes(c.byCategory.get(x.categoryId)?.level ?? c.bySet.get(x.categoryId)?.level)),
    `${set.length} cards`);
  await quiz.applyPlacement(set, Object.fromEntries(set.map((x) => [x.id, quiz.ANSWERS.UNKNOWN])));
  const starters = levelsMod.startersIn(c, 'first-steps').map((d) => d.id).sort().join(',');
  check(`${id}: knowing nothing starts at First steps, with its starters`,
    (await deck.getLevel()) === 'first-steps' && (await deck.getSettings()).activeCategories.slice().sort().join(',') === starters, starters);
  const q = await deck.queue();
  check(`${id}: a review queue from its own content`, q.length > 0 && q.every((card) => c.phrases.has(card.id)), `${q.length} cards`);
  await deck.grade(q[0].id, srs.GRADE.GOOD);
  check(`${id}: grading counts in its own storage`, (await deck.todayStats()).reviews === 1 &&
    [...mem.keys()].some((k) => k.startsWith(`ww-${id}:srs:`)));
  check(`${id}: the translator, both ways`, c.features.translator && Boolean(translatorMod.directionsFor(c).say && translatorMod.directionsFor(c).read),
    JSON.stringify(translatorMod.directionsFor(c)));
}
const jaTargets = await (async () => { await course.setCourse('en-ja'); return new Map([...(await loadContent()).phrases.values()].map((p) => [p.id, p.target])); })();
const enTargets = await (async () => { await course.setCourse('ja-en'); return new Map([...(await loadContent()).phrases.values()].map((p) => [p.id, p.target])); })();
const originals = { 'en-id': targets['en-id'], 'ja-en': enTargets, 'en-ja': jaTargets };
for (const [id, from] of Object.entries(ORIGINAL)) {
  const differ = [...targets[id]].filter(([k, text]) => originals[from].has(k) && originals[from].get(k) !== text);
  const shared = [...targets[id].keys()].filter((k) => originals[from].has(k)).length;
  check(`${id} keeps ${from}'s target-language text exactly`, differ.length === 0 && shared > targets[id].size * 0.9,
    `${shared} of ${targets[id].size} shared${differ.length ? `; ${differ[0][0]} differs` : ''}`);
}
await course.setCourse('id-ja');
const idJa = await loadContent();
const idHira = [...idJa.characters.values()].find((x) => x.script === 'hiragana');
const idKanji = [...idJa.characters.values()].find((x) => x.script === 'kanji');
check('id-ja: a kana card reads in Indonesian, a kanji has its Indonesian meaning',
  idHira.meaning === `dibaca “${idHira.romaji}”` && Boolean(idKanji.meaning) && idKanji.meaning === idKanji.indonesian, `${idHira.meaning} · ${idKanji.character} ${idKanji.meaning}`);
check('id-ja: no Paste a message, since the dictionary has no Indonesian', !idJa.features.dictionary);
check('ja-id and id-ja translate through English', translatorMod.directionsFor(idJa).say?.join() === 'id-en,en-ja');
await course.setCourse('en-ja');

/* ---------- result ---------- */

console.log(
  failures
    ? `\n✗ ${failures} of ${checks} integration checks failed\n`
    : `\n✓ all ${checks} integration checks passed — browse → quiz → study → review → scenarios → characters loop is intact, in every course\n`
);
process.exit(failures ? 1 : 0);
