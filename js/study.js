/**
 * study.js — the flashcard session, in all three directions.
 *
 *   recognition — the target language (furigana per mode) and its audio;
 *                 flip for the meaning, notes and register
 *   production  — the meaning only: say it out loud, then flip to check
 *                 against the target language and its audio
 *   listening   — the audio only, played as the card appears; flip to see
 *                 what was said and what it means
 *
 * Grading feeds SM-2 the same way in every direction. Failed cards are
 * pushed back into the same session rather than disappearing for ten
 * minutes. Phrases, words, sentences and characters all come through here.
 */

import { loadContent } from './content.js';
import * as deck from './deck.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import { go, languageName } from './course.js';
import { t, formatInterval } from './i18n.js';
import {
  el, clear, targetNode, meaningNode, notesBlock, tagRow, audioButton, registerBadge, politeBlock,
  furiganaMode, readableToggle, wordDetails,
} from './render.js';
import { playItem, studySettings, toggleStrip } from './shared.js';

export async function runSession(root, queue, { exitTo }) {
  const { phrases, features, course } = await loadContent();
  let s = await studySettings();
  const total = queue.length;
  let done = 0;
  let flipped = false;
  let heard = null; // the listening card whose audio has already played
  const cards = [...queue];

  const view = el('div', { class: 'screen study' });
  root.append(view);

  async function draw() {
    if (!cards.length) return finish();
    const card = cards[0];
    const item = phrases.get(srs.itemIdOf(card));
    if (!item) { cards.shift(); return draw(); } // content removed under us
    clear(view);

    // Re-read settings each draw so the inline toggles take effect immediately.
    s = await studySettings();
    const dir = srs.dirOf(card);
    const previews = srs.gradePreviews(card, Date.now(), formatInterval);
    const furigana = furiganaMode(s, item);
    const target = () => [
      targetNode(item, { furigana }),
      s.romaji && item.reading ? el('div', { class: 'romaji' }, item.reading) : null,
    ];
    const extras = () => [
      politeBlock(item, s, playItem),
      wordDetails(item, s),
      notesBlock(item),
      readableToggle(item, s, async (on) => { await deck.setReadable(item.id, on); draw(); }),
      tagRow(item),
    ];

    let front;
    let back;
    if (dir === srs.DIR.PRODUCTION) {
      front = [
        el('p', { class: 'prompt muted' }, t('study.sayIt', { lang: languageName(course.target, course.speaker) })),
        meaningNode(item, { big: true }),
      ];
      back = [...target(), audioButton(item, playItem), ...extras()];
    } else if (dir === srs.DIR.LISTENING) {
      front = [
        el('p', { class: 'prompt muted' }, t('study.listenPrompt')),
        el('button', {
          class: 'btn listen-btn', type: 'button',
          onclick: (e) => { e.stopPropagation(); playItem(item); },
        }, t('study.playAgain')),
      ];
      back = [...target(), meaningNode(item, { big: true }), ...extras()];
    } else {
      front = [...target(), audioButton(item, playItem)];
      back = [meaningNode(item, { big: true }), ...extras()];
    }

    // Native append() would print a null child as the text "null" (a course
    // with no reading aids has no toggle strip), so drop the gaps first.
    view.append(...[
      el('div', { class: 'study-top' },
        el('a', { class: 'back-link', href: exitTo }, '✕'),
        el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${(done / total) * 100}%` })),
        el('span', { class: 'muted small' }, `${done}/${total}`)),

      el('div', {
        class: `study-card dir-${dir} ${flipped ? 'flipped' : ''}`,
        onclick: () => { if (!flipped) { flipped = true; draw(); } },
      },
        el('div', { class: 'card-cat muted small' },
          item.categoryTitle, item.register ? " " : null, registerBadge(item),
          card.kind === srs.KIND.CHARACTER ? null : el('span', { class: `dir-label dir-label-${dir}` }, t(`dir.${dir}`))),
        ...front.filter(Boolean),
        flipped
          ? el('div', { class: 'study-back' }, ...back.filter(Boolean))
          : el('p', { class: 'muted tap-hint' }, t('study.tapToReveal'))),

      toggleStrip(draw, features),

      flipped
        ? el('div', { class: 'grade-row' },
            gradeBtn('again', t('grade.again'), previews.AGAIN, srs.GRADE.AGAIN),
            gradeBtn('hard', t('grade.hard'), previews.HARD, srs.GRADE.HARD),
            gradeBtn('good', t('grade.good'), previews.GOOD, srs.GRADE.GOOD),
            gradeBtn('easy', t('grade.easy'), previews.EASY, srs.GRADE.EASY))
        : el('button', { class: 'btn btn-primary btn-lg full', onclick: () => { flipped = true; draw(); } }, t('study.showAnswer')),
    ].filter(Boolean));

    // Listening asks with the audio, so it plays as the card appears — once.
    if (dir === srs.DIR.LISTENING && !flipped && heard !== card.id) {
      heard = card.id;
      playItem(item);
    }
    // Otherwise the clip plays on reveal: the meaning's sound for
    // recognition, the answer itself for production.
    if (flipped && s.autoPlayAudio && dir !== srs.DIR.LISTENING) audio.playItem(item);
  }


  function gradeBtn(cls, label, preview, quality) {
    return el('button', { class: `btn btn-grade grade-${cls}`, onclick: () => submit(quality) },
      el('strong', {}, label), el('span', { class: 'grade-when' }, preview));
  }

  async function submit(quality) {
    const card = cards.shift();
    const updated = await deck.grade(card.id, quality);
    done++;
    flipped = false;
    // A lapsed card comes back at the end of this session, not tomorrow.
    if (updated && quality < 3) cards.push(updated);
    draw();
  }

  async function finish() {
    document.removeEventListener('keydown', onKey);
    clear(view);
    const stats = await deck.todayStats();
    view.append(el('div', { class: 'empty-state' },
      el('h1', {}, t('study.done')),
      el('p', { class: 'lede' }, t('study.doneSummary', { done, total: stats.reviews })),
      el('button', { class: 'btn btn-primary btn-lg', onclick: () => go('/') }, t('study.backToToday'))));
  }

  // Keyboard shortcuts — desktop review is much faster with them.
  const onKey = (e) => {
    if (!view.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.target?.closest?.('input, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!flipped) { flipped = true; draw(); } }
    else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
      submit([srs.GRADE.AGAIN, srs.GRADE.HARD, srs.GRADE.GOOD, srs.GRADE.EASY][Number(e.key) - 1]);
    }
  };
  document.addEventListener('keydown', onKey);

  draw();
}
