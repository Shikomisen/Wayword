/**
 * shared.js — small pieces several screens use: headers, playback with a
 * toast when there's nothing to play, the inline reading-aid toggles, and
 * the settings bundle a study screen renders with.
 */

import * as deck from './deck.js';
import * as audio from './audio.js';
import { USER_DECK } from './content.js';
import { link } from './course.js';
import { t } from './i18n.js';
import { el, toast } from './render.js';
import { levelById } from './levels.js';

/**
 * Add a deck to study, and say what happened: how many cards it added — or,
 * for a deck taken out earlier, that it's back with its progress.
 */
export async function addDeck(d, firstTime = ({ added, seeded }) =>
  (seeded ? t('browse.addedSeeded', { added, seeded }) : t('browse.added', { added }))) {
  const result = await deck.activateCategory(d.id);
  toast(result.readded ? t('browse.readded', { title: d.title }) : firstTime(result));
  return result;
}

/**
 * Take a deck out of study, once confirmed. Its cards keep their progress
 * (deck.deactivateCategory), so the question says so. Resolves to whether it
 * was taken out.
 */
export async function removeDeck(d) {
  if (!confirm(t('browse.removeConfirm', { title: d.title }))) return false;
  await deck.deactivateCategory(d.id);
  toast(t('browse.removed', { title: d.title }));
  return true;
}

/**
 * Where a deck lives in the app: a connector lesson opens in Connectors,
 * your own words in their own screen, a character set in Characters, and
 * everything else on the deck screen.
 */
export function deckHref(content, deckId) {
  if (deckId === USER_DECK) return link('/mine');
  if (content.byCategory.get(deckId)?.type === 'lesson') return link(`/connectors/${deckId}`);
  if (content.bySet?.has(deckId)) return link(`/characters/${deckId}`);
  return link(`/category/${deckId}`);
}

/**
 * What the course calls its lessons section. Japanese teaches connectors
 * (つなぐ言葉), English teaches phrase patterns ("I'd like ○○") — same lesson
 * format and drills, different name. A manifest sets `copy.lessonsTitle`,
 * `lessonsTab` (short, for the tab bar), `lessonsLede` and `lessonsIcon`;
 * anything it leaves out falls back to Connectors.
 */
export function lessonsCopy(content) {
  const copy = content.manifest?.copy || {};
  const title = copy.lessonsTitle || t('connectors.title');
  return {
    title,
    tab: copy.lessonsTab || copy.lessonsTitle || t('tab.connectors'),
    lede: copy.lessonsLede || t('connectors.lede'),
    icon: copy.lessonsIcon || '🔗',
  };
}

/**
 * The level buttons (README §7.10): one per level, the chosen one marked.
 * `mine` also marks the learner's own level, when another is being shown.
 */
export function levelChooser(content, selected, onPick, { mine = null } = {}) {
  return el('div', { class: 'segmented level-choice', role: 'group', 'aria-label': t('learn.levels') },
    (content.levels || []).map((l) => el('button', {
      type: 'button',
      class: `segment${l.id === selected ? ' is-on' : ''}${l.id === mine ? ' is-mine' : ''}`,
      'aria-pressed': String(l.id === selected),
      dataset: { level: l.id },
      onclick: () => { if (l.id !== selected) onPick(l.id); },
    },
    el('span', { class: 'level-icon', 'aria-hidden': 'true' }, l.icon || ''),
    el('span', { class: 'level-name' }, l.title))));
}

// The level that Learn and the lessons list are showing, per course: the
// learner's own until another is picked there (README §7.10).
const levelView = { course: null, level: null };

/** The level a screen shows: the one picked this visit, else the learner's own, else the first. */
export function shownLevel(content, mine) {
  if (levelView.course === content.course.id && levelById(content, levelView.level)) return levelView.level;
  return mine || content.levels[0]?.id || null;
}

/**
 * The level buttons above Learn and the lessons list, the shown level's
 * description and, when it isn't the learner's own, a way to make it theirs.
 * `redraw` re-renders the screen after a change.
 */
export function levelHead(content, shown, mine, redraw) {
  const level = levelById(content, shown);
  if (!level) return null;
  return el('section', { class: 'level-head' },
    levelChooser(content, shown, (id) => {
      levelView.course = content.course.id;
      levelView.level = id;
      redraw();
    }, { mine }),
    el('p', { class: 'muted small level-description' }, level.description),
    mine && shown !== mine
      ? el('div', { class: 'action-row level-switch' },
          el('span', { class: 'muted small' }, t('learn.notYourLevel', { level: levelById(content, mine)?.title || mine })),
          el('button', {
            class: 'btn btn-small', type: 'button',
            onclick: async () => {
              await deck.setLevel(shown);
              toast(t('learn.levelSet', { level: level.title }));
              redraw();
            },
          }, t('learn.makeMyLevel')))
      : null);
}

/** A sentence's words, each a link to its word deck — learned words, seen in context. */
export function wordLinks(sentence, content) {
  const words = (sentence.chunks || []).map((c) => c.w && content.phrases.get(c.w)).filter(Boolean);
  if (!words.length) return null;
  return el('div', { class: 'links' },
    el('span', { class: 'note-label' }, t('sentence.words')),
    el('div', { class: 'ref-list' }, words.map((w) =>
      el('a', { class: 'ref-chip', href: deckHref(content, w.categoryId), title: w.meaning, lang: w.targetLang },
        `${w.target} · ${w.meaning}`))));
}

/** The sentences a word appears in — sentence decks and connector lessons alike. */
export function sentenceLinks(word, content) {
  const sentences = (content.usage.get(word.id) || []).map((id) => content.phrases.get(id)).filter(Boolean);
  if (!sentences.length) return null;
  return el('div', { class: 'links' },
    el('span', { class: 'note-label' }, t('word.inSentences')),
    el('div', { class: 'ref-list' }, sentences.map((x) =>
      el('a', { class: 'ref-chip', href: deckHref(content, x.categoryId), title: x.meaning, lang: x.targetLang }, x.target))));
}

export function header(title, subtitle) {
  return el('header', { class: 'screen-header' },
    el('h1', {}, title),
    subtitle ? el('p', { class: 'lede' }, subtitle) : null);
}

export function stat(value, label) {
  return el('div', { class: 'stat' }, el('div', { class: 'stat-value' }, String(value)), el('div', { class: 'stat-label' }, label));
}

/** Play an item's audio — clip, recording or device voice — and say so if there's none. */
export async function playItem(item, options) {
  const result = await audio.playItem(item, options);
  if (result === 'missing') toast(t('audio.missing'));
  return result;
}

/** Settings plus the "I can read this" set, which furiganaMode() needs. */
export async function studySettings() {
  const s = await deck.getSettings();
  return { ...s, readable: await deck.getReadable() };
}

/**
 * Inline reading-aid toggles (README §7.8).
 *
 * Deliberately duplicated next to the content rather than buried in
 * Settings: deciding whether you need the reading is a per-card judgement
 * made mid-study, and a trip to Settings to check yourself is a trip you
 * won't make. Only the aids a course's content actually has are offered.
 *
 * Furigana and romaji each cycle through the same three modes — always,
 * tap to show, hidden.
 */
export function toggleStrip(onChange, features) {
  if (!features.ruby && !features.reading) return null;
  const strip = el('div', { class: 'toggle-strip' });

  // One chip per aid, showing its mode; a tap moves it to the next mode.
  const chip = (aid, key, modes, mode, name, label) => {
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];
    // The three modes read the same for every aid: furigana's names serve both.
    const modeName = t(`furigana.${mode}`);
    return el('button', {
      class: mode === 'hidden' ? 'chip' : 'chip chip-on',
      type: 'button',
      dataset: { aid, mode },
      'aria-label': `${name}: ${modeName}`,
      onclick: async () => { await deck.saveSettings({ [key]: next }); onChange(); },
    }, `${label} · ${modeName}`);
  };

  deck.getSettings().then((s) => {
    if (features.ruby) {
      strip.append(chip('furigana', 'furiganaMode', deck.FURIGANA_MODES, s.furiganaMode,
        features.aids.ruby?.label || 'Furigana', features.aids.ruby?.chip || 'ruby'));
    }
    if (features.reading) {
      strip.append(chip('romaji', 'romajiMode', deck.ROMAJI_MODES, s.romajiMode,
        features.aids.reading?.label || 'Romaji', features.aids.reading?.chip || 'reading'));
    }
  });
  return strip;
}
