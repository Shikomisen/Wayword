/**
 * reading.js — reading progression (README §2.7).
 *
 *   - the daily kana drill (#/<course>/characters/drill/<script>): a couple
 *     of minutes of "what does this say?" and "which one did you hear?",
 *     new kana introduced a row at a time;
 *   - kana mastery, shown on the Reading screen and on Today until both
 *     scripts are mastered;
 *   - the soft gate in front of kanji: until hiragana is mastered, a kanji
 *     set can still be added, but only "anyway";
 *   - the hiragana written over katakana words, retired once katakana is
 *     mastered.
 *
 * The rules are in kana.js. Only courses with character sets reach this; its
 * wording is in the reading.* interface strings, in the learner's language.
 */

import { loadContent } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { link, go } from './course.js';
import { el, clear, setKatakanaAids } from './render.js';
import { MASTERY, SCRIPTS, kanaProgress, focusScript, buildKanaDrill } from './kana.js';
import { choiceQuestion } from './choice.js';
import { t } from './i18n.js';

export const SCRIPT_NAMES = { hiragana: 'Hiragana', katakana: 'Katakana' };

/**
 * Kana mastery for the current course: per script, the script to drill
 * next, whether today's drill is done, and whether it was in that script
 * (so the next one is "another round" rather than "today's drill").
 */
export async function kanaState() {
  const { characterSets } = await loadContent();
  const [stats, cards, today] = await Promise.all([
    deck.getKanaStats(), deck.characterCards(), deck.kanaDrillToday(),
  ]);
  const progress = kanaProgress(characterSets, stats, cards);
  const focus = focusScript(progress);
  return { progress, focus, stats, cards, doneToday: today.done, anotherRound: today.done && today.script === focus };
}

/** Kanji wait for hiragana — their readings are written in it. */
export const kanjiGated = (state) => Boolean(state.progress.hiragana && !state.progress.hiragana.done);

/** The hiragana over katakana words stays until katakana is mastered. */
export async function refreshKanaAids() {
  const { features } = await loadContent();
  if (!features.characters) { setKatakanaAids(true); return; }
  const { progress } = await kanaState();
  setKatakanaAids(!progress.katakana?.done);
}

/** One bar per script: mastered out of the core kana. */
export function kanaMeters(state) {
  return el('div', { class: 'kana-meters' },
    SCRIPTS.filter((s) => state.progress[s]).map((s) => {
      const p = state.progress[s];
      return el('div', { class: `kana-meter ${p.done ? 'is-done' : ''}`, dataset: { script: s } },
        el('span', { class: 'kana-meter-name' }, SCRIPT_NAMES[s]),
        el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${Math.round((p.mastered / p.total) * 100)}%` })),
        el('span', { class: 'kana-meter-count' }, p.done ? t('reading.meterDone') : `${p.mastered}/${p.total}`));
    }));
}

/** The top of the Reading screen: mastery so far, and today's drill. */
export function kanaPanel(state) {
  const { focus } = state;
  const others = SCRIPTS.filter((s) => state.progress[s] && s !== focus);
  return el('section', { class: 'kana-panel' },
    el('h2', { class: 'section-title' }, t('reading.kanaMastery')),
    kanaMeters(state),
    focus
      ? el('a', { class: 'btn btn-primary btn-lg full', href: link(`/characters/drill/${focus}`) },
          t(state.anotherRound ? `reading.drillAgain.${focus}` : `reading.drillToday.${focus}`))
      : el('p', { class: 'muted' }, t('reading.bothMastered')),
    others.length
      ? el('div', { class: 'action-row kana-others' }, others.map((s) =>
          el('a', { class: 'btn btn-small btn-ghost', href: link(`/characters/drill/${s}`) }, t(`reading.practise.${s}`))))
      : null,
    el('p', { class: 'muted small' }, t('reading.masteryRule', {
      streak: MASTERY.streak, days: MASTERY.days, percent: Math.round(MASTERY.threshold * 100), total: state.progress.hiragana?.total ?? 71,
    })));
}

/* ---------- the drill ---------- */

export async function renderKanaDrill(root, script) {
  const state = await kanaState();
  const start = state.progress[script];
  if (!start) { go('/characters'); return; }
  const { intros, questions } = buildKanaDrill(start.set, state.stats, { cards: state.cards });

  const view = el('div', { class: 'screen kana-drill' });
  root.append(view);
  let index = 0;
  let right = 0;
  let onKey = null;

  const top = () => el('div', { class: 'study-top' },
    el('a', { class: 'back-link', href: link('/characters') }, '✕'),
    el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${(index / questions.length) * 100}%` })),
    el('span', { class: 'muted small' }, `${index}/${questions.length}`));

  // New kana are met before they're asked: tap to hear each one.
  function showIntros() {
    onKey = (k) => { if (k === 'Enter') ask(); };
    clear(view).append(
      top(),
      el('div', { class: 'drill-card kana-intro' },
        el('div', { class: 'drill-kind' }, t('reading.newKana', { n: intros.length })),
        el('p', { class: 'muted' }, t('reading.introHelp')),
        el('div', { class: 'kana-intro-grid' }, intros.map((c) =>
          el('button', { type: 'button', class: 'kana-cell', onclick: () => audio.play(c.audio) },
            el('span', { class: 'kana-char', lang: 'ja' }, c.character),
            el('span', { class: 'kana-romaji' }, c.romaji)))),
        el('button', { type: 'button', class: 'btn btn-primary btn-lg full', onclick: () => ask() }, t('quiz.start'))));
  }

  function ask() {
    if (index >= questions.length) { finish(); return; }
    const q = questions[index];
    const listen = q.type === 'listen';
    const question = choiceQuestion({
      kind: t(listen ? 'reading.askListen' : 'reading.askRead'),
      prompt: [listen
        ? el('button', { type: 'button', class: 'btn listen-btn', onclick: () => audio.play(q.char.audio) }, t('reading.playAgain'))
        : el('div', { class: 'kana-prompt', lang: 'ja' }, q.char.character)],
      options: q.options.map((c) => ({
        id: c.id,
        className: listen ? 'kana-option' : 'romaji-option',
        node: listen ? el('span', { class: 'kana-char', lang: 'ja' }, c.character) : c.romaji,
      })),
      rightId: q.char.id,
      verdicts: { right: t('drill.right'), wrong: t('drill.wrong') },
      onAnswer: async (ok) => {
        if (ok) right++;
        audio.play(q.char.audio); // shape and sound together, right or wrong
        await deck.recordKana(q.char.id, ok);
        return [el('p', { class: 'kana-answer' }, el('span', { class: 'kana-char', lang: 'ja' }, q.char.character), t('reading.answerIs', { romaji: q.char.romaji }))];
      },
      next: { label: t(index + 1 < questions.length ? 'drill.next' : 'drill.finish'), go: () => { index++; ask(); } },
      autoAdvance: true,
      cardClass: 'kana-question',
      optionsClass: 'kana-options',
      dataset: { kana: q.type, char: q.char.id },
    });
    onKey = (k) => question.key(k);
    clear(view).append(top(), question.node);
    if (listen) audio.play(q.char.audio);
  }

  async function finish() {
    onKey = null;
    await deck.finishKanaDrill(questions.length, script);
    const after = await kanaState();
    await refreshKanaAids();
    const end = after.progress[script];
    const gained = end.mastered - start.mastered;
    const milestone = end.done && !start.done ? t(`reading.milestone.${script}`) : null;
    clear(view).append(
      el('div', { class: 'empty-state practice-done' },
        el('h1', {}, t('reading.drillDone')),
        el('p', { class: 'lede' }, t('reading.score', { right, total: questions.length })),
        gained > 0 ? el('p', {}, t('reading.newlyMastered', { n: gained })) : null,
        milestone ? el('p', { class: 'kana-milestone' }, milestone) : null,
        kanaMeters(after),
        el('div', { class: 'action-row' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => renderKanaDrill(clear(root), after.focus || script) },
            t('reading.anotherRound')),
          el('a', { class: 'btn', href: link('/') }, t('listening.backToday')))));
  }

  const keydown = (e) => {
    if (!view.isConnected) { document.removeEventListener('keydown', keydown); return; }
    if (onKey && (e.key === 'Enter' || /^[1-9]$/.test(e.key))) { e.preventDefault(); onKey(e.key); }
  };
  document.addEventListener('keydown', keydown);

  if (!questions.length) {
    view.append(el('p', { class: 'muted' }, t('reading.nothingToDrill')));
    return;
  }
  if (intros.length) showIntros(); else ask();
}
