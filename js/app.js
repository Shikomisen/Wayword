/**
 * app.js — router + screens.
 *
 * Vanilla ES modules, hash routing, no build step (README §3).
 * Screens render into #app; each render is a full teardown, which is fine
 * at this scale and removes a whole class of stale-state bugs.
 *
 * URLs carry the course: #/ is the language picker (home.js), and every
 * study screen lives under its course, e.g. #/en-ja/browse or #/ja-en/review.
 * Entering a course switches storage, interface language and content to it
 * in one step (course.js), so the screens below never mention a language.
 */

import { loadContent, getCategory, getCharacterSet, scenariosFor } from './content.js';
import * as deck from './deck.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import * as store from './store.js';
import * as course from './course.js';
import { t, setLang, locale, formatInterval } from './i18n.js';
import {
  el, clear, phraseBlock, targetNode, meaningNode, notesBlock, tagRow, audioButton, toast, registerBadge, politeBlock,
} from './render.js';
import { renderPlacement } from './quiz.js';
import { renderScenarioList, renderScenario } from './scenario.js';
import { renderCharacterList, renderCharacterSet } from './characters.js';
import { renderHome, renderPlannedCourse } from './home.js';

const app = () => document.getElementById('app');
const { link } = course;

/* ---------- routing ---------- */

// Paths inside a course, after the #/<course> prefix.
const routes = [
  [/^\/?$/, today],
  [/^\/browse$/, browse],
  [/^\/category\/([\w-]+)$/, category],
  [/^\/study\/([\w-]+)$/, studyCategory],
  [/^\/review$/, review],
  [/^\/scenarios$/, (root) => renderScenarioList(root)],
  [/^\/scenario\/([\w-]+)$/, (root, id) => renderScenario(root, id)],
  // Order matters: /characters/review must match before /characters/:id.
  [/^\/characters$/, (root) => renderCharacterList(root)],
  [/^\/characters\/review$/, reviewCharacters],
  [/^\/characters\/([\w-]+)\/study$/, studyCharacterSet],
  [/^\/characters\/([\w-]+)$/, (root, id) => renderCharacterSet(root, id)],
  [/^\/settings$/, settings],
];

const COURSE_PATH = /^\/([a-z]{2}-[a-z]{2})(\/.*)?$/;

function parseHash() {
  return decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
}

/** Navigate within the current course: go('/browse') → #/<course>/browse. */
export const go = course.go;

async function router() {
  const path = parseHash();

  if (path === '/') return showHome();

  const m = path.match(COURSE_PATH);
  const target = m ? await course.getCourse(m[1]) : null;

  if (!target) {
    // Links from before courses existed (#/review, #/browse — the installed
    // app's own shortcuts among them) belong to a course: send them to the
    // one used last, which for anyone who had those links is Japanese.
    const legacy = routes.some(([pattern]) => pattern.test(path));
    const id = legacy ? (await course.getPrefs()).lastCourse || 'en-ja' : null;
    window.history.replaceState(null, '', legacy ? `#/${id}${path}` : '#/');
    return router();
  }

  const sub = m[2] || '/';
  const { features } = await enterCourse(target);

  if (target.status !== 'available') {
    const root = clear(app());
    window.scrollTo(0, 0);
    return renderPlannedCourse(root, target);
  }

  // The placement quiz gates each course on its first visit (README §4.1).
  if (!(await deck.isOnboarded())) {
    const root = clear(app());
    document.body.classList.add('onboarding');
    return renderPlacement(root, {
      onDone: (next = '/') => {
        document.body.classList.remove('onboarding');
        go(next);
        router();
      },
    });
  }
  document.body.classList.remove('onboarding');

  for (const [pattern, handler] of routes) {
    const match = sub.match(pattern);
    if (!match) continue;
    // Sections a course doesn't have (Characters for English) are not routable.
    if (/^\/characters/.test(sub) && !features.characters) break;
    const root = clear(app());
    window.scrollTo(0, 0);
    try {
      await handler(root, ...match.slice(1));
    } catch (err) {
      console.error(err);
      root.append(el('div', { class: 'screen' }, el('p', { class: 'error' }, String(err.message || err))));
    }
    highlightNav(sub);
    return;
  }
  go('/');
}

async function showHome() {
  document.body.classList.add('at-home');
  document.body.classList.remove('onboarding');
  const root = clear(app());
  window.scrollTo(0, 0);
  await renderHome(root);
}

let enteredCourse = null;

/**
 * Activate a course and dress the chrome for it. Everything that should
 * happen once per visit to a course — remembering it as the last one,
 * the week-one romaji switch-off — happens only when the course changes.
 */
async function enterCourse(target) {
  await course.setCourse(target.id);
  document.body.classList.remove('at-home');
  renderCourseBar(target);

  if (target.status !== 'available') {
    document.body.classList.add('no-tabs');
    enteredCourse = target.id;
    return { features: {} };
  }
  document.body.classList.remove('no-tabs');

  const { features } = await loadContent();
  renderTabbar(features);

  if (enteredCourse !== target.id) {
    enteredCourse = target.id;
    await course.savePrefs({ lastCourse: target.id, speaker: target.speaker });
    if (features.reading && (await deck.maybeRetireRomaji())) {
      toast(t('toast.romajiRetired'), 5000);
    }
  }
  return { features };
}

/** "‹ Languages · English › Japanese" — the way back to the picker, and the pair in use. */
function renderCourseBar(target) {
  const bar = document.getElementById('coursebar');
  if (!bar) return;
  const ui = target.speaker;
  clear(bar).append(
    el('a', { class: 'coursebar-home', href: '#/' }, `‹ ${t('coursebar.home')}`),
    el('span', { class: 'coursebar-pair' },
      t('coursebar.pair', {
        speaker: course.languageName(target.speaker, ui),
        target: course.languageName(target.target, ui),
      })));
}

function renderTabbar(features) {
  const nav = document.querySelector('.tabbar');
  if (!nav) return;
  const tabs = [
    ['/', '📅', t('tab.today')],
    ['/browse', '📚', t('tab.browse')],
    features.characters ? ['/characters', 'あ', t('tab.characters')] : null,
    features.scenarios ? ['/scenarios', '🗣️', t('tab.scenarios')] : null,
    ['/settings', '⚙️', t('tab.settings')],
  ].filter(Boolean);
  clear(nav).append(...tabs.map(([path, icon, label]) =>
    el('a', { href: link(path), dataset: { path } }, el('span', {}, icon), label)));
}

function highlightNav(path) {
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const target = a.dataset.path;
    // Sub-routes keep their section lit: /characters/hiragana is still
    // "Characters", /category/airport is still "Browse".
    const owns = target === '/'
      ? path === '/'
      : path === target || path.startsWith(`${target}/`);
    a.classList.toggle('active', owns);
  });
}

/* ---------- shared bits ---------- */

function header(title, subtitle) {
  return el('header', { class: 'screen-header' },
    el('h1', {}, title),
    subtitle ? el('p', { class: 'lede' }, subtitle) : null);
}

async function playPhrase(phrase) {
  const result = await audio.play(phrase.audio);
  if (result === 'missing') toast(t('audio.missing'));
  return result;
}

/**
 * Inline furigana/romaji toggles (README §6, Day 2).
 *
 * Deliberately duplicated next to the content rather than buried in
 * Settings: deciding whether you need the reading is a per-card judgement
 * made mid-study, and a trip to Settings to check yourself is a trip you
 * won't make. Only the aids a course's content actually has are offered.
 */
function toggleStrip(onChange, features) {
  const wanted = [
    features.ruby ? ['furigana', features.aids.ruby?.chip || 'ruby'] : null,
    features.reading ? ['romaji', features.aids.reading?.chip || 'reading'] : null,
  ].filter(Boolean);
  if (!wanted.length) return null;

  const make = async (key, label) => {
    const s = await deck.getSettings();
    return el('button', {
      class: `chip ${s[key] ? 'chip-on' : ''}`,
      type: 'button',
      'aria-pressed': s[key] ? 'true' : 'false',
      onclick: async () => {
        const cur = await deck.getSettings();
        await deck.saveSettings({ [key]: !cur[key] });
        onChange();
      },
    }, label);
  };

  const strip = el('div', { class: 'toggle-strip' });
  Promise.all(wanted.map(([key, label]) => make(key, label)))
    .then((chips) => chips.forEach((c) => strip.append(c)));
  return strip;
}

/* ---------- today ---------- */

async function today(root) {
  const [summary, stats, streakDays, s, { categories, features }] = await Promise.all([
    deck.deckSummary(), deck.todayStats(), deck.streak(), deck.getSettings(), loadContent(),
  ]);

  const q = await deck.queue();
  const activeCats = categories.filter((c) => s.activeCategories.includes(c.id));

  root.append(
    el('div', { class: 'screen' },
      header(t('today.title'), dueLine(q.length, summary)),

      el('div', { class: 'stat-row' },
        stat(summary.due, t('stat.due')),
        stat(Math.min(summary.new, s.newPerDay), t('stat.new')),
        stat(stats.reviews, t('stat.doneToday')),
        stat(streakDays, t('stat.streak'))),

      q.length
        ? el('div', {},
            el('button', { class: 'btn btn-primary btn-lg full', onclick: () => go('/review') },
              t('today.startReview', { n: q.length })),
            queueBreakdown(q))
        : el('div', { class: 'empty-state' },
            el('p', {}, t('today.nothingDue')),
            el('p', { class: 'muted' }, t('today.nothingDueHint')),
            el('button', { class: 'btn btn-primary', onclick: () => go('/browse') }, t('today.browse'))),

      el('h2', { class: 'section-title' }, t('today.inDeck')),
      el('div', { class: 'card-list' },
        activeCats.length
          ? await Promise.all(activeCats.map(categoryRow))
          : el('p', { class: 'muted' }, t('today.noCategories'))),

      features.characters ? await charactersBlock() : null,
      await forecastBlock(),

      el('button', { class: 'btn btn-ghost full', onclick: () => go('/browse') }, t('today.addMore'))
    )
  );
}

/**
 * Characters get their own row rather than being folded into the counts
 * above — the whole point of the separate deck is that 40 kana drills
 * don't disguise themselves as phrase progress.
 */
async function charactersBlock() {
  const summary = await deck.characterSummary();
  if (!summary.total) {
    return el('section', {},
      el('h2', { class: 'section-title' }, t('reading.title')),
      el('a', { class: 'row-card', href: link('/characters') },
        el('span', { class: 'row-icon char-icon' }, 'あ'),
        el('span', { class: 'row-body' },
          el('span', { class: 'row-title' }, t('reading.characters')),
          el('span', { class: 'row-sub' }, t('reading.notAdded'))),
        el('span', { class: 'row-chev' }, '›')));
  }

  const pending = summary.due + Math.min(summary.new, 15);
  return el('section', {},
    el('h2', { class: 'section-title' }, t('reading.title')),
    el('a', { class: 'row-card', href: link(pending ? '/characters/review' : '/characters') },
      el('span', { class: 'row-icon char-icon' }, 'あ'),
      el('span', { class: 'row-body' },
        el('span', { class: 'row-title' }, t('reading.characters')),
        el('span', { class: 'row-sub' },
          pending
            ? t('reading.pending', { due: summary.due, unseen: summary.new })
            : t('reading.caughtUp', { mature: summary.mature })),
        el('span', { class: 'bar' },
          el('span', {
            class: 'bar-fill',
            style: `width:${summary.total ? Math.round(((summary.total - summary.new) / summary.total) * 100) : 0}%`,
          }))),
      el('span', { class: 'row-chev' }, '›')));
}

/** What's actually in today's queue, split by why it's there. */
function queueBreakdown(queue) {
  const fresh = queue.filter((c) => c.state === 'new').length;
  const relearn = queue.filter((c) => c.state === 'learning').length;
  const due = queue.length - fresh - relearn;
  const parts = [
    due && t('queue.toReview', { n: due }),
    relearn && t('queue.relearning', { n: relearn }),
    fresh && t('queue.new', { n: fresh }),
  ].filter(Boolean);
  return el('p', { class: 'muted small queue-breakdown' }, parts.join(' · '));
}

/**
 * Seven-day forecast straight off the SRS due dates — the thing that makes
 * the scheduler legible rather than a black box, and shows why adding six
 * categories at once is a bad idea.
 */
async function forecastBlock() {
  const s = await deck.getSettings();
  const active = new Set(s.activeCategories);
  const cards = (await deck.getDeck()).filter((c) => active.has(c.categoryId) && c.state !== 'new');

  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const count = cards.filter((c) =>
      i === 0 ? c.due < end.getTime() : c.due >= start.getTime() && c.due < end.getTime()
    ).length;
    return { label: i === 0 ? t('forecast.today') : start.toLocaleDateString(locale(), { weekday: 'short' }), count };
  });

  const peak = Math.max(1, ...days.map((d) => d.count));

  return el('section', {},
    el('h2', { class: 'section-title' }, t('forecast.title')),
    el('div', { class: 'forecast' },
      days.map((d) =>
        el('div', { class: 'forecast-day' },
          el('div', { class: 'forecast-bar' },
            el('div', { class: 'forecast-fill', style: `height:${(d.count / peak) * 100}%` })),
          el('div', { class: 'forecast-count' }, String(d.count)),
          el('div', { class: 'forecast-label muted small' }, d.label)))));
}

function dueLine(queueLength, summary) {
  if (!summary.total) return t('today.empty');
  if (!queueLength) return t('today.caughtUp');
  return t('today.waiting', { n: queueLength, mature: summary.mature });
}

function stat(value, label) {
  return el('div', { class: 'stat' }, el('div', { class: 'stat-value' }, String(value)), el('div', { class: 'stat-label' }, label));
}

async function categoryRow(cat) {
  const p = await deck.categoryProgress(cat.id);
  const studied = p.total - p.new;
  const pct = p.total ? Math.round((studied / p.total) * 100) : 0;
  return el('a', { class: 'row-card', href: link(`/category/${cat.id}`) },
    el('span', { class: 'row-icon' }, cat.icon || '📄'),
    el('span', { class: 'row-body' },
      el('span', { class: 'row-title' }, cat.title),
      el('span', { class: 'row-sub' },
        p.total
          ? t('category.progress', { studied, total: p.total, due: p.due })
          : t('category.count', { n: cat.phrases.length })),
      el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` }))),
    el('span', { class: 'row-chev' }, '›'));
}

/* ---------- browse ---------- */

async function browse(root) {
  const { categories, manifest } = await loadContent();
  const s = await deck.getSettings();

  // Groups and their titles come from the course manifest, in its own
  // language. A manifest without groups shows one untitled list.
  const groups = manifest.groups?.length ? manifest.groups : [{ id: undefined, title: null }];

  root.append(
    el('div', { class: 'screen' },
      header(t('browse.title'), t('browse.lede')),
      groups.map((group) => {
        const inGroup = categories.filter((c) => c.group === group.id);
        if (!inGroup.length) return null;
        return el('section', {},
          group.title ? el('h2', { class: 'section-title' }, group.title) : null,
          el('div', { class: 'card-list' }, inGroup.map((cat) => browseRow(cat, s))));
      })
    )
  );
}

function browseRow(cat, s) {
  const active = s.activeCategories.includes(cat.id);
  return el('div', { class: `row-card ${active ? 'is-active' : ''}` },
    el('span', { class: 'row-icon' }, cat.icon || '📄'),
    el('a', { class: 'row-body', href: link(`/category/${cat.id}`) },
      el('span', { class: 'row-title' }, cat.title),
      el('span', { class: 'row-sub' },
        cat.missing ? t('browse.missing') : t('category.count', { n: cat.phrases.length }))),
    active
      ? el('span', { class: 'pill pill-on' }, t('browse.inDeck'))
      : el('button', {
          class: 'btn btn-small',
          onclick: async (e) => {
            e.preventDefault();
            const { added, seeded } = await deck.activateCategory(cat.id);
            toast(seeded ? t('browse.addedSeeded', { added, seeded }) : t('browse.added', { added }));
            router();
          },
        }, t('browse.add')));
}

/* ---------- category detail ---------- */

async function category(root, id) {
  const cat = await getCategory(id);
  if (!cat) { go('/browse'); return; }
  const { features } = await loadContent();
  const s = await deck.getSettings();
  const active = s.activeCategories.includes(id);
  const progress = await deck.categoryProgress(id);
  const scenarios = await scenariosFor(id);

  root.append(
    el('div', { class: 'screen' },
      el('a', { class: 'back-link', href: link('/browse') }, t('category.back')),
      header(`${cat.icon || ''} ${cat.title}`, cat.description),

      scenarios.length
        ? el('div', { class: 'card-list scenario-teaser' },
            scenarios.map((sc) =>
              el('a', { class: 'row-card', href: link(`/scenario/${sc.id}`) },
                el('span', { class: 'row-icon' }, sc.icon || '🗣️'),
                el('span', { class: 'row-body' },
                  el('span', { class: 'row-title' }, sc.title),
                  el('span', { class: 'row-sub' }, t('category.practise'))),
                el('span', { class: 'row-chev' }, '›'))))
        : null,

      toggleStrip(router, features),

      el('div', { class: 'action-row' },
        active
          ? el('button', { class: 'btn btn-primary', onclick: () => go(`/study/${id}`) }, t('category.study'))
          : el('button', {
              class: 'btn btn-primary',
              onclick: async () => {
                const { added } = await deck.activateCategory(id);
                toast(t('category.addedToDeck', { added }));
                router();
              },
            }, t('category.add')),
        active ? el('span', { class: 'muted small' }, t('category.dueNew', { due: progress.due, fresh: progress.new })) : null),

      el('div', { class: 'phrase-list' },
        cat.phrases.map((p) => phraseCard(p, s)))
    )
  );
}

function phraseCard(phrase, s) {
  const node = el('article', { class: 'phrase-card' },
    el('div', { class: 'phrase-main' },
      phraseBlock(phrase, s),
      audioButton(phrase, playPhrase)),
    politeBlock(phrase, s, playPhrase),
    notesBlock(phrase),
    tagRow(phrase));
  return node;
}

/* ---------- study & review ---------- */

async function studyCategory(root, id) {
  const cat = await getCategory(id);
  if (!cat) { go('/browse'); return; }
  if (!(await deck.isActive(id))) await deck.activateCategory(id);

  const all = await deck.getDeck();
  const scoped = all.filter((c) => c.categoryId === id);
  const s = await deck.getSettings();
  const queue = srs.buildQueue(scoped, { newLimit: s.newPerDay });

  if (!queue.length) {
    root.append(emptyStudy(t('study.nothingIn', { title: cat.title }), link(`/category/${id}`)));
    return;
  }

  await runSession(root, queue, { title: cat.title, exitTo: link(`/category/${id}`) });
}

async function review(root) {
  const queue = await deck.queue();
  if (!queue.length) { go('/'); return; }
  await runSession(root, queue, { title: t('today.title'), exitTo: link('/') });
}

/**
 * Character review. Same flashcard loop as phrases — character content is
 * phrase-shaped, so runSession needs no branching — but fed from the
 * separate character queue so the two decks never mix.
 */
async function reviewCharacters(root) {
  const queue = await deck.characterQueue();
  if (!queue.length) {
    root.append(emptyStudy('Nothing due in your character sets.', link('/characters')));
    return;
  }
  await runSession(root, queue, { title: 'Characters', exitTo: link('/characters') });
}

async function studyCharacterSet(root, setId) {
  const set = await getCharacterSet(setId);
  if (!set) { go('/characters'); return; }
  if (!(await deck.isSetActive(setId))) await deck.activateCharacterSet(setId);

  const queue = await deck.characterQueue(setId);
  if (!queue.length) {
    root.append(emptyStudy(t('study.nothingIn', { title: set.title }), link(`/characters/${setId}`)));
    return;
  }
  await runSession(root, queue, { title: set.title, exitTo: link(`/characters/${setId}`) });
}

function emptyStudy(message, backTo) {
  return el('div', { class: 'screen' },
    el('a', { class: 'back-link', href: backTo }, t('study.back')),
    el('div', { class: 'empty-state' },
      el('p', {}, message),
      el('p', { class: 'muted' }, t('study.scheduledOut')),
      el('button', { class: 'btn btn-primary', onclick: () => go('/') }, t('study.backToToday'))));
}

/**
 * The core study loop. Front = the language being learned; flip reveals
 * the meaning and notes; grading feeds SM-2. Failed cards are pushed back
 * into the same session rather than disappearing for ten minutes.
 */
async function runSession(root, queue, { exitTo }) {
  const { phrases, features } = await loadContent();
  const s = await deck.getSettings();
  const total = queue.length;
  let done = 0;
  let flipped = false;
  let cards = [...queue];

  const view = el('div', { class: 'screen study' });
  root.append(view);

  async function draw() {
    if (!cards.length) return finish();
    const card = cards[0];
    const phrase = phrases.get(card.id);
    if (!phrase) { cards.shift(); return draw(); } // content removed under us
    clear(view);

    // Re-read settings each draw so the inline toggles take effect immediately.
    Object.assign(s, await deck.getSettings());

    const previews = srs.gradePreviews(card, Date.now(), formatInterval);

    // Native append() would print a null child as the text "null" (a course
    // with no reading aids has no toggle strip), so drop the gaps first.
    view.append(...[
      el('div', { class: 'study-top' },
        el('a', { class: 'back-link', href: exitTo }, '✕'),
        el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${(done / total) * 100}%` })),
        el('span', { class: 'muted small' }, `${done}/${total}`)),

      el('div', {
        class: `study-card ${flipped ? 'flipped' : ''}`,
        onclick: () => { if (!flipped) { flipped = true; draw(); } },
      },
        el('div', { class: 'card-cat muted small' },
          phrase.categoryTitle, phrase.register ? ' ' : null, registerBadge(phrase)),
        targetNode(phrase, { furigana: s.furigana }),
        s.romaji && phrase.reading ? el('div', { class: 'romaji' }, phrase.reading) : null,
        audioButton(phrase, playPhrase),

        flipped
          ? el('div', { class: 'study-back' },
              meaningNode(phrase, { big: true }),
              politeBlock(phrase, s, playPhrase),
              notesBlock(phrase),
              tagRow(phrase))
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

    if (s.autoPlayAudio && flipped) audio.play(phrase.audio);
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
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!flipped) { flipped = true; draw(); } }
    else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
      submit([srs.GRADE.AGAIN, srs.GRADE.HARD, srs.GRADE.GOOD, srs.GRADE.EASY][Number(e.key) - 1]);
    }
  };
  document.addEventListener('keydown', onKey);

  draw();
}

/* ---------- settings ---------- */

async function settings(root) {
  const s = await deck.getSettings();
  const { features, course: current } = await loadContent();
  const summary = await deck.deckSummary();
  const chars = features.characters ? await deck.characterSummary() : null;
  const textScale = await course.getTextScale();

  const toggle = (key, label, help) =>
    el('label', { class: 'setting' },
      el('span', {}, el('strong', {}, label), help ? el('span', { class: 'muted small' }, help) : null),
      el('input', {
        type: 'checkbox', checked: s[key],
        onchange: async (e) => { await deck.saveSettings({ [key]: e.target.checked }); },
      }));

  const pair = t('coursebar.pair', {
    speaker: course.languageName(current.speaker, current.speaker),
    target: course.languageName(current.target, current.speaker),
  });

  root.append(
    el('div', { class: 'screen' },
      header(t('settings.title')),
      el('div', { class: 'settings-list' },
        // The language picker, reachable from inside a course too.
        el('div', { class: 'setting' },
          el('span', {}, el('strong', {}, t('settings.language')), el('span', { class: 'muted small' }, pair)),
          el('a', { class: 'btn btn-small', href: '#/' }, t('settings.changeLanguage'))),
        features.ruby ? toggle('furigana', features.aids.ruby?.label, features.aids.ruby?.help) : null,
        features.reading ? toggle('romaji', features.aids.reading?.label, features.aids.reading?.help) : null,
        toggle('autoPlayAudio', t('settings.autoplay'), t('settings.autoplayHelp')),

        el('label', { class: 'setting' },
          el('span', {}, el('strong', {}, t('settings.newPerDay')), el('span', { class: 'muted small' }, t('settings.newPerDayHelp'))),
          el('input', {
            type: 'number', min: '0', max: '50', value: String(s.newPerDay), class: 'num-input',
            onchange: (e) => deck.saveSettings({ newPerDay: Math.max(0, Number(e.target.value) || 0) }),
          })),

        features.characters
          ? el('label', { class: 'setting' },
              el('span', {},
                el('strong', {}, t('settings.newChars')),
                el('span', { class: 'muted small' }, t('settings.newCharsHelp'))),
              el('input', {
                type: 'number', min: '0', max: '60', value: String(s.newCharsPerDay), class: 'num-input',
                onchange: (e) => deck.saveSettings({ newCharsPerDay: Math.max(0, Number(e.target.value) || 0) }),
              }))
          : null,

        el('label', { class: 'setting' },
          el('span', {}, el('strong', {}, t('settings.textSize')), el('span', { class: 'muted small' }, t('settings.textSizeHelp'))),
          el('input', {
            type: 'range', min: '0.85', max: '1.6', step: '0.05', value: String(textScale),
            onchange: async (e) => { await course.savePrefs({ textScale: Number(e.target.value) }); applyTextSettings(); },
          }))),

      el('h2', { class: 'section-title' }, t('settings.deck')),
      el('p', { class: 'muted' },
        t('settings.phrases', { total: summary.total, review: summary.review, mature: summary.mature })),
      chars
        ? el('p', { class: 'muted' },
            t('settings.characters', { total: chars.total, review: chars.review, mature: chars.mature }))
        : null,
      el('p', { class: 'muted small' }, t('settings.storage', { backend: store.backend() })),

      el('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          const name = course.languageName(current.target, current.speaker);
          if (!confirm(t('settings.resetConfirm', { course: name }))) return;
          await deck.resetEverything();
          location.reload();
        },
      }, t('settings.reset'))
    )
  );
}

/* ---------- boot ---------- */

export async function applyTextSettings() {
  const scale = await course.getTextScale();
  document.documentElement.style.setProperty('--text-scale', String(scale));
}

/**
 * Service workers are only exposed in a secure context. Over plain http://
 * on a LAN IP — how the app gets opened on a phone during development —
 * `navigator.serviceWorker` is not merely restricted, it is absent, so
 * feature detection alone can't tell "old browser" from "wrong protocol".
 */
function secureContextState() {
  if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
  // jsdom and some embedded webviews don't implement it — fall back to the
  // same rule the browsers apply.
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname);
  return location.protocol === 'https:' || local;
}

/**
 * Register the service worker (README §5 — offline-first).
 *
 * `register('sw.js')` is relative to the document, which is what makes the
 * GitHub Pages subpath work: from /Wayword/ it resolves to
 * /Wayword/sw.js and takes /Wayword/ as its scope. Do not make
 * this path absolute.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    // The guard has to stay — without it this throws on any browser or
    // context lacking the API. But it must not fail *silently*, because the
    // usual cause is the page being served over http:// rather than an old
    // browser, and that looks identical from the app's side.
    console.warn(
      secureContextState()
        ? '[wayword] Service workers are not supported by this browser. ' +
          'The app still works; offline mode and install do not.'
        : `[wayword] No service worker: ${location.origin} is not a secure context. ` +
          'Offline mode and install require https:// or http://localhost — a plain ' +
          'http:// LAN address will never register one. Deploy, or use localhost.'
    );
    return Promise.resolve(null);
  }

  return navigator.serviceWorker.register('sw.js')
    .then((reg) => {
      console.info(`[wayword] Service worker registered, scope: ${reg.scope}`);
      return reg;
    })
    .catch((err) => {
      console.warn('[wayword] Service worker registration failed', err);
      return null;
    });
}

async function boot() {
  audio.primeOnFirstGesture();
  // Until a course is entered, speak the learner's language as best we know
  // it — this is also what the boot-error screen below will be shown in.
  const prefs = await course.getPrefs();
  await setLang(prefs.speaker || course.guessSpeaker());
  await applyTextSettings();

  window.addEventListener('hashchange', router);
  await router();
}

/** Last-resort surface so a failed boot isn't an unexplained blank page. */
function showBootError(err) {
  const root = app();
  if (!root) return;
  clear(root).append(
    el('div', { class: 'screen' },
      el('h1', {}, t('error.title')),
      el('p', { class: 'lede' }, t('error.lede')),
      el('p', { class: 'error' }, String((err && err.message) || err)),
      el('p', { class: 'muted small' }, t('error.hint')),
      el('button', { class: 'btn btn-primary', onclick: () => location.reload() }, t('error.reload')))
  );
}

// Registration is deliberately chained off .finally() rather than sitting at
// the end of boot(): it used to be boot()'s last statement, which meant any
// rejection while loading content or rendering the first screen skipped it
// entirely — precisely the failed or offline first load where installing the
// cache matters most, and the failure was silent. Keeping it after boot (not
// before) still avoids competing with first paint for bandwidth.
boot()
  .catch((err) => {
    console.error('[wayword] Boot failed', err);
    showBootError(err);
  })
  .finally(registerServiceWorker);
