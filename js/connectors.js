/**
 * connectors.js — the Connectors course (README §15).
 *
 *   #/<course>/connectors              every lesson, grouped
 *   #/<course>/connectors/<id>         one connector: explanation, when it
 *                                      sounds natural or stiff, examples
 *   #/<course>/connectors/<id>/practice   that lesson's drills
 *   #/<course>/connectors/mixed        drills from every lesson practised so far
 *
 * The drill logic is drills.js; this file draws it. A missed drill sends its
 * sentence to the review deck (deck.recordMiss), and each session's score is
 * kept per lesson (deck.recordPractice).
 */

import { loadContent } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { go, link } from './course.js';
import { t } from './i18n.js';
import {
  el, clear, targetNode, meaningNode, audioButton, phraseBlock, furiganaMode, proseNode,
} from './render.js';
import { header, playItem, studySettings, toggleStrip, wordLinks, lessonsCopy } from './shared.js';
import { DRILL, drillsFor, buildSession, tilesFor, checkTiles, shuffle } from './drills.js';

// A mixed session is short: a few minutes, not a test.
const MIXED_SIZE = 12;

/* ---------- the list ---------- */

export async function renderConnectors(root) {
  const content = await loadContent();
  const stats = await deck.getLessonStats();
  const groups = content.lessonGroups.length ? content.lessonGroups : [{ id: undefined, title: null }];
  const practised = content.lessons.filter((l) => stats[l.id]).length;
  const copy = lessonsCopy(content);
  const lang = content.course.target;

  root.append(
    el('div', { class: 'screen' },
      header(copy.title, copy.lede),
      el('div', { class: 'action-row' },
        el('a', { class: 'btn btn-primary', href: link('/connectors/mixed') }, t('connectors.mixed')),
        el('span', { class: 'muted small' },
          t('connectors.practisedCount', { n: practised, total: content.lessons.length }))),
      groups.map((g) => {
        const lessons = content.lessons.filter((l) => l.group === g.id);
        return lessons.length
          ? el('section', {},
              g.title ? el('h2', { class: 'section-title' }, g.title) : null,
              el('div', { class: 'card-list' }, lessons.map((l) => lessonRow(l, stats[l.id], lang))))
          : null;
      }))
  );
}

function lessonRow(lesson, stat, lang) {
  return el('a', { class: 'row-card lesson-row', href: link(`/connectors/${lesson.id}`), dataset: { lesson: lesson.id } },
    el('span', { class: 'connector-mark', lang }, lesson.connector),
    el('span', { class: 'row-body' },
      el('span', { class: 'row-title' }, lesson.gloss),
      el('span', { class: 'row-sub' }, stat?.best ? t('lesson.best', stat.best) : t('lesson.notPractised'))),
    el('span', { class: 'row-chev' }, '›'));
}

/* ---------- one lesson ---------- */

export async function renderLesson(root, id) {
  const content = await loadContent();
  const lesson = content.byCategory.get(id);
  if (!lesson || lesson.type !== 'lesson') { go('/connectors'); return; }
  const s = await studySettings();
  const mode = furiganaMode(s, null);
  const stat = (await deck.getLessonStats())[id];
  const drills = drillsFor(lesson).length;
  const redraw = () => renderLesson(clear(root), id);

  root.append(
    el('div', { class: 'screen lesson' },
      el('a', { class: 'back-link', href: link('/connectors') }, t('lesson.back', { title: lessonsCopy(content).title })),
      el('header', { class: 'screen-header' },
        el('h1', { class: 'connector-title', lang: content.course.target }, lesson.connector),
        el('p', { class: 'lede' }, lesson.gloss)),
      el('div', { class: 'lesson-pattern' }, el('span', { class: 'note-label' }, t('lesson.pattern')), lesson.pattern),

      el('div', { class: 'action-row' },
        el('a', { class: 'btn btn-primary', href: link(`/connectors/${id}/practice`) }, t('lesson.practise')),
        el('a', { class: 'btn', href: link(`/study/${id}`) }, t('lesson.studyCards')),
        el('span', { class: 'muted small' }, stat?.best ? t('lesson.best', stat.best) : t('lesson.drillCount', { n: drills }))),

      proseNode(lesson.explanation, { furigana: mode, className: 'prose lesson-explanation' }),
      el('div', { class: 'notes' },
        el('div', { class: 'note note-natural' },
          el('span', { class: 'note-label' }, t('lesson.natural')),
          proseNode(lesson.natural, { furigana: mode, tag: 'span' })),
        el('div', { class: 'note note-stiff' },
          el('span', { class: 'note-label' }, t('lesson.stiff')),
          proseNode(lesson.stiff, { furigana: mode, tag: 'span' }))),

      el('h2', { class: 'section-title' }, t('lesson.examples')),
      toggleStrip(redraw, content.features),
      el('div', { class: 'phrase-list' }, lesson.items.map((ex) =>
        el('article', { class: 'phrase-card item-sentence', dataset: { item: ex.id } },
          el('div', { class: 'phrase-main' }, phraseBlock(ex, s), audioButton(ex, playItem)),
          wordLinks(ex, content)))))
  );
}

/* ---------- practice ---------- */

export async function renderPractice(root, lessonId = null) {
  const content = await loadContent();
  const s = await studySettings();
  let lessons;
  if (lessonId) {
    const lesson = content.byCategory.get(lessonId);
    if (!lesson || lesson.type !== 'lesson') { go('/connectors'); return; }
    lessons = [lesson];
  } else {
    // Mixed: the lessons practised so far — or all of them, to begin with.
    const stats = await deck.getLessonStats();
    const practised = content.lessons.filter((l) => stats[l.id]);
    lessons = practised.length ? practised : content.lessons;
  }
  const mixed = !lessonId;
  const session = buildSession(lessons, { size: mixed ? MIXED_SIZE : Infinity });
  const exitPath = lessonId ? `/connectors/${lessonId}` : '/connectors';

  const view = el('div', { class: 'screen practice' });
  root.append(view);
  if (!session.length) {
    view.append(el('a', { class: 'back-link', href: link(exitPath) }, t('study.back')),
      el('p', { class: 'muted' }, t('drill.none')));
    return;
  }

  let index = 0;
  let card = null;                 // the drill on screen: { submit?, next }
  const results = [];              // { drill, right }
  const missed = new Set();
  const pending = [];              // misses being written to the deck

  // Tap-to-show can't work on a tile you tap to move, so tiles show readings
  // unless they're hidden altogether.
  const tileMode = (ex) => (furiganaMode(s, ex) === 'hidden' ? 'hidden' : 'always');

  function draw() {
    if (index >= session.length) { finish(); return; }
    const drill = session[index];
    clear(view).append(
      el('div', { class: 'study-top' },
        el('a', { class: 'back-link', href: link(exitPath) }, '✕'),
        el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${(index / session.length) * 100}%` })),
        el('span', { class: 'muted small' }, `${index}/${session.length}`)),
      drill.type === DRILL.FILL ? fillCard(drill) : tileCard(drill));
  }

  function kindLabel(drill) {
    if (drill.type === DRILL.COMBINE) return t('drill.combine', { connector: drill.lesson.connector });
    return t(drill.type === DRILL.FILL ? 'drill.fill' : 'drill.order');
  }

  /* fill the gap */

  function fillCard(drill) {
    const { ex } = drill;
    // Two ideographic spaces: the width of a short answer, underlined by CSS.
    const gap = el('span', { class: 'gap', 'aria-label': t('drill.fill') }, '　　');
    const feedback = el('div', { class: 'drill-feedback' });
    const options = el('div', { class: 'drill-options' });
    const buttons = shuffle(ex.gap.options).map((option) =>
      el('button', {
        type: 'button', class: 'btn option', dataset: { value: option.notation },
        onclick: () => choose(option),
      }, targetNode(option, { furigana: tileMode(ex) })));
    options.append(...buttons);

    function choose(option) {
      if (card.answered) return;
      card.answered = true;
      const right = ex.gap.options.find((o) => o.verdict === 'right');
      buttons.forEach((b) => {
        b.disabled = true;
        const o = ex.gap.options.find((x) => x.notation === b.dataset.value);
        if (o === option) b.classList.add(`is-${option.verdict}`);
        else if (o === right) b.classList.add('is-answer');
      });
      // The gap shows what was chosen if it works, otherwise the answer.
      clear(gap).append(targetNode(option.verdict === 'wrong' ? right : option, { furigana: tileMode(ex) }));
      gap.classList.add(option.verdict === 'wrong' ? 'is-wrong' : 'is-right');
      const why = option.verdict === 'ok' ? ex.gap.note : option.verdict === 'wrong' ? ex.gap.why : null;
      settle(drill, option.verdict, feedback, why);
    }

    card = {
      answered: false,
      key: (k) => { const n = Number(k); if (n >= 1 && n <= buttons.length) buttons[n - 1].click(); },
    };
    return el('div', { class: 'drill-card', dataset: { drill: drill.type, example: ex.id } },
      el('div', { class: 'drill-kind' }, kindLabel(drill)),
      meaningNode(ex, { big: true }),
      el('div', { class: 'drill-sentence' },
        targetNode(ex.gap.before, { furigana: furiganaMode(s, ex) }), gap,
        targetNode(ex.gap.after, { furigana: furiganaMode(s, ex) })),
      options,
      feedback);
  }

  /* put it in order / join two sentences */

  function tileCard(drill) {
    const { ex } = drill;
    const tiles = tilesFor(drill);
    const placed = [];
    const answerRow = el('div', { class: 'tile-answer' });
    const pool = el('div', { class: 'tile-pool' });
    const feedback = el('div', { class: 'drill-feedback' });
    const check = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => submit() }, t('drill.check'));
    const reset = el('button', {
      type: 'button', class: 'btn btn-ghost', onclick: () => { placed.length = 0; drawTiles(); },
    }, t('drill.reset'));
    const actions = el('div', { class: 'action-row drill-actions' }, reset, check);

    const tileButton = (tile, inAnswer) => el('button', {
      type: 'button', class: 'tile',
      dataset: tile.trap === undefined ? { chunk: String(tile.chunk) } : { trap: String(tile.trap) },
      disabled: card?.answered === true,
      onclick: () => {
        if (card.answered) return;
        if (inAnswer) placed.splice(placed.indexOf(tile), 1);
        else placed.push(tile);
        drawTiles();
      },
    }, targetNode(tile, { furigana: tileMode(ex) }));

    function drawTiles() {
      clear(answerRow).append(...(placed.length
        ? placed.map((tile) => tileButton(tile, true))
        : [el('span', { class: 'tile-hint' }, t('drill.tapPieces'))]));
      clear(pool).append(...tiles.filter((tile) => !placed.includes(tile)).map((tile) => tileButton(tile, false)));
      check.disabled = card.answered || placed.length === 0;
    }

    function submit() {
      if (card.answered || !placed.length) return;
      card.answered = true;
      const right = checkTiles(drill, placed);
      answerRow.classList.add(right ? 'is-right' : 'is-wrong');
      drawTiles();
      actions.hidden = true;
      settle(drill, right ? 'right' : 'wrong', feedback, null);
    }

    const prompt = drill.type === DRILL.ORDER
      ? [meaningNode(ex, { big: true })]
      : [
          el('div', { class: 'combine-parts' },
            el('div', { class: 'combine-part' }, targetNode(ex.combine.a, { furigana: furiganaMode(s, ex) })),
            el('div', { class: 'combine-plus', 'aria-hidden': 'true' }, '＋'),
            el('div', { class: 'combine-part' }, targetNode(ex.combine.b, { furigana: furiganaMode(s, ex) }))),
          meaningNode(ex, { tag: 'p' }),
        ];

    card = { answered: false, key: (k) => { if (k === 'Enter') submit(); } };
    drawTiles();
    return el('div', { class: 'drill-card', dataset: { drill: drill.type, example: ex.id } },
      el('div', { class: 'drill-kind' }, kindLabel(drill)),
      ...prompt,
      answerRow,
      pool,
      actions,
      feedback);
  }

  /* after an answer */

  function settle(drill, verdict, feedback, why) {
    const right = verdict !== 'wrong';
    results.push({ drill, right });
    if (!right && !missed.has(drill.ex.id)) {
      missed.add(drill.ex.id);
      pending.push(deck.recordMiss(drill.ex.id, drill.lesson.id).catch((err) => console.error(err)));
    }
    const last = index + 1 >= session.length;
    const next = el('button', {
      type: 'button', class: 'btn btn-primary btn-lg full drill-next',
      onclick: () => { index++; draw(); },
    }, t(last ? 'drill.finish' : 'drill.next'));
    feedback.append(...[
      el('p', { class: `verdict verdict-${verdict}` }, t(`drill.${verdict}`)),
      why ? proseNode(why, { furigana: furiganaMode(s, drill.ex), className: 'prose muted small' }) : null,
      el('div', { class: 'drill-answer' },
        el('div', { class: 'phrase-main' }, phraseBlock(drill.ex, s), audioButton(drill.ex, playItem))),
      next,
    ].filter(Boolean));
    card.key = (k) => { if (k === 'Enter') next.click(); };
    if (s.autoPlayAudio) audio.playItem(drill.ex);
  }

  async function finish() {
    card = null;
    await Promise.all(pending);
    const byLesson = {};
    for (const r of results) {
      const b = (byLesson[r.drill.lesson.id] ??= { right: 0, total: 0 });
      b.total += 1;
      if (r.right) b.right += 1;
    }
    await deck.recordPractice(byLesson);
    const right = results.filter((r) => r.right).length;
    clear(view).append(
      el('div', { class: 'empty-state practice-done' },
        el('h1', {}, t('drill.done')),
        el('p', { class: 'lede' }, t('drill.score', { right, total: results.length })),
        missed.size ? el('p', { class: 'muted' }, t('drill.missed', { n: missed.size })) : null,
        el('div', { class: 'action-row' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => renderPractice(clear(root), lessonId) },
            t('drill.again')),
          el('a', { class: 'btn', href: link(exitPath) }, t(lessonId ? 'drill.backToLesson' : 'drill.backToList')))));
  }

  // Keyboard: 1–4 pick an option, Enter checks or moves on.
  const onKey = (e) => {
    if (!view.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (!card || e.target?.closest?.('input, textarea')) return;
    if (e.key === 'Enter' || /^[1-9]$/.test(e.key)) { e.preventDefault(); card.key(e.key); }
  };
  document.addEventListener('keydown', onKey);

  draw();
}
