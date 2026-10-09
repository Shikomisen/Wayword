/**
 * render.js — small DOM helpers shared by every screen.
 *
 * No framework, no build step (README §3). Just element creation and the
 * furigana/romaji rendering that the toggles in §6 drive.
 */

import { t } from './i18n.js';
import { toSegments } from './ruby.js';
import { isKatakanaAid } from './kana.js';

// Hiragana written over katakana words is an aid for someone still learning
// katakana. Once katakana is mastered (reading.js decides), it goes.
let katakanaAids = true;
export function setKatakanaAids(on) { katakanaAids = Boolean(on); }

/** The ruby segments that actually get a reading shown. */
const shown = (seg) => Boolean(seg.r) && (katakanaAids || !isKatakanaAid(seg));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Renders the text being learned, with optional ruby furigana.
 *
 * Works on the generic fields content.js adds (`target`, `ruby`,
 * `targetLang`), so it serves Japanese and English targets alike. Japanese
 * keeps its `.jp` class for the CJK font stack; `lang` is set either way so
 * browsers and screen readers pronounce and shape it correctly.
 *
 * Furigana is stored as segments: [{ b: "電車", r: "でんしゃ" }, { b: "は" }]
 * so the reading attaches to the right kanji run rather than the whole
 * string. Falls back to the plain target text if segments are absent.
 *
 * `furigana` is a mode — 'always', 'tap' (hidden until the text is tapped)
 * or 'hidden' — or, from older callers, true/false for always/hidden.
 */
export function targetNode(item, { furigana = 'always' } = {}) {
  const mode = furigana === true ? 'always' : furigana === false ? 'hidden' : furigana;
  const lang = item.targetLang || 'ja';
  const wrap = el('span', { class: lang === 'ja' ? 'target jp' : 'target', lang });
  const text = item.target ?? item.japanese ?? '';
  const hasRuby = Array.isArray(item.ruby) && item.ruby.some(shown);

  if (mode === 'hidden' || !hasRuby) {
    wrap.textContent = text;
    return wrap;
  }

  for (const seg of item.ruby) {
    if (shown(seg)) {
      wrap.append(el('ruby', {}, seg.b, el('rp', {}, '('), el('rt', {}, seg.r), el('rp', {}, ')')));
    } else {
      wrap.append(document.createTextNode(seg.b));
    }
  }

  if (mode === 'tap') tapToReveal(wrap);
  return wrap;
}

/**
 * Tap-to-show furigana: the readings inside `node` are there but invisible
 * until it is tapped. The tap is swallowed so it doesn't also flip a flashcard.
 */
export function tapToReveal(node) {
  node.classList.add('furi-tap');
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', t('furigana.reveal'));
  const reveal = (e) => {
    e.stopPropagation();
    node.classList.toggle('revealed');
  };
  node.addEventListener('click', reveal);
  node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(e); } });
  return node;
}

/**
 * Prose with Japanese in it — a lesson's explanation — where kanji carry
 * their reading as {漢字|かんじ}. The readings follow the furigana mode;
 * tap-to-show reveals a whole paragraph at once.
 */
export function proseNode(text, { furigana = 'always', tag = 'p', className = 'prose' } = {}) {
  const node = el(tag, { class: className });
  for (const seg of toSegments(text) || []) {
    if (seg.r && furigana !== 'hidden') {
      node.append(el('ruby', { lang: 'ja' }, seg.b, el('rp', {}, '('), el('rt', {}, seg.r), el('rp', {}, ')')));
    } else {
      node.append(document.createTextNode(seg.b));
    }
  }
  if (furigana === 'tap' && node.querySelector('ruby')) tapToReveal(node);
  return node;
}

/**
 * The furigana mode for one item: the course setting, except that an item
 * the learner has marked "I can read this" drops to tap-to-reveal when the
 * setting is "always" — so furigana fades card by card as reading improves.
 * `settings.readable` is the Set from deck.getReadable().
 */
export function furiganaMode(settings, item) {
  const mode = settings.furiganaMode || (settings.furigana === false ? 'hidden' : 'always');
  const id = item?.itemId ?? item?.id;
  if (mode === 'always' && id && settings.readable?.has(id)) return 'tap';
  return mode;
}

/** "I can read this" — a per-item switch that fades its furigana (see furiganaMode). */
export function readableToggle(item, settings, onChange) {
  if (!Array.isArray(item.ruby) || !item.ruby.some(shown)) return null;
  const on = Boolean(settings.readable?.has(item.id));
  return el('button', {
    type: 'button',
    class: on ? 'chip chip-on readable-toggle' : 'chip readable-toggle',
    'aria-pressed': on ? 'true' : 'false',
    onclick: (e) => { e.stopPropagation(); onChange(!on); },
  }, on ? `✓ ${t('study.canRead')}` : t('study.canRead'));
}

/** A word's part of speech, and for verbs the ます and て forms. */
export function wordDetails(item, settings) {
  if (item.kind !== 'word' || (!item.pos && !item.forms?.length)) return null;
  return el('div', { class: 'word-details' },
    item.pos ? el('span', { class: 'pos' }, t(`pos.${item.pos}`)) : null,
    (item.forms || []).map((f) =>
      el('span', { class: 'word-form' },
        el('span', { class: 'form-key' }, t(`forms.${f.key}`)),
        targetNode(f, { furigana: furiganaMode(settings, item) }))));
}

/** The gloss, in the learner's own language. */
export function meaningNode(item, { big = false, tag = 'div' } = {}) {
  return el(tag, { class: big ? 'meaning big' : 'meaning', lang: item.meaningLang || null }, item.meaning);
}

/** The standard phrase block: target, reading, meaning — toggles applied. */
export function phraseBlock(phrase, settings, { size = 'md' } = {}) {
  return el(
    'div',
    { class: `phrase-block phrase-${size}` },
    registerBadge(phrase),
    targetNode(phrase, { furigana: furiganaMode(settings, phrase) }),
    settings.romaji && phrase.reading ? el('div', { class: 'romaji' }, phrase.reading) : null,
    meaningNode(phrase),
    wordDetails(phrase, settings)
  );
}

/** "Polite" / "Casual" pill — every phrase in a course that declares registers gets one. */
export function registerBadge(item) {
  if (!item.register) return null;
  return el('span', { class: `register register-${item.register}` }, t(`register.${item.register}`));
}

/**
 * A casual phrase shown with its polite counterpart underneath, so the
 * choice of which to say is made side by side rather than remembered.
 */
export function politeBlock(item, settings, onPlay) {
  const p = item.polite;
  if (!p) return null;
  return el('div', { class: 'polite-version' },
    el('span', { class: 'note-label' }, t('register.politeVersion')),
    el('div', { class: 'polite-row' },
      el('div', { class: 'polite-text' },
        targetNode(p, { furigana: furiganaMode(settings, item) }),
        settings.romaji && p.reading ? el('div', { class: 'romaji' }, p.reading) : null),
      audioButton(p, onPlay)));
}

export function tagRow(phrase) {
  const tags = phrase.tags || [];
  if (!tags.length) return null;
  return el('div', { class: 'tags' }, tags.map((tag) => el('span', { class: 'tag' }, tag)));
}

/**
 * Usage notes (README §6). Which notes exist and what they are called is
 * the course manifest's call — register and anime-divergence notes for
 * English speakers learning Japanese, usage and katakana-English pitfalls
 * for Japanese speakers learning English. content.js resolves them into
 * `phrase.notes`.
 */
export function notesBlock(phrase) {
  const notes = phrase.notes || [];
  if (!notes.length) return null;
  return el('div', { class: 'notes', lang: phrase.meaningLang || null },
    notes.map((n) =>
      el('div', { class: n.style ? `note note-${n.style}` : 'note' },
        el('span', { class: 'note-label' }, n.label),
        n.text)));
}

/**
 * Play button — for a bundled clip, your own recording, or the device voice.
 * One of your own cards with no audio at all gets a clearly marked
 * "no audio" badge instead of a button that would do nothing.
 */
export function audioButton(phrase, onPlay) {
  const playable = phrase.audio || phrase.audioMode === 'recording' || phrase.audioMode === 'tts';
  if (!playable) {
    return phrase.source === 'user'
      ? el('span', { class: 'audio-none', title: t('audio.noneTitle') }, t('audio.none'))
      : null;
  }
  const btn = el(
    'button',
    { class: 'audio-btn', type: 'button', 'aria-label': t('audio.play', { text: phrase.reading || phrase.target }) },
    '🔊'
  );
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.classList.add('playing');
    const result = await onPlay(phrase);
    btn.classList.remove('playing');
    if (result === 'missing') {
      btn.classList.add('audio-missing');
      btn.title = t('audio.missingTitle');
    }
  });
  return btn;
}

export function toast(message, ms = 2400) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host' });
    document.body.append(host);
  }
  const node = el('div', { class: 'toast' }, message);
  host.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 300);
  }, ms);
}
