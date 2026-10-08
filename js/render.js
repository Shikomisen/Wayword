/**
 * render.js — small DOM helpers shared by every screen.
 *
 * No framework, no build step (README §3). Just element creation and the
 * furigana/romaji rendering that the toggles in §6 drive.
 */

import { t } from './i18n.js';

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
 */
export function targetNode(item, { furigana = true } = {}) {
  const lang = item.targetLang || 'ja';
  const wrap = el('span', { class: lang === 'ja' ? 'target jp' : 'target', lang });
  const text = item.target ?? item.japanese ?? '';

  if (!furigana || !Array.isArray(item.ruby) || item.ruby.length === 0) {
    wrap.textContent = text;
    return wrap;
  }

  for (const seg of item.ruby) {
    if (seg.r) {
      wrap.append(el('ruby', {}, seg.b, el('rp', {}, '('), el('rt', {}, seg.r), el('rp', {}, ')')));
    } else {
      wrap.append(document.createTextNode(seg.b));
    }
  }
  return wrap;
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
    targetNode(phrase, { furigana: settings.furigana }),
    settings.romaji && phrase.reading ? el('div', { class: 'romaji' }, phrase.reading) : null,
    meaningNode(phrase)
  );
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

export function audioButton(phrase, onPlay) {
  if (!phrase.audio) return null;
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
