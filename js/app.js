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
import { t, setLang, locale } from './i18n.js';
import { el, clear, phraseBlock, notesBlock, tagRow, audioButton, toast, politeBlock } from './render.js';
import { header, stat, playItem, studySettings, toggleStrip } from './shared.js';
import { renderPlacement } from './quiz.js';
import { renderScenarioList, renderScenario } from './scenario.js';
import { renderCharacterList, renderCharacterSet } from './characters.js';
import { renderHome, renderPlannedCourse } from './home.js';
import { runSession } from './study.js';
import { renderMine, renderMineForm } from './mine.js';

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
  [/^\/mine\/([\w-]+)$/, (root, id) => renderMineForm(root, id)],
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

  const { features } = await loadContent();
  renderTabbar(features);

  if (enteredCourse !== target.id) {
    enteredCourse = target.id;
    await course.savePrefs({ lastCourse: target.id, speaker: target.speaker });
    if (features.reading && (await deck.maybeRetireRomaji())) {
      toast(t('toast.romajiRetired'), 5000);
    }
    // Decks activated before card directions existed only have recognition
    // cards; this adds the rest (new, so the daily cap paces them).
    if (await deck.isOnboarded()) await deck.syncDirections();
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
    // "Characters", /category/airport and /mine are part of Learn.
    const owns = target === '/'
      ? path === '/'
      : path === target || path.startsWith(`${target}/`) ||
        (target === '/browse' && /^\/(category|mine)(\/|$)/.test(path));
    a.classList.toggle('active', owns);
  });
}

/** How many items a deck holds, in the right noun. */
function countLine(d) {
  const n = (d.items || d.phrases || []).length;
  if (d.type === 'words') return t('category.countWords', { n });
  if (d.type === 'sentences') return t('category.countSentences', { n });
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
  const allDecks = [...decks, ...categories, byCategory.get(USER_DECK)].filter(Boolean);
  const active = allDecks.filter((d) => s.activeCategories.includes(d.id));
  const noWords = features.words && !decks.some((d) => d.type === 'words' && s.activeCategories.includes(d.id));

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

      noWords
        ? el('a', { class: 'row-card nudge', href: link('/browse') },
            el('span', { class: 'row-icon' }, '🧩'),
            el('span', { class: 'row-body' },
              el('span', { class: 'row-title' }, t('today.wordsNudgeTitle')),
              el('span', { class: 'row-sub' }, t('today.wordsNudge'))),
            el('span', { class: 'row-chev' }, '›'))
        : null,

      el('h2', { class: 'section-title' }, t('today.inDeck')),
      el('div', { class: 'card-list' },
        active.length
          ? await Promise.all(active.map(categoryRow))
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

async function categoryRow(d) {
  const p = await deck.categoryProgress(d.id);
  const studied = p.total - p.new;
  const pct = p.total ? Math.round((studied / p.total) * 100) : 0;
  return el('a', { class: 'row-card', href: link(d.id === USER_DECK ? '/mine' : `/category/${d.id}`) },
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
  const { categories, decks, manifest } = content;
  const s = await deck.getSettings();

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
      section(t('learn.words'), words.map((d) => browseRow(d, s)), 'kind-title'),
      section(t('learn.sentences'), sentences.map((d) => browseRow(d, s)), 'kind-title'),
      words.length || sentences.length ? el('h2', { class: 'kind-title' }, t('learn.phrases')) : null,
      groups.map((group) => section(group.title, categories.filter((c) => c.group === group.id).map((c) => browseRow(c, s)))),
      section(t('learn.mine'), [mineRow(content)], 'kind-title'))
  );
}

function browseRow(d, s) {
  const active = s.activeCategories.includes(d.id);
  return el('div', { class: `row-card ${active ? 'is-active' : ''}`, dataset: { deck: d.id } },
    el('span', { class: 'row-icon' }, d.icon || '📄'),
    el('a', { class: 'row-body', href: link(`/category/${d.id}`) },
      el('span', { class: 'row-title' }, d.title),
      el('span', { class: 'row-sub' }, d.missing ? t('browse.missing') : countLine(d))),
    active
      ? el('span', { class: 'pill pill-on' }, t('browse.inDeck'))
      : el('button', {
          class: 'btn btn-small',
          onclick: async (e) => {
            e.preventDefault();
            const { added, seeded } = await deck.activateCategory(d.id);
            toast(seeded ? t('browse.addedSeeded', { added, seeded }) : t('browse.added', { added }));
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
                const { added } = await deck.activateCategory(id);
                toast(t('category.addedToDeck', { added }));
                router();
              },
            }, t('category.add')),
        active ? el('span', { class: 'muted small' }, t('category.dueNew', { due: progress.due, fresh: progress.new })) : null),

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

/** A sentence's words, each a link to its word deck — learned words, seen in context. */
function wordLinks(sentence, content) {
  const words = (sentence.chunks || []).map((c) => c.w && content.phrases.get(c.w)).filter(Boolean);
  if (!words.length) return null;
  return el('div', { class: 'links' },
    el('span', { class: 'note-label' }, t('sentence.words')),
    el('div', { class: 'ref-list' }, words.map((w) =>
      el('a', { class: 'ref-chip', href: link(`/category/${w.categoryId}`), title: w.meaning, lang: w.targetLang },
        `${w.target} · ${w.meaning}`))));
}

/** The sentences a word appears in. */
function sentenceLinks(word, content) {
  const sentences = (content.usage.get(word.id) || []).map((id) => content.phrases.get(id)).filter(Boolean);
  if (!sentences.length) return null;
  return el('div', { class: 'links' },
    el('span', { class: 'note-label' }, t('word.inSentences')),
    el('div', { class: 'ref-list' }, sentences.map((x) =>
      el('a', { class: 'ref-chip', href: link(`/category/${x.categoryId}`), title: x.meaning, lang: x.targetLang }, x.target))));
}

/* ---------- study & review ---------- */

async function studyDeck(root, id) {
  const d = await getCategory(id);
  if (!d) { go('/browse'); return; }
  if (!(await deck.isActive(id))) await deck.activateCategory(id);

  const queue = await deck.queue(id);
  const back = link(id === USER_DECK ? '/mine' : `/category/${id}`);
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
        features.ruby ? furiganaSetting(s, features) : null,
        features.reading ? toggle('romaji', features.aids.reading?.label, features.aids.reading?.help) : null,
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

/** Furigana: always / tap to show / hidden. Its name and help come from the course's `aids`. */
function furiganaSetting(s, features) {
  return el('div', { class: 'setting setting-stack' },
    el('span', {},
      el('strong', {}, features.aids.ruby?.label || 'Furigana'),
      el('span', { class: 'muted small' }, t('settings.furiganaModeHelp'))),
    el('div', { class: 'segmented furigana-mode', role: 'group' },
      deck.FURIGANA_MODES.map((mode) =>
        el('button', {
          type: 'button',
          class: s.furiganaMode === mode ? 'segment is-on' : 'segment',
          'aria-pressed': s.furiganaMode === mode ? 'true' : 'false',
          dataset: { mode },
          onclick: async () => { await deck.saveSettings({ furiganaMode: mode }); router(); },
        }, t(`furigana.${mode}`)))));
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
