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
export async function playItem(item) {
  const result = await audio.playItem(item);
  if (result === 'missing') toast(t('audio.missing'));
  return result;
}

/** Settings plus the "I can read this" set, which furiganaMode() needs. */
export async function studySettings() {
  const s = await deck.getSettings();
  return { ...s, readable: await deck.getReadable() };
}

/**
 * Inline reading-aid toggles (README §6, Day 2).
 *
 * Deliberately duplicated next to the content rather than buried in
 * Settings: deciding whether you need the reading is a per-card judgement
 * made mid-study, and a trip to Settings to check yourself is a trip you
 * won't make. Only the aids a course's content actually has are offered.
 *
 * Furigana cycles through its three modes — always, tap to show, hidden;
 * romaji is on/off.
 */
export function toggleStrip(onChange, features) {
  if (!features.ruby && !features.reading) return null;
  const strip = el('div', { class: 'toggle-strip' });

  deck.getSettings().then((s) => {
    if (features.ruby) {
      const mode = s.furiganaMode;
      const next = deck.FURIGANA_MODES[(deck.FURIGANA_MODES.indexOf(mode) + 1) % deck.FURIGANA_MODES.length];
      strip.append(el('button', {
        class: mode === 'hidden' ? 'chip' : 'chip chip-on',
        type: 'button',
        dataset: { aid: 'furigana', mode },
        'aria-label': `${features.aids.ruby?.label || 'Furigana'}: ${t(`furigana.${mode}`)}`,
        onclick: async () => { await deck.saveSettings({ furiganaMode: next }); onChange(); },
      }, `${features.aids.ruby?.chip || 'ruby'} · ${t(`furigana.${mode}`)}`));
    }
    if (features.reading) {
      strip.append(el('button', {
        class: s.romaji ? 'chip chip-on' : 'chip',
        type: 'button',
        dataset: { aid: 'romaji' },
        'aria-pressed': s.romaji ? 'true' : 'false',
        onclick: async () => { await deck.saveSettings({ romaji: !s.romaji }); onChange(); },
      }, features.aids.reading?.chip || 'reading'));
    }
  });
  return strip;
}
