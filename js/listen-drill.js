/**
 * listen-drill.js — the listening section (README §18).
 *
 *   #/<course>/listening         progress, today's drill, and every line and
 *                                pair of sounds, to hear any time
 *   #/<course>/listening/drill   the daily drill: about ten questions
 *
 * The rules are in listening.js, the question card in choice.js. Only a
 * course with `listening` content reaches this; Today offers the drill, and
 * Learn lists the section.
 */

import { loadContent } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { link } from './course.js';
import { t, has } from './i18n.js';
import { el, clear, phraseBlock, audioButton } from './render.js';
import { header, playItem, studySettings } from './shared.js';
import { STREAK, DAYS } from './mastery.js';
import { listeningItems, listeningProgress, buildListeningDrill } from './listening.js';
import { choiceQuestion } from './choice.js';

/** Listening progress for the current course, and whether today's drill is done. */
export async function listeningState() {
  const { listening = [] } = await loadContent();
  const items = listeningItems(listening);
  const [stats, doneToday] = await Promise.all([deck.getListenStats(), deck.listenDrillToday()]);
  return { sets: listening, items, stats, doneToday, progress: listeningProgress(items, stats) };
}

/** One bar: items mastered, out of all of them. */
function meter(progress) {
  const { mastered, total } = progress;
  return el('div', { class: `kana-meter listen-meter ${total && mastered === total ? 'is-done' : ''}` },
    el('span', { class: 'kana-meter-name' }, t('listening.title')),
    el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${total ? Math.round((mastered / total) * 100) : 0}%` })),
    el('span', { class: 'kana-meter-count' }, `${mastered}/${total}`));
}

const who = (speaker) => (speaker && has(`speaker.${speaker}`) ? t(`speaker.${speaker}`) : null);

/** "You could answer: …" — the speaking half of hearing a reply. */
function replyBlock(reply, s) {
  return el('div', { class: 'listen-reply' },
    el('span', { class: 'note-label' }, t('listening.replyWith')),
    phraseBlock(reply, s));
}

/** Both words of a pair, each with its own 🔊 — the one that was played, marked. */
function pairButtons(pair, heardId = null) {
  return el('div', { class: 'contrast-pair' }, pair.map((w) =>
    el('button', {
      type: 'button', class: `btn contrast-play ${w.id === heardId ? 'is-heard' : ''}`, dataset: { id: w.id },
      onclick: () => audio.play(w.audio),
    },
    el('span', { class: 'contrast-word', lang: w.targetLang }, `🔊 ${w.target}`),
    el('span', { class: 'contrast-meaning muted small', lang: w.meaningLang }, w.meaning))));
}

/* ---------- the overview ---------- */

export async function renderListening(root) {
  const state = await listeningState();
  const s = await studySettings();
  const replies = state.sets.find((x) => x.kind === 'replies');
  const contrasts = state.sets.find((x) => x.kind === 'contrasts');
  const sounds = contrasts
    ? [...new Map(contrasts.items.map((w) => [w.setId, w])).values()].map((first) => ({
        sound: first.sound, note: first.note,
        pairs: [...new Set(contrasts.items.filter((w) => w.setId === first.setId).map((w) => w.pair))],
      }))
    : [];

  root.append(
    el('div', { class: 'screen listening' },
      header(t('listening.title'), t('listening.lede')),
      el('section', { class: 'kana-panel listen-panel' },
        meter(state.progress),
        el('a', { class: 'btn btn-primary btn-lg full', href: link('/listening/drill') },
          t(state.doneToday ? 'listening.another' : 'listening.today')),
        el('p', { class: 'muted small' }, t('listening.rule', { streak: STREAK, days: DAYS }))),

      replies
        ? el('section', {},
            el('h2', { class: 'section-title' }, `${replies.icon || ''} ${replies.title}`),
            el('p', { class: 'muted small' }, replies.description),
            el('div', { class: 'phrase-list' }, replies.items.map((item) =>
              el('article', { class: 'phrase-card listen-line', dataset: { item: item.id } },
                who(item.speaker) ? el('div', { class: 'dialogue-who' }, who(item.speaker)) : null,
                el('div', { class: 'phrase-main' }, phraseBlock(item, s), audioButton(item, playItem)),
                item.reply ? replyBlock(item.reply, s) : null,
                item.note ? el('div', { class: 'notes' }, el('div', { class: 'note' }, item.note)) : null))))
        : null,

      contrasts
        ? el('section', {},
            el('h2', { class: 'section-title' }, `${contrasts.icon || ''} ${contrasts.title}`),
            el('p', { class: 'muted small' }, contrasts.description),
            sounds.map((x) => el('div', { class: 'contrast-set' },
              el('h3', { class: 'contrast-sound' }, x.sound),
              x.note ? el('p', { class: 'muted small' }, x.note) : null,
              x.pairs.map((pair) => pairButtons(pair)))))
        : null)
  );
}

/* ---------- the drill ---------- */

export async function renderListeningDrill(root) {
  const state = await listeningState();
  const s = await studySettings();
  const questions = buildListeningDrill(state.items, state.stats);
  const view = el('div', { class: 'screen kana-drill listen-drill' });
  root.append(view);
  if (!questions.length) {
    view.append(el('a', { class: 'back-link', href: link('/listening') }, t('study.back')),
      el('p', { class: 'muted' }, t('drill.none')));
    return;
  }

  let index = 0;
  let right = 0;
  let onKey = null;

  const top = () => el('div', { class: 'study-top' },
    el('a', { class: 'back-link', href: link('/listening') }, '✕'),
    el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${(index / questions.length) * 100}%` })),
    el('span', { class: 'muted small' }, `${index}/${questions.length}`));

  /** After an answer: what was said and how to answer it — or both words of the pair, to compare. */
  function shownAfter(q) {
    const { item } = q;
    if (q.type === 'contrast') {
      return [pairButtons(item.pair, item.id), item.note ? el('p', { class: 'muted small' }, item.note) : null];
    }
    return [
      el('div', { class: 'drill-answer' },
        who(item.speaker) ? el('div', { class: 'dialogue-who' }, who(item.speaker)) : null,
        el('div', { class: 'phrase-main' }, phraseBlock(item, s), audioButton(item, playItem))),
      item.reply ? replyBlock(item.reply, s) : null,
      item.note ? el('p', { class: 'muted small' }, item.note) : null,
    ];
  }

  function ask() {
    if (index >= questions.length) { finish(); return; }
    const q = questions[index];
    const { item } = q;
    const reply = q.type === 'reply';
    const question = choiceQuestion({
      kind: t(reply ? 'listening.whatSaid' : 'listening.whichHeard'),
      prompt: [el('div', { class: 'listen-row' },
        el('button', { type: 'button', class: 'btn listen-btn', onclick: () => audio.play(item.audio) }, t('study.playAgain')),
        el('button', {
          type: 'button', class: 'btn listen-btn listen-slow', onclick: () => audio.play(item.audio, { rate: audio.SLOW }),
        }, t('study.playSlow')))],
      options: q.options.map((o) => ({
        id: o.id,
        className: reply ? 'listen-option' : 'contrast-option',
        node: reply
          ? el('span', { lang: o.meaningLang }, o.meaning)
          : el('span', { class: 'contrast-choice' },
              el('span', { class: 'contrast-word', lang: o.targetLang }, o.target),
              el('span', { class: 'contrast-meaning muted small', lang: o.meaningLang }, o.meaning)),
      })),
      rightId: item.id,
      verdicts: { right: t('drill.right'), wrong: t('drill.wrong') },
      onAnswer: async (ok) => {
        if (ok) right++;
        await deck.recordListen(item.id, ok);
        return shownAfter(q);
      },
      next: { label: t(index + 1 < questions.length ? 'drill.next' : 'drill.finish'), go: () => { index++; ask(); } },
      // A sound pair answered right moves on by itself; a reply has its answer to read.
      autoAdvance: !reply,
      cardClass: 'listen-question',
      optionsClass: reply ? 'listen-options' : 'contrast-options',
      dataset: { listen: q.type, item: item.id },
    });
    onKey = (k) => question.key(k);
    clear(view).append(top(), question.node);
    audio.play(item.audio);
  }

  async function finish() {
    onKey = null;
    await deck.finishListenDrill(questions.length);
    const after = await listeningState();
    const gained = after.progress.mastered - state.progress.mastered;
    clear(view).append(
      el('div', { class: 'empty-state practice-done' },
        el('h1', {}, t('listening.drillDone')),
        el('p', { class: 'lede' }, t('drill.score', { right, total: questions.length })),
        gained > 0 ? el('p', {}, t('listening.newlyMastered', { n: gained })) : null,
        meter(after.progress),
        el('div', { class: 'action-row' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => renderListeningDrill(clear(root)) },
            t('listening.another')),
          el('a', { class: 'btn', href: link('/') }, t('listening.backToday')))));
  }

  const keydown = (e) => {
    if (!view.isConnected) { document.removeEventListener('keydown', keydown); return; }
    if (onKey && (e.key === 'Enter' || /^[1-9]$/.test(e.key))) { e.preventDefault(); onKey(e.key); }
  };
  document.addEventListener('keydown', keydown);
  ask();
}
