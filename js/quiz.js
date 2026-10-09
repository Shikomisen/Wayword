/**
 * quiz.js — onboarding placement quiz (README §6a).
 *
 * Offline, no AI call. Pulls two sample cards from each of the 10
 * categories (one easy, one harder) for 20 self-graded items, then uses
 * the result to decide where each card enters the SRS deck.
 *
 * Self-graded on purpose: typing answers is slow, and the thing being
 * measured is "do you already have this", not production accuracy.
 */

import { loadContent } from './content.js';
import { el, clear, targetNode, meaningNode } from './render.js';
import * as deck from './deck.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import { t, fill } from './i18n.js';

export const ANSWERS = {
  KNOWN: 'known',        // could say it unprompted
  RECOGNISED: 'seen',    // would understand it, couldn't produce it
  UNKNOWN: 'unknown',    // new
};

const WEIGHT = { known: 1, seen: 0.5, unknown: 0 };

/**
 * Two per category: the easiest available and the hardest available.
 * Anime-derived knowledge is lopsided — sampling both ends of each
 * category is what exposes the lopsidedness.
 *
 * Character sets are sampled the same way, two each. Reading ability is
 * exactly the kind of prior exposure that deserves credit rather than
 * being re-taught from あ: someone who already reads kana should not
 * spend week one on it.
 */
export async function buildPlacementSet() {
  const { categories, characterSets } = await loadContent();
  const picked = [];

  const twoEnds = (pool, meta) => {
    if (!pool.length) return;
    const sorted = [...pool].sort((a, b) => (a.difficulty ?? 3) - (b.difficulty ?? 3));
    const easy = sorted[0];
    const hard = sorted[sorted.length - 1];
    picked.push({ ...easy, ...meta });
    if (hard.id !== easy.id) picked.push({ ...hard, ...meta });
  };

  for (const cat of categories) {
    twoEnds(cat.phrases, { categoryId: cat.id, categoryTitle: cat.title, kind: 'phrase' });
  }

  for (const set of characterSets) {
    twoEnds(set.characters, { categoryId: set.id, categoryTitle: set.title, kind: 'character' });
  }

  return picked;
}

/**
 * Turn raw answers into a per-category score and seed the SRS deck.
 *
 * Per README §6a: cards answered "known" enter at a later interval;
 * "recognised" and "unknown" start at the normal first interval.
 */
export async function applyPlacement(items, answers) {
  const perCategory = {};

  for (const item of items) {
    const a = answers[item.id] ?? ANSWERS.UNKNOWN;
    const bucket = (perCategory[item.categoryId] ??= {
      known: 0, seen: 0, unknown: 0, n: 0, score: 0,
    });
    bucket[a] += 1;
    bucket.n += 1;
  }

  for (const bucket of Object.values(perCategory)) {
    bucket.score = bucket.n
      ? (bucket.known * WEIGHT.known + bucket.seen * WEIGHT.seen) / bucket.n
      : 0;
  }

  const totals = Object.values(perCategory).reduce(
    (acc, b) => ({ known: acc.known + b.known, seen: acc.seen + b.seen, n: acc.n + b.n }),
    { known: 0, seen: 0, n: 0 }
  );
  const overall = totals.n ? (totals.known + totals.seen * 0.5) / totals.n : 0;

  const result = { done: true, at: Date.now(), answers, perCategory, overall };
  await deck.savePlacement(result);

  // Seed the sampled cards themselves before category activation, so
  // activateCategory() sees them as already present and leaves them alone.
  const now = Date.now();
  for (const item of items) {
    const a = answers[item.id] ?? ANSWERS.UNKNOWN;
    const opts = {
      kind: item.kind === 'character' ? srs.KIND.CHARACTER : srs.KIND.PHRASE,
      difficulty: item.difficulty ?? 3,
    };
    const card = a === ANSWERS.KNOWN
      ? srs.seedKnown(item.id, item.categoryId, 6, 2.6, now, opts)
      : srs.newCard(item.id, item.categoryId, now, opts);
    await deck.putCard(card);
  }

  // README §7: start with a few categories, not all of them — the review
  // load adds up. The manifest marks which ones are `starter`s.
  const { categories, decks } = await loadContent();
  for (const d of [...categories, ...(decks || [])].filter((c) => c.starter)) {
    await deck.activateCategory(d.id);
  }

  return result;
}

export function levelLabel(overall) {
  if (overall >= 0.75) return t('quiz.level.strong');
  if (overall >= 0.45) return t('quiz.level.partial');
  if (overall >= 0.2) return t('quiz.level.early');
  return t('quiz.level.fresh');
}

/* ---------- screen ---------- */

export async function renderPlacement(root, { onDone }) {
  const items = await buildPlacementSet();
  const { manifest } = await loadContent();
  // The intro is about *this* course's learners (anime-taught Japanese,
  // school-taught English…), so its wording comes from the course manifest.
  const copy = manifest.copy || {};
  const answers = {};
  let index = 0;

  const view = el('div', { class: 'screen placement' });
  root.append(view);

  function renderIntro() {
    clear(view);
    view.append(
      el('div', { class: 'placement-intro' },
        el('h1', {}, t('quiz.title')),
        copy.placementLede ? el('p', { class: 'lede' }, fill(copy.placementLede, { n: items.length })) : null,
        copy.placementAside ? el('p', { class: 'muted' }, copy.placementAside) : null,
        el('button', { class: 'btn btn-primary btn-lg', onclick: () => { index = 0; renderCard(); } },
          t('quiz.start')),
        el('button', {
          class: 'btn btn-ghost',
          onclick: async () => {
            // Skipping is legitimate — treat everything as unknown.
            await applyPlacement(items, {});
            onDone();
          },
        }, t('quiz.skip'))
      )
    );
  }

  function renderCard() {
    if (index >= items.length) return renderResults();
    const item = items[index];
    clear(view);

    // Native append() prints a null child as "null" — drop the absent Back button.
    view.append(...[
      el('div', { class: 'placement-progress' },
        el('div', { class: 'bar' },
          el('div', { class: 'bar-fill', style: `width:${(index / items.length) * 100}%` })),
        el('div', { class: 'muted small' },
          t('quiz.progress', { i: index + 1, n: items.length, title: item.categoryTitle }))
      ),
      el('div', { class: 'placement-card' },
        targetNode(item, { furigana: true }),
        item.reading ? el('div', { class: 'romaji' }, item.reading) : null,
        el('button', {
          class: 'btn btn-ghost audio-inline',
          onclick: () => audio.play(item.audio),
        }, t('quiz.listen')),
        el('details', { class: 'reveal' },
          el('summary', {}, t('quiz.showMeaning')),
          meaningNode(item))
      ),
      el('div', { class: 'placement-actions' },
        el('button', { class: 'btn btn-answer known', onclick: () => answer(ANSWERS.KNOWN) },
          el('strong', {}, t('quiz.known')), el('span', {}, t('quiz.knownSub'))),
        el('button', { class: 'btn btn-answer seen', onclick: () => answer(ANSWERS.RECOGNISED) },
          el('strong', {}, t('quiz.seen')), el('span', {}, t('quiz.seenSub'))),
        el('button', { class: 'btn btn-answer unknown', onclick: () => answer(ANSWERS.UNKNOWN) },
          el('strong', {}, t('quiz.unknown')), el('span', {}, t('quiz.unknownSub')))
      ),
      index > 0
        ? el('button', { class: 'btn btn-ghost back', onclick: () => { index--; renderCard(); } }, t('quiz.back'))
        : null,
    ].filter(Boolean));
  }

  function answer(value) {
    answers[items[index].id] = value;
    index++;
    renderCard();
  }

  async function renderResults() {
    clear(view);
    view.append(el('div', { class: 'loading' }, t('quiz.building')));

    const result = await applyPlacement(items, answers);
    const { categories, characterSets } = await loadContent();
    const summary = await deck.deckSummary();

    const resultRow = (entry) => {
      const b = result.perCategory[entry.id];
      const pct = b ? Math.round(b.score * 100) : 0;
      return el('div', { class: 'result-row' },
        el('span', { class: 'result-name' }, `${entry.icon || ''} ${entry.title}`),
        el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` })),
        el('span', { class: 'result-pct' }, `${pct}%`));
    };

    const readingScore = characterSets.length
      ? characterSets.reduce((acc, s) => acc + (result.perCategory[s.id]?.score ?? 0), 0) / characterSets.length
      : 0;

    clear(view);
    view.append(
      el('div', { class: 'placement-results' },
        el('h1', {}, t('quiz.built')),
        el('p', { class: 'lede' },
          t('quiz.summary', { label: levelLabel(result.overall), pct: Math.round(result.overall * 100) })),

        el('h2', { class: 'section-title' }, t('quiz.phrases')),
        el('div', { class: 'result-grid' }, categories.map(resultRow)),

        characterSets.length
          ? el('div', {},
              el('h2', { class: 'section-title' }, t('quiz.reading')),
              el('div', { class: 'result-grid' }, characterSets.map(resultRow)),
              el('p', { class: 'muted small' },
                readingScore >= 0.75 ? t('quiz.readingStrong') : t('quiz.readingWeak')))
          : null,

        el('p', { class: 'muted' },
          t(characterSets.length ? 'quiz.loaded' : 'quiz.loadedNoChars',
            { total: summary.total, review: summary.review })),
        el('div', { class: 'action-row' },
          el('button', { class: 'btn btn-primary btn-lg', onclick: () => onDone() }, t('quiz.startStudying')),
          characterSets.length
            ? el('button', {
                class: 'btn btn-ghost',
                // Hand the destination to onDone: setting the hash here first
                // was immediately overwritten by onDone's own go('/').
                onclick: () => onDone('/characters'),
              }, t('quiz.readingFirst'))
            : null)
      )
    );
  }

  renderIntro();
}
