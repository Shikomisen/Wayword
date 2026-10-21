/**
 * app.js — router + screens.
 *
 * Vanilla ES modules, hash routing, no build step (README §4).
 * Screens render into #app; each render is a full teardown, which is fine
 * at this scale and removes a whole class of stale-state bugs.
 *
 * URLs carry the course: #/ is the language picker (home.js), and every
 * study screen lives under its course, e.g. #/en-ja/browse or #/ja-en/review.
 * Entering a course switches storage, interface language and content to it
 * in one step (course.js), so the screens below never mention a language.
 *
 * The flashcard session is study.js, your own words are mine.js; this file
 * keeps the router, the chrome, and the Today / Learn / deck / Settings
 * screens.
 */

import { loadContent, getCategory, getCharacterSet, scenariosFor, USER_DECK } from './content.js';
import * as deck from './deck.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import * as store from './store.js';
import * as course from './course.js';
import { t, setLang, locale, getLang } from './i18n.js';
import * as backup from './backup.js';
import { el, clear, phraseBlock, notesBlock, tagRow, audioButton, toast, politeBlock } from './render.js';
import {
  header, stat, playItem, studySettings, toggleStrip, deckHref, wordLinks, sentenceLinks, lessonsCopy, addDeck, removeDeck,
  shownLevel, levelHead,
} from './shared.js';
import { levelsUpTo } from './levels.js';
import { renderPlacement } from './quiz.js';
import { renderScenarioList, renderScenario } from './scenario.js';
import { renderCharacterList, renderCharacterSet } from './characters.js';
import { renderHome, renderPlannedCourse } from './home.js';
import { runSession } from './study.js';
import { renderMine, renderMineForm } from './mine.js';
import { renderPaste, renderMessage, dictionaryCredit } from './paste.js';
import { renderConnectors, renderLesson, renderPractice } from './connectors.js';
import { renderKanaDrill, kanaState, refreshKanaAids, SCRIPT_NAMES } from './reading.js';
import {
  keepOffline, offlineStatus, useConnection, connectionMode, offlineForNowSince, CONNECTION_MODES,
} from './offline.js';
import { renderListening, renderListeningDrill, listeningState } from './listen-drill.js';
import { VERSION } from './version.js';
import { watchForUpdates, onUpdateReady, updateReady, checkForUpdate } from './updates.js';

const app = () => document.getElementById('app');
const { link } = course;

/* ---------- routing ---------- */

// Paths inside a course, after the #/<course> prefix.
const routes = [
  [/^\/?$/, today],
  [/^\/browse$/, learn],
  [/^\/category\/([\w-]+)$/, deckScreen],
  [/^\/study\/([\w-]+)$/, studyDeck],
  [/^\/review$/, review],
  [/^\/mine$/, (root) => renderMine(root)],
  [/^\/mine\/new$/, (root) => renderMineForm(root, null)],
  // Order matters: /mine/paste must match before /mine/:id.
  [/^\/mine\/paste$/, (root) => renderPaste(root)],
  [/^\/mine\/paste\/([\w-]+)$/, (root, id) => renderMessage(root, id)],
  [/^\/mine\/([\w-]+)$/, (root, id) => renderMineForm(root, id)],
  // Order matters: /connectors/mixed must match before /connectors/:id.
  [/^\/connectors$/, (root) => renderConnectors(root)],
  [/^\/connectors\/mixed$/, (root) => renderPractice(root, null)],
  [/^\/connectors\/([\w-]+)\/practice$/, (root, id) => renderPractice(root, id)],
  [/^\/connectors\/([\w-]+)$/, (root, id) => renderLesson(root, id)],
  [/^\/listening$/, (root) => renderListening(root)],
  [/^\/listening\/drill$/, (root) => renderListeningDrill(root)],
  [/^\/scenarios$/, (root) => renderScenarioList(root)],
  [/^\/scenario\/([\w-]+)$/, (root, id) => renderScenario(root, id)],
  // Order matters: /characters/review and /characters/drill must match before /characters/:id.
  [/^\/characters$/, (root) => renderCharacterList(root)],
  [/^\/characters\/review$/, reviewCharacters],
  [/^\/characters\/drill\/(hiragana|katakana)$/, (root, script) => renderKanaDrill(root, script)],
  [/^\/characters\/([\w-]+)\/study$/, studyCharacterSet],
  [/^\/characters\/([\w-]+)$/, (root, id) => renderCharacterSet(root, id)],
  [/^\/settings$/, (root) => settings(root)],
  [/^\/settings\/data$/, (root) => settings(root, 'data')],
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
  let entered;
  try {
    entered = await enterCourse(target);
  } catch (err) {
    // Offline, in a course this device never downloaded: say so, not "Something went wrong".
    if (!err?.offline) throw err;
    return notDownloaded();
  }
  const { features } = entered;

  if (target.status !== 'available') {
    const root = clear(app());
    window.scrollTo(0, 0);
    return renderPlannedCourse(root, target);
  }

  // The placement quiz gates each course on its first visit (README §7.4).
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
    if (/^\/connectors/.test(sub) && !features.lessons) break;
    if (/^\/listening/.test(sub) && !features.listening) break;
    if (/^\/mine\/paste/.test(sub) && !features.dictionary) break;
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

/**
 * A course opened offline before it was ever downloaded here. In offline
 * mode, that's because nothing downloads: the way out is to go online.
 */
function notDownloaded() {
  document.body.classList.add('no-tabs');
  const root = clear(app());
  window.scrollTo(0, 0);
  const offlineMode = connectionMode() === 'offline';
  root.append(
    el('div', { class: 'screen' },
      header(t('offline.notSavedTitle'), t(offlineMode ? 'offline.notSavedOfflineMode' : 'offline.notSaved')),
      el('div', { class: 'action-row' },
        offlineMode
          ? el('button', {
              type: 'button', class: 'btn btn-primary', dataset: { action: 'go-online' },
              onclick: async () => { await setConnection('online'); router(); },
            }, t('offline.goOnline'))
          : null,
        el('a', { class: offlineMode ? 'btn' : 'btn btn-primary', href: '#/' }, t('offline.toPicker')))));
}

let enteredCourse = null;

/**
 * Activate a course and dress the chrome for it. Everything that should
 * happen once per visit to a course — remembering it as the last one, the
 * first-week romaji switch-off, cards for newly enabled directions — happens
 * only when the course changes.
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

  const content = await loadContent();
  const { features } = content;
  renderTabbar(content);

  if (enteredCourse !== target.id) {
    enteredCourse = target.id;
    // Keep this course on the device. The first time, that's a download in
    // the background; say when it's done, since that's when offline works.
    keepOffline([target.id]).then((answer) => {
      const kept = answer?.courses?.[0];
      if (kept?.added && !kept.missing) toast(t('offline.saved'));
    });
    await course.savePrefs({ lastCourse: target.id, speaker: target.speaker });
    if (features.reading && (await deck.maybeRetireRomaji())) {
      toast(t('toast.romajiRetired'), 5000);
    }
    // Decks activated before card directions existed only have recognition
    // cards; this adds the rest (new, so the daily cap paces them).
    if (await deck.isOnboarded()) await deck.syncDirections();
    // Hiragana over katakana words stays only until katakana is mastered.
    await refreshKanaAids();
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

// A phone's tab bar holds five tabs comfortably. Past that, Scenarios — the
// least central section once a course has Connectors — moves into Learn.
const MAX_TABS = 5;

function tabsFor(content) {
  const { features } = content;
  // The lessons tab is named by the course: Connectors for Japanese, phrase
  // patterns for English.
  const lessons = lessonsCopy(content);
  const tabs = [
    ['/', '📅', t('tab.today')],
    ['/browse', '📚', t('tab.browse')],
    features.lessons ? ['/connectors', lessons.icon, lessons.tab] : null,
    features.characters ? ['/characters', 'あ', t('tab.characters')] : null,
    features.scenarios ? ['/scenarios', '🗣️', t('tab.scenarios')] : null,
    ['/settings', '⚙️', t('tab.settings')],
  ].filter(Boolean);
  return tabs.length > MAX_TABS ? tabs.filter(([path]) => path !== '/scenarios') : tabs;
}

/** Whether Scenarios has its own tab; if not, Learn lists them. */
const scenariosTabbed = (content) => tabsFor(content).some(([path]) => path === '/scenarios');

function renderTabbar(content) {
  const nav = document.querySelector('.tabbar');
  if (!nav) return;
  clear(nav).append(...tabsFor(content).map(([path, icon, label]) =>
    el('a', { href: link(path), dataset: { path } }, el('span', {}, icon), label)));
}

function highlightNav(path) {
  const tabs = [...document.querySelectorAll('.tabbar a')];
  // Sub-routes keep their section lit: /characters/hiragana is still
  // "Characters", /category/airport, /mine and /listening are part of Learn —
  // and so are the scenarios, when they have no tab of their own.
  const learnOwns = tabs.some((a) => a.dataset.path === '/scenarios')
    ? /^\/(category|mine|listening)(\/|$)/
    : /^\/(category|mine|listening|scenarios?)(\/|$)/;
  tabs.forEach((a) => {
    const target = a.dataset.path;
    const owns = target === '/'
      ? path === '/'
      : path === target || path.startsWith(`${target}/`) ||
        (target === '/browse' && learnOwns.test(path)) ||
        (target === '/scenarios' && /^\/scenario\//.test(path));
    a.classList.toggle('active', owns);
  });
}

/** How many items a deck holds, in the right noun. */
function countLine(d) {
  const n = (d.items || d.phrases || []).length;
  if (d.type === 'words') return t('category.countWords', { n });
  if (d.type === 'sentences' || d.type === 'lesson') return t('category.countSentences', { n });
  if (d.type === 'mine') return t('learn.mineCount', { n });
  return t('category.count', { n });
}

/* ---------- today ---------- */

async function today(root) {
  const [summary, stats, streakDays, s, content] = await Promise.all([
    deck.deckSummary(), deck.todayStats(), deck.streak(), deck.getSettings(), loadContent(),
  ]);
  const { categories, decks, features, byCategory } = content;

  const q = await deck.queue();
  const allDecks = [...decks, ...categories, ...content.lessons, byCategory.get(USER_DECK)].filter(Boolean);
  const active = allDecks.filter((d) => s.activeCategories.includes(d.id));
  // With levels, the level row's next step does what the word-deck nudge did.
  const level = features.levels ? await deck.levelState() : null;
  const noWords = !level && features.words && !decks.some((d) => d.type === 'words' && s.activeCategories.includes(d.id));

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

      level ? levelBlock(level, summary, s) : null,

      noWords
        ? el('a', { class: 'row-card nudge', href: link('/browse') },
            el('span', { class: 'row-icon' }, '🧩'),
            el('span', { class: 'row-body' },
              el('span', { class: 'row-title' }, t('today.wordsNudgeTitle')),
              el('span', { class: 'row-sub' }, t('today.wordsNudge'))),
            el('span', { class: 'row-chev' }, '›'))
        : null,

      // The other daily things — the kana drill, a connector — come straight
      // after the reviews, above the list of decks.
      features.characters ? await charactersBlock() : null,
      features.lessons ? await connectorsBlock(content, level) : null,
      features.listening ? await listeningBlock() : null,
      await backupNudge(summary, content),

      el('h2', { class: 'section-title' }, t('today.inDeck')),
      el('div', { class: 'card-list' },
        active.length
          ? await Promise.all(active.map((d) => categoryRow(d, content)))
          : el('p', { class: 'muted' }, t('today.noCategories'))),

      await forecastBlock(),

      el('button', { class: 'btn btn-ghost full', onclick: () => go('/browse') }, t('today.addMore'))
    )
  );
}

/**
 * Your level (README §7.10): how far through it you are, and what to do next.
 * When the new cards run low (fewer than a day's limit wait), the next deck
 * of the level is offered; once the level is learned, the next level is.
 */
function levelBlock(info, summary, s) {
  const { level, progress, next, after } = info;
  const pct = progress.total ? Math.round((progress.learned / progress.total) * 100) : 0;
  const lowOnNew = summary.new < s.newPerDay;

  const moveUp = progress.ready && after
    ? el('div', { class: 'row-card nudge level-up', dataset: { level: after.id } },
        el('span', { class: 'row-icon' }, after.icon || '⬆️'),
        el('span', { class: 'row-body' },
          el('span', { class: 'row-title' }, t('level.readyTitle', { level: after.title })),
          el('span', { class: 'row-sub' }, t('level.readySub', { pct, level: level.title }))),
        el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: async () => {
            await deck.moveToLevel(after.id);
            toast(t('level.movedUp', { level: after.title }));
            router();
          },
        }, t('level.moveUp')))
    : null;

  const nextStep = !moveUp && next && lowOnNew
    ? el('div', { class: 'row-card nudge next-step', dataset: { deck: next.id } },
        el('span', { class: 'row-icon' }, next.icon || '📄'),
        el('a', { class: 'row-body', href: link(`/category/${next.id}`) },
          el('span', { class: 'row-title' }, t('level.next', { title: next.title })),
          el('span', { class: 'row-sub' }, countLine(next))),
        el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: async (e) => {
            e.preventDefault();
            await addDeck(next);
            router();
          },
        }, t('browse.add')))
    : null;

  return el('section', { class: 'level-today' },
    el('h2', { class: 'section-title' }, t('level.title')),
    el('a', { class: 'row-card level-row', href: link('/browse'), dataset: { level: level.id } },
      el('span', { class: 'row-icon' }, level.icon || '🧭'),
      el('span', { class: 'row-body' },
        el('span', { class: 'row-title' }, level.title),
        el('span', { class: 'row-sub' }, [
          t('level.learned', { n: progress.learned, total: progress.total }),
          progress.lessons ? t('level.lessons', { n: progress.practised, total: progress.lessons }) : null,
        ].filter(Boolean).join(' · ')),
        el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` }))),
      el('span', { class: 'row-chev' }, '›')),
    moveUp,
    nextStep);
}

/**
 * The lessons (Connectors, phrase patterns…): how many have been practised,
 * and the way in. With levels, the way in is the level's next lesson, until
 * every one has been practised.
 */
async function connectorsBlock(content, level = null) {
  const stats = await deck.getLessonStats();
  const lessons = lessonsCopy(content);
  const upNext = level?.nextLesson || null;
  const practised = level ? level.progress.practised : content.lessons.filter((l) => stats[l.id]).length;
  const total = level ? level.progress.lessons : content.lessons.length;
  const anyPractised = content.lessons.some((l) => stats[l.id]);
  const href = upNext ? `/connectors/${upNext.id}` : anyPractised ? '/connectors/mixed' : '/connectors';
  return el('section', {},
    el('h2', { class: 'section-title' }, lessons.title),
    el('a', { class: 'row-card', href: link(href) },
      upNext
        ? el('span', { class: 'connector-mark', lang: content.course.target }, upNext.connector)
        : el('span', { class: 'row-icon' }, lessons.icon),
      el('span', { class: 'row-body' },
        el('span', { class: 'row-title' },
          upNext ? t('level.nextLesson', { title: upNext.gloss }) : anyPractised ? t('connectors.mixed') : t('connectors.start')),
        el('span', { class: 'row-sub' }, level
          ? t('level.lessons', { n: practised, total })
          : t('connectors.practisedCount', { n: practised, total })),
        el('span', { class: 'bar' },
          el('span', { class: 'bar-fill', style: `width:${total ? Math.round((practised / total) * 100) : 0}%` }))),
      el('span', { class: 'row-chev' }, '›')));
}

/** The daily listening drill: a couple of minutes, and how much is mastered so far. */
async function listeningBlock() {
  const { progress, doneToday } = await listeningState();
  const { mastered, total } = progress;
  // Nothing to hear at the learner's level yet (§7.10): no block.
  if (!total) return null;
  return el('section', {},
    el('h2', { class: 'section-title' }, t('listening.title')),
    el('a', { class: `row-card listen-today ${doneToday ? 'is-done' : ''}`, href: link('/listening/drill') },
      el('span', { class: 'row-icon' }, '👂'),
      el('span', { class: 'row-body' },
        el('span', { class: 'row-title' }, t(doneToday ? 'listening.doneToday' : 'listening.daily')),
        el('span', { class: 'row-sub' }, t('listening.mastered', { n: mastered, total })),
        el('span', { class: 'bar' },
          el('span', { class: 'bar-fill', style: `width:${total ? Math.round((mastered / total) * 100) : 0}%` }))),
      el('span', { class: 'row-chev' }, '›')));
}

/**
 * Characters get their own row rather than being folded into the counts
 * above — the whole point of the separate deck is that 40 kana drills
 * don't disguise themselves as phrase progress.
 */
async function charactersBlock() {
  // Until both kana are mastered, the reading row is the daily kana drill.
  const kana = await kanaState();
  if (kana.focus) {
    const p = kana.progress[kana.focus];
    return el('section', {},
      el('h2', { class: 'section-title' }, t('reading.title')),
      el('a', { class: `row-card kana-today ${kana.doneToday ? 'is-done' : ''}`, href: link(`/characters/drill/${kana.focus}`) },
        el('span', { class: 'row-icon char-icon' }, kana.focus === 'katakana' ? 'ア' : 'あ'),
        el('span', { class: 'row-body' },
          el('span', { class: 'row-title' }, t(kana.doneToday ? 'reading.kanaDone' : 'reading.kanaDaily')),
          el('span', { class: 'row-sub' },
            t('reading.kanaMastered', { script: SCRIPT_NAMES[kana.focus], n: p.mastered, total: p.total })),
          el('span', { class: 'bar' },
            el('span', { class: 'bar-fill', style: `width:${Math.round((p.mastered / p.total) * 100)}%` }))),
        el('span', { class: 'row-chev' }, '›')));
  }

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
 * decks at once is a bad idea.
 */
async function forecastBlock() {
  const s = await deck.getSettings();
  const active = new Set(s.activeCategories);
  const cards = srs.studyCards(await deck.getDeck())
    .filter((c) => active.has(c.categoryId) && c.state !== 'new' && deck.dirEnabled(c, s));

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

async function categoryRow(d, content) {
  const p = await deck.categoryProgress(d.id);
  const studied = p.total - p.new;
  const pct = p.total ? Math.round((studied / p.total) * 100) : 0;
  return el('a', { class: 'row-card', href: deckHref(content, d.id) },
    el('span', { class: 'row-icon' }, d.icon || '📄'),
    el('span', { class: 'row-body' },
      el('span', { class: 'row-title' }, d.title),
      el('span', { class: 'row-sub' },
        p.total ? t('category.progress', { studied, total: p.total, due: p.due }) : countLine(d)),
      el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` }))),
    el('span', { class: 'row-chev' }, '›'));
}

/* ---------- learn (was: browse) ---------- */

async function learn(root) {
  const content = await loadContent();
  const { manifest } = content;
  const s = await deck.getSettings();

  // With levels, Learn shows one level at a time.
  const mine = content.features.levels ? await deck.getLevel() : null;
  const shown = content.features.levels ? shownLevel(content, mine) : null;
  const inView = (d) => !shown || d.level === shown;
  const decks = content.decks.filter(inView);
  const categories = content.categories.filter(inView);

  const words = decks.filter((d) => d.type === 'words');
  const sentences = decks.filter((d) => d.type === 'sentences');
  // Phrase groups and their titles come from the course manifest, in its own
  // language. A manifest without groups shows one untitled list.
  const groups = manifest.groups?.length ? manifest.groups : [{ id: undefined, title: null }];
  const section = (title, rows, cls = 'section-title') => (rows.length
    ? el('section', {}, title ? el('h2', { class: cls }, title) : null, el('div', { class: 'card-list' }, rows))
    : null);

  root.append(
    el('div', { class: 'screen' },
      header(t('browse.title'), t('browse.lede')),
      shown ? levelHead(content, shown, mine, () => router()) : null,
      section(t('learn.words'), words.map((d) => browseRow(d, s)), 'kind-title'),
      section(t('learn.sentences'), sentences.map((d) => browseRow(d, s)), 'kind-title'),
      (words.length || sentences.length) && categories.length ? el('h2', { class: 'kind-title' }, t('learn.phrases')) : null,
      groups.map((group) => section(group.title, categories.filter((c) => c.group === group.id).map((c) => browseRow(c, s)))),
      section(t('learn.mine'), [mineRow(content)], 'kind-title'),
      content.features.listening ? section(t('listening.title'), [listeningRow(content, mine)].filter(Boolean), 'kind-title') : null,
      // When the tab bar is full, the scenarios live here instead.
      content.features.scenarios && !scenariosTabbed(content)
        ? section(t('learn.scenarios'), [scenariosRow(content)], 'kind-title')
        : null)
  );
}

/** The listening section: what the drill draws on, which with levels is the learner's level and below (§7.10). */
function listeningRow(content, mine = null) {
  const allowed = mine ? levelsUpTo(content, mine) : null;
  const sets = content.listening.filter((x) => !allowed || !x.level || allowed.has(x.level));
  const count = (kind) => sets.filter((x) => x.kind === kind).reduce((n, x) => n + x.items.length, 0);
  const replies = count('replies');
  const words = count('contrasts');
  if (!replies && !words) return null;
  return el('a', { class: 'row-card', href: link('/listening'), dataset: { section: 'listening' } },
    el('span', { class: 'row-icon' }, '👂'),
    el('span', { class: 'row-body' },
      el('span', { class: 'row-title' }, t('listening.title')),
      el('span', { class: 'row-sub' }, t('listening.count', { lines: replies, pairs: words / 2 }))),
    el('span', { class: 'row-chev' }, '›'));
}

function scenariosRow(content) {
  const n = (content.manifest.scenarios || []).length;
  return el('a', { class: 'row-card', href: link('/scenarios') },
    el('span', { class: 'row-icon' }, '🗣️'),
    el('span', { class: 'row-body' },
      el('span', { class: 'row-title' }, t('scenarios.title')),
      el('span', { class: 'row-sub' }, t('learn.scenariosCount', { n }))),
    el('span', { class: 'row-chev' }, '›'));
}

function browseRow(d, s) {
  const active = s.activeCategories.includes(d.id);
  return el('div', { class: `row-card ${active ? 'is-active' : ''}`, dataset: { deck: d.id } },
    el('span', { class: 'row-icon' }, d.icon || '📄'),
    el('a', { class: 'row-body', href: link(`/category/${d.id}`) },
      el('span', { class: 'row-title' }, d.title),
      el('span', { class: 'row-sub' }, d.missing ? t('browse.missing') : countLine(d))),
    // In the deck: tap again to take it out (asked first; its progress is kept).
    active
      ? el('button', {
          class: 'btn btn-small btn-in-deck', type: 'button', 'aria-pressed': 'true', title: t('browse.remove'),
          onclick: async (e) => {
            e.preventDefault();
            if (await removeDeck(d)) router();
          },
        }, `✓ ${t('browse.inDeck')}`)
      : el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: async (e) => {
            e.preventDefault();
            await addDeck(d);
            router();
          },
        }, t('browse.add')));
}

function mineRow(content) {
  const mine = content.byCategory.get(USER_DECK);
  const n = mine?.items.length || 0;
  return el('a', { class: 'row-card', href: link('/mine') },
    el('span', { class: 'row-icon' }, '✍️'),
    el('span', { class: 'row-body' },
      el('span', { class: 'row-title' }, t('learn.mine')),
      el('span', { class: 'row-sub' }, n ? t('learn.mineCount', { n }) : t('learn.mineEmpty'))),
    el('span', { class: 'row-chev' }, '›'));
}

/* ---------- a deck: phrases, words or sentences ---------- */

async function deckScreen(root, id) {
  if (id === USER_DECK) { go('/mine'); return; }
  const d = await getCategory(id);
  if (!d) { go('/browse'); return; }
  if (d.type === 'lesson') { go(`/connectors/${id}`); return; }
  const content = await loadContent();
  const s = await studySettings();
  const active = s.activeCategories.includes(id);
  const progress = await deck.categoryProgress(id);
  const scenarios = d.type === 'phrases' ? await scenariosFor(id) : [];

  root.append(
    el('div', { class: 'screen' },
      el('a', { class: 'back-link', href: link('/browse') }, t('category.back')),
      header(`${d.icon || ''} ${d.title}`, d.description),

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

      toggleStrip(router, content.features),

      el('div', { class: 'action-row' },
        active
          ? el('button', { class: 'btn btn-primary', onclick: () => go(`/study/${id}`) }, t('category.study'))
          : el('button', {
              class: 'btn btn-primary',
              onclick: async () => {
                await addDeck(d, ({ added }) => t('category.addedToDeck', { added }));
                router();
              },
            }, t('category.add')),
        active ? el('span', { class: 'muted small' }, t('category.dueNew', { due: progress.due, fresh: progress.new })) : null,
        active
          ? el('button', {
              class: 'btn btn-small btn-ghost remove-deck', type: 'button',
              onclick: async () => { if (await removeDeck(d)) router(); },
            }, t('browse.remove'))
          : null),

      el('div', { class: 'phrase-list' },
        (d.items || d.phrases).map((item) => itemCard(item, s, content)))
    )
  );
}

function itemCard(item, s, content) {
  return el('article', { class: `phrase-card item-${item.kind}`, dataset: { item: item.id } },
    el('div', { class: 'phrase-main' },
      phraseBlock(item, s),
      audioButton(item, playItem)),
    politeBlock(item, s, playItem),
    item.kind === 'sentence' ? wordLinks(item, content) : null,
    item.kind === 'word' ? sentenceLinks(item, content) : null,
    notesBlock(item),
    tagRow(item));
}

/* ---------- study & review ---------- */

async function studyDeck(root, id) {
  const content = await loadContent();
  const d = await getCategory(id);
  if (!d) { go('/browse'); return; }
  // Activation only adds the cards that are missing, so this is also how a
  // lesson whose missed drills put a sentence or two in the deck gets the rest.
  await deck.activateCategory(id);

  const queue = await deck.queue(id);
  const back = deckHref(content, id);
  if (!queue.length) {
    root.append(emptyStudy(t('study.nothingIn', { title: d.title }), back));
    return;
  }
  await runSession(root, queue, { exitTo: back });
}

async function review(root) {
  const queue = await deck.queue();
  if (!queue.length) { go('/'); return; }
  await runSession(root, queue, { exitTo: link('/') });
}

/**
 * Character review. Same flashcard loop as everything else — character
 * content is phrase-shaped, so runSession needs no branching — but fed from
 * the separate character queue so the two decks never mix.
 */
async function reviewCharacters(root) {
  const queue = await deck.characterQueue();
  if (!queue.length) {
    root.append(emptyStudy('Nothing due in your character sets.', link('/characters')));
    return;
  }
  await runSession(root, queue, { exitTo: link('/characters') });
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
  await runSession(root, queue, { exitTo: link(`/characters/${setId}`) });
}

function emptyStudy(message, backTo) {
  return el('div', { class: 'screen' },
    el('a', { class: 'back-link', href: backTo }, t('study.back')),
    el('div', { class: 'empty-state' },
      el('p', {}, message),
      el('p', { class: 'muted' }, t('study.scheduledOut')),
      el('button', { class: 'btn btn-primary', onclick: () => go('/') }, t('study.backToToday'))));
}

/* ---------- settings ---------- */

async function settings(root, focus = null) {
  const s = await deck.getSettings();
  const { features, course: current, manifest } = await loadContent();
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
        features.ruby
          ? aidModeSetting(s, 'furiganaMode', deck.FURIGANA_MODES,
              features.aids.ruby?.label || 'Furigana', t('settings.furiganaModeHelp'), 'furigana-mode')
          : null,
        features.reading
          ? aidModeSetting(s, 'romajiMode', deck.ROMAJI_MODES,
              features.aids.reading?.label || 'Romaji', t('settings.romajiModeHelp'), 'romaji-mode')
          : null,
        directionsSetting(s),
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
          })),

        connectionSetting()),

      el('h2', { class: 'section-title' }, t('settings.deck')),
      el('p', { class: 'muted' },
        t('settings.phrases', { total: summary.total, review: summary.review, mature: summary.mature })),
      chars
        ? el('p', { class: 'muted' },
            t('settings.characters', { total: chars.total, review: chars.review, mature: chars.mature }))
        : null,

      await dataSection(),
      aboutSection(manifest.dictionary),

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
  // Today's backup reminder links straight here.
  if (focus === 'data') document.getElementById('your-data')?.scrollIntoView?.({ block: 'start' });
}

/* ---------- about: the version, and getting the newest ---------- */

/**
 * Which version this is — so a phone that's behind can tell — and a way to
 * fetch the latest. "Update now" is only here once there's an update to
 * take: found by Check for updates, or put off with "Not now" on the bar.
 * A course with a dictionary also credits it here, as its licence asks
 * (README §6.14).
 */
function aboutSection(dictionary = null) {
  const status = el('p', { class: 'muted small update-status', role: 'status' });
  const reload = el('button', {
    type: 'button', class: 'btn btn-primary', hidden: !updateReady(), dataset: { action: 'reload' },
    onclick: () => location.reload(),
  }, t('update.reload'));
  // An update that finishes downloading while Settings is open is offered straight away.
  if (!updateReady()) {
    const stop = onUpdateReady(() => {
      stop();
      reload.hidden = false;
      status.textContent = t('update.ready');
    });
  }
  const check = el('button', {
    type: 'button', class: 'btn', dataset: { action: 'check-update' },
    onclick: async () => {
      check.disabled = true;
      status.textContent = t('update.checking');
      const result = await checkForUpdate();
      check.disabled = false;
      status.textContent = t(`update.${result}`, { version: VERSION });
      reload.hidden = result !== 'ready';
    },
  }, t('update.check'));
  return el('section', { class: 'about-section', id: 'about' },
    el('h2', { class: 'section-title' }, t('about.title')),
    el('p', { class: 'about-version' }, t('about.version', { version: VERSION })),
    updateReady() ? el('p', { class: 'muted small' }, t('update.ready')) : null,
    el('div', { class: 'action-row' }, check, reload),
    status,
    dictionaryCredit(dictionary, 'about-dictionary'));
}

/**
 * "A new version is ready": across the top of every screen, with Update now
 * and Not now. Not now puts it away for this visit. Settings → About still
 * offers it, and the next time the app starts it's the new version anyway.
 */
function showUpdateBanner() {
  if (document.querySelector('.update-banner')) return;
  const banner = el('div', { class: 'update-banner', role: 'status' },
    el('span', { class: 'update-message' }, t('update.ready')),
    el('span', { class: 'update-actions' },
      el('button', {
        type: 'button', class: 'btn btn-small btn-ghost', dataset: { action: 'update-later' },
        onclick: () => { banner.remove(); toast(t('update.deferred'), 5000); },
      }, t('update.notNow')),
      el('button', {
        type: 'button', class: 'btn btn-small btn-primary', dataset: { action: 'update-now' },
        onclick: () => location.reload(),
      }, t('update.reload'))));
  document.body.prepend(banner);
}

/* ---------- your data: backup and restore ---------- */

// Today starts reminding once the last backup is this old (or there's none).
const BACKUP_EVERY = 14 * 86400000;

/** "today", "3 days ago" — in the interface language. */
function relativeDay(at) {
  const day = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((day(Date.now()) - day(at)) / 86400000);
  try {
    return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(-days, 'day');
  } catch {
    return new Date(at).toLocaleDateString(locale());
  }
}

const dateOf = (at) => new Date(at).toLocaleDateString(locale(), { dateStyle: 'medium' });

/** Can this browser hand a file to the system share sheet (save to Files, Drive, mail…)? */
function canShareFiles() {
  try {
    return typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File(['{}'], 'backup.json', { type: 'application/json' })] });
  } catch {
    return false;
  }
}

function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Every course's progress and your own words, as one file — downloaded, or shared where the device can. */
async function saveBackup(mode) {
  const data = await backup.exportAll();
  const text = JSON.stringify(data);
  const name = backup.fileName(data);
  if (mode === 'share') {
    try {
      await navigator.share({ files: [new File([text], name, { type: 'application/json' })], title: name });
    } catch (err) {
      if (err?.name === 'AbortError') return; // the share sheet was closed: nothing saved
      downloadText(text, name);
    }
  } else {
    downloadText(text, name);
  }
  await course.savePrefs({ lastBackupAt: Date.now() });
  toast(t('data.saved'));
  router();
}

/** Check a chosen file, say what's in it, and — once confirmed — restore it. */
async function restoreFrom(file, status) {
  if (!file) return;
  let data = null;
  try { data = JSON.parse(await backup.readFile(file)); } catch { /* not JSON: reported below */ }
  const check = backup.validateBackup(data);
  if (!check.ok) {
    status.textContent = t(`data.${check.reason}`);
    status.classList.add('error');
    return;
  }
  const ui = getLang();
  const lines = await Promise.all(backup.summarise(data).map(async (x) => {
    const c = await course.getCourse(x.course);
    const name = c
      ? t('coursebar.pair', { speaker: course.languageName(c.speaker, ui), target: course.languageName(c.target, ui) })
      : x.course;
    return t('data.summaryLine', { course: name, cards: x.cards, mine: x.mine });
  }));
  const date = data.exportedAt ? dateOf(data.exportedAt) : '?';
  if (!confirm(t('data.restoreConfirm', { date, summary: lines.join('\n') }))) return;
  await backup.importBackup(data);
  toast(t('data.restored'));
  location.reload();
}

async function dataSection() {
  const prefs = await course.getPrefs();
  const undo = await backup.undoInfo();
  const status = el('p', { class: 'muted small data-status', role: 'status' });
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'file-input', tabindex: '-1' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // so choosing the same file again still counts
    await restoreFrom(file, status);
  });

  return el('section', { class: 'data-section', id: 'your-data' },
    el('h2', { class: 'section-title' }, t('data.title')),
    el('p', { class: 'muted' }, t('data.lede')),
    el('p', { class: 'data-last' },
      t('data.lastBackup', { when: prefs.lastBackupAt ? relativeDay(prefs.lastBackupAt) : t('data.never') })),
    el('div', { class: 'action-row' },
      el('button', { class: 'btn btn-primary', type: 'button', dataset: { action: 'download' }, onclick: () => saveBackup('download') },
        t('data.download')),
      canShareFiles()
        ? el('button', { class: 'btn', type: 'button', dataset: { action: 'share' }, onclick: () => saveBackup('share') }, t('data.share'))
        : null),
    el('div', { class: 'action-row' },
      el('button', { class: 'btn btn-ghost', type: 'button', dataset: { action: 'restore' }, onclick: () => fileInput.click() },
        t('data.restore')),
      fileInput),
    undo
      ? el('div', { class: 'undo-restore' },
          el('p', { class: 'muted small' }, t('data.undoHelp', { date: dateOf(undo.at) })),
          el('button', {
            class: 'btn btn-small', type: 'button', dataset: { action: 'undo' },
            onclick: async () => {
              if (!confirm(t('data.undoConfirm'))) return;
              await backup.undoRestore();
              toast(t('data.undone'));
              location.reload();
            },
          }, t('data.undo')))
      : null,
    status,
    el('p', { class: 'muted small' }, t('settings.storage', { backend: store.backend() })),
    offlineLine());
}

/** Whether this course works offline here — filled in once the service worker answers. */
function offlineLine() {
  const line = el('p', { class: 'muted small offline-status', role: 'status' });
  offlineStatus(course.currentCourseId()).then((s) => {
    if (!s?.total) { line.remove(); return; }
    line.textContent = s.cached >= s.total
      ? t('offline.ready')
      : t('offline.partial', { cached: s.cached, total: s.total });
  });
  return line;
}

/** On Today: progress worth keeping, and no backup for a while. */
async function backupNudge(summary, content) {
  const { lastBackupAt } = await course.getPrefs();
  const started = summary.total - summary.new > 0 || (content.userItems || []).length > 0;
  if (!started || (lastBackupAt && Date.now() - lastBackupAt < BACKUP_EVERY)) return null;
  return el('a', { class: 'row-card nudge backup-nudge', href: link('/settings/data') },
    el('span', { class: 'row-icon' }, '💾'),
    el('span', { class: 'row-body' },
      el('span', { class: 'row-title' }, t('today.backupTitle')),
      el('span', { class: 'row-sub' },
        lastBackupAt ? t('today.backupOld', { when: relativeDay(lastBackupAt) }) : t('today.backupNever'))),
    el('span', { class: 'row-chev' }, '›'));
}

/**
 * A reading aid's mode — furigana or romaji: always / tap to show / hidden.
 * Its name comes from the course's `aids`; the three modes read the same for
 * every aid, so furigana's names serve both.
 */
function aidModeSetting(s, key, modes, label, help, className) {
  return el('div', { class: 'setting setting-stack' },
    el('span', {},
      el('strong', {}, label),
      el('span', { class: 'muted small' }, help)),
    el('div', { class: `segmented ${className}`, role: 'group' },
      modes.map((mode) =>
        el('button', {
          type: 'button',
          class: s[key] === mode ? 'segment is-on' : 'segment',
          'aria-pressed': s[key] === mode ? 'true' : 'false',
          dataset: { mode },
          onclick: async () => { await deck.saveSettings({ [key]: mode }); router(); },
        }, t(`furigana.${mode}`)))));
}

/**
 * Online or offline (README §10.6). It's for this device, like the text
 * size, so it applies to every course.
 */
function connectionSetting() {
  const mode = connectionMode();
  return el('div', { class: 'setting setting-stack' },
    el('span', {},
      el('strong', {}, t('settings.connection')),
      el('span', { class: 'muted small' }, t(`settings.connectionHelp.${mode}`))),
    el('div', { class: 'segmented connection-mode', role: 'group' },
      CONNECTION_MODES.map((m) =>
        el('button', {
          type: 'button',
          class: mode === m ? 'segment is-on' : 'segment',
          'aria-pressed': mode === m ? 'true' : 'false',
          dataset: { connection: m },
          onclick: () => { if (m !== connectionMode()) { setConnection(m); router(); } },
        }, t(`connection.${m}`)))),
    mode === 'online' && offlineForNowSince()
      ? el('p', { class: 'muted small connection-status', role: 'status' }, t('connection.offlineForNow'))
      : null);
}

/**
 * Switch online or offline: at once on this page, then saved, then told to
 * the service worker. Going online also downloads whatever offline mode left
 * waiting — a course opened meanwhile, or the courses after an update.
 */
async function setConnection(next) {
  const told = useConnection(next, { retry: true });
  await course.savePrefs({ connection: next });
  await told;
  if (next === 'online') keepStartedCourses();
}

/** Card types: recognition, production, listening — at least one stays on. */
function directionsSetting(s) {
  const dirs = Object.values(srs.DIR);
  const row = (dir) => {
    const input = el('input', { type: 'checkbox', checked: s.directions[dir], dataset: { dir } });
    input.addEventListener('change', async () => {
      const next = { ...s.directions, [dir]: input.checked };
      if (!dirs.some((d) => next[d])) {
        input.checked = true; // never study nothing
        toast(t('settings.directionsAtLeastOne'));
        return;
      }
      await deck.saveSettings({ directions: next });
      const added = await deck.syncDirections();
      if (added) toast(t('settings.cardsAdded', { n: added }));
      router();
    });
    return el('label', { class: 'setting compact' },
      el('span', {}, el('strong', {}, t(`dir.${dir}`)), el('span', { class: 'muted small' }, t(`settings.dirHelp.${dir}`))),
      input);
  };
  return el('div', { class: 'setting setting-stack' },
    el('span', {}, el('strong', {}, t('settings.directions')), el('span', { class: 'muted small' }, t('settings.directionsHelp'))),
    el('div', { class: 'direction-list' }, dirs.map(row)));
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
 * Register the service worker (README §10 — offline-first).
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
  // A phone resuming the app never checks for a new version by itself.
  onUpdateReady(showUpdateBanner);
  watchForUpdates();
  // Until a course is entered, speak the learner's language as best we know
  // it — this is also what the boot-error screen below will be shown in.
  const prefs = await course.getPrefs();
  // Online or offline: told to the service worker at every launch, so it has
  // it for the next. Its answer says whether this launch's page came from the
  // device because the connection didn't answer in time (README §10.6).
  const connection = useConnection(prefs.connection);
  await setLang(prefs.speaker || course.guessSpeaker());
  await applyTextSettings();

  window.addEventListener('hashchange', router);
  await router();
  connection.then((answer) => { if (answer?.offlineSince) toast(t('connection.wentOffline'), 6000); });
  keepStartedCourses();
}

/**
 * Every course started on this device stays downloaded — asked for at each
 * launch, not only when a course is opened, so one the browser evicted comes
 * back, and the service worker's next version knows what to download before
 * it takes over. An empty list is sent too: it tells the worker the device
 * keeps no course yet.
 */
async function keepStartedCourses() {
  try {
    const { courses } = await course.loadCourses();
    const available = courses.filter((c) => c.status === 'available');
    const started = await Promise.all(available.map((c) => deck.onboardedIn(c.id)));
    await keepOffline(available.filter((c, i) => started[i]).map((c) => c.id));
  } catch (err) {
    console.warn('[wayword] could not check which courses to keep offline', err);
  }
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
