/**
 * reading.js — reading progression (README §16).
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
 * The rules are in kana.js. Like characters.js, only courses with character
 * sets reach this, so its wording is English rather than going through i18n.js.
 */

import { loadContent } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { link, go } from './course.js';
import { el, clear, setKatakanaAids } from './render.js';
import { MASTERY, SCRIPTS, kanaProgress, focusScript, buildKanaDrill } from './kana.js';
import { choiceQuestion } from './choice.js';

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
        el('span', { class: 'kana-meter-count' }, p.done ? '✓ mastered' : `${p.mastered}/${p.total}`));
    }));
}

/** The top of the Reading screen: mastery so far, and today's drill. */
export function kanaPanel(state) {
  const { focus } = state;
  const others = SCRIPTS.filter((s) => state.progress[s] && s !== focus);
  return el('section', { class: 'kana-panel' },
    el('h2', { class: 'section-title' }, 'Kana mastery'),
    kanaMeters(state),
    focus
      ? el('a', { class: 'btn btn-primary btn-lg full', href: link(`/characters/drill/${focus}`) },
          state.anotherRound ? `Another ${SCRIPT_NAMES[focus].toLowerCase()} round` : `Today’s ${SCRIPT_NAMES[focus].toLowerCase()} drill`)
      : el('p', { class: 'muted' }, 'Both kana are mastered — kanji are next.'),
    others.length
      ? el('div', { class: 'action-row kana-others' }, others.map((s) =>
          el('a', { class: 'btn btn-small btn-ghost', href: link(`/characters/drill/${s}`) }, `Practise ${SCRIPT_NAMES[s].toLowerCase()}`)))
      : null,
    el('p', { class: 'muted small' },
      `A kana is mastered once you get it right ${MASTERY.streak} times in a row, on ${MASTERY.days} different days. ` +
      `${Math.round(MASTERY.threshold * 100)}% of a script’s ${state.progress.hiragana?.total ?? 71} core kana masters the script. ` +
      'Hiragana comes first; kanji wait for it.'));
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
        el('div', { class: 'drill-kind' }, intros.length === 1 ? 'A new kana' : `${intros.length} new kana`),
        el('p', { class: 'muted' }, 'Tap each one to hear it. They come up in the drill straight after.'),
        el('div', { class: 'kana-intro-grid' }, intros.map((c) =>
          el('button', { type: 'button', class: 'kana-cell', onclick: () => audio.play(c.audio) },
            el('span', { class: 'kana-char', lang: 'ja' }, c.character),
            el('span', { class: 'kana-romaji' }, c.romaji)))),
        el('button', { type: 'button', class: 'btn btn-primary btn-lg full', onclick: () => ask() }, 'Start')));
  }

  function ask() {
    if (index >= questions.length) { finish(); return; }
    const q = questions[index];
    const listen = q.type === 'listen';
    const question = choiceQuestion({
      kind: listen ? 'Which one did you hear?' : 'What does it say?',
      prompt: [listen
        ? el('button', { type: 'button', class: 'btn listen-btn', onclick: () => audio.play(q.char.audio) }, '🔊 Play again')
        : el('div', { class: 'kana-prompt', lang: 'ja' }, q.char.character)],
      options: q.options.map((c) => ({
        id: c.id,
        className: listen ? 'kana-option' : 'romaji-option',
        node: listen ? el('span', { class: 'kana-char', lang: 'ja' }, c.character) : c.romaji,
      })),
      rightId: q.char.id,
      verdicts: { right: '✓ Right', wrong: '✕ Not quite' },
      onAnswer: async (ok) => {
        if (ok) right++;
        audio.play(q.char.audio); // shape and sound together, right or wrong
        await deck.recordKana(q.char.id, ok);
        return [el('p', { class: 'kana-answer' }, el('span', { class: 'kana-char', lang: 'ja' }, q.char.character), ` is ${q.char.romaji}`)];
      },
      next: { label: index + 1 < questions.length ? 'Next' : 'Finish', go: () => { index++; ask(); } },
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
    const milestone = end.done && !start.done
      ? (script === 'hiragana'
          ? 'Hiragana mastered! The kanji sets are open now, and katakana is next.'
          : 'Katakana mastered! The hiragana written over katakana words is gone now — you can read them as they are.')
      : null;
    clear(view).append(
      el('div', { class: 'empty-state practice-done' },
        el('h1', {}, 'Kana drill done'),
        el('p', { class: 'lede' }, `${right} of ${questions.length} right`),
        gained > 0 ? el('p', {}, gained === 1 ? '1 newly mastered' : `${gained} newly mastered`) : null,
        milestone ? el('p', { class: 'kana-milestone' }, milestone) : null,
        kanaMeters(after),
        el('div', { class: 'action-row' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => renderKanaDrill(clear(root), after.focus || script) },
            'Another round'),
          el('a', { class: 'btn', href: link('/') }, 'Back to Today'))));
  }

  const keydown = (e) => {
    if (!view.isConnected) { document.removeEventListener('keydown', keydown); return; }
    if (onKey && (e.key === 'Enter' || /^[1-9]$/.test(e.key))) { e.preventDefault(); onKey(e.key); }
  };
  document.addEventListener('keydown', keydown);

  if (!questions.length) {
    view.append(el('p', { class: 'muted' }, 'Nothing to drill in this script.'));
    return;
  }
  if (intros.length) showIntros(); else ask();
}
