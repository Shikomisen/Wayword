/**
 * paste.js — "Paste a message": your own words, filled in from a dictionary
 * (README §2.4).
 *
 * Paste a message, and every word in it the course's dictionary knows
 * becomes something to tap. Tapping one shows its dictionary form, reading
 * and meanings — 食べなかった is 食べる, "to eat" — and one more tap adds it
 * to your own words with all of that filled in. A sentence can be added too,
 * with its readings suggested; its meaning is yours to write.
 *
 * Everything runs on the device: the dictionary downloads with the course
 * (dictionary.js, README §6.14), and messages are kept in the course's
 * storage (deck.js), so one pasted before the dictionary arrived can be
 * opened again later.
 */

import { loadContent, USER_DECK } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { link, go } from './course.js';
import { t, locale } from './i18n.js';
import { el, clear, toast, furiganaMode } from './render.js';
import { header, studySettings, deckHref } from './shared.js';
import { toSegments, hasKanji, alignReading } from './ruby.js';
import {
  loadDictionary, segment, alternativesAt, readingOf, furiganaOf, sentenceFurigana, wordOf, wordKind, isMinor,
} from './dictionary.js';
import { startNewWith } from './mine.js';

const dateOf = (at) => new Date(at).toLocaleDateString(locale(), { dateStyle: 'medium' });

// "て form" just before an ending that already says て (ている, てください)
// adds nothing: 遅れてる is "-ing (ている)", not "て form, -ing (ている)".
const SAYS_TE = new Set(['ongoing', 'in-advance', 'finish', 'please']);
const reasonsShown = (reasons) => reasons.filter((r, i) => !(r === 'te' && SAYS_TE.has(reasons[i + 1])));

const ENDS = '。！？!?';
const OPENERS = '「『（(【〔〈《';
const CLOSERS = '」』）)】〕〉》';
const WORDY = /[\p{L}\p{N}]/u;

/**
 * A message's sentences. One ends at 。！？ or a line break, but not inside
 * brackets (「行く？」と聞いた is one sentence), and it keeps the punctuation
 * straight after it (？！, 」). A piece with no words in it, like an emoji,
 * stays with the sentence before it.
 */
export function sentencesOf(text) {
  const out = [];
  let current = '';
  let depth = 0;
  let ended = false;
  const end = () => {
    const s = current.trim();
    if (s && !WORDY.test(s) && out.length) out[out.length - 1] += s;
    else if (s) out.push(s);
    current = '';
    depth = 0;
    ended = false;
  };
  for (const ch of String(text)) {
    if (ch === '\n' || ch === '\r') { end(); continue; }
    if (ended && !ENDS.includes(ch) && !CLOSERS.includes(ch)) end();
    current += ch;
    if (OPENERS.includes(ch)) depth += 1;
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ENDS.includes(ch) && depth === 0) ended = true;
  }
  end();
  return out;
}

/** {漢字|かんじ} notation as ruby nodes, or the plain text when there's none. */
function rubyNodes(notation, text) {
  const segments = notation ? toSegments(notation) : null;
  if (!segments) return [text];
  return segments.map((s) => (s.r ? el('ruby', {}, s.b, el('rp', {}, '('), el('rt', {}, s.r), el('rp', {}, ')')) : s.b));
}

/**
 * The acknowledgement a course dictionary's licence asks for (README §6.14):
 * at the foot of every screen that shows its entries, and in Settings →
 * About. `info` is the manifest's "dictionary" entry.
 */
export function dictionaryCredit(info, className = 'footnote') {
  if (!info?.credit) return null;
  const out = (href, text) => el('a', { href, target: '_blank', rel: 'noopener' }, text);
  return el('div', { class: `${className} dict-credit muted small` },
    el('p', { lang: 'en' }, info.credit),
    el('p', { class: 'dict-links' },
      out(info.url, info.name), ' · ', out(info.ownerUrl, info.owner), ' · ',
      out(info.licenceUrl, t('dictionary.licence', { licence: info.licence }))));
}

/* ---------- paste, and the saved messages ---------- */

export async function renderPaste(root) {
  const content = await loadContent();
  const lang = content.course.target;
  const messages = [...(await deck.getMessages())].reverse();
  // Read the dictionary in now, so the words are ready the moment the message is.
  loadDictionary();

  const input = el('textarea', {
    name: 'message', class: 'text-input paste-input', rows: '6', lang, 'aria-label': t('paste.label'),
    placeholder: t('paste.placeholder'), autocomplete: 'off', spellcheck: 'false',
  });
  const error = el('p', { class: 'error', role: 'alert' });
  async function find() {
    const text = input.value.trim();
    if (!text) {
      error.textContent = t('paste.empty');
      input.focus();
      return;
    }
    const message = await deck.saveMessage(text);
    go(`/mine/paste/${message.id}`);
  }

  root.append(
    el('div', { class: 'screen paste' },
      el('a', { class: 'back-link', href: link('/mine') }, t('paste.back')),
      header(t('paste.title'), t('paste.lede')),
      el('form', { class: 'entry-form', onsubmit: (e) => { e.preventDefault(); find(); } },
        input,
        error,
        el('div', { class: 'action-row' },
          el('button', { type: 'submit', class: 'btn btn-primary btn-lg', dataset: { action: 'find-words' } },
            t('paste.find')))),
      el('h2', { class: 'section-title' }, t('paste.saved')),
      messages.length
        ? el('div', { class: 'card-list saved-messages' }, messages.map((m) =>
            el('a', { class: 'row-card', href: link(`/mine/paste/${m.id}`), dataset: { message: m.id } },
              el('span', { class: 'row-icon', 'aria-hidden': 'true' }, '💬'),
              el('span', { class: 'row-body' },
                el('span', { class: 'row-title message-first', lang }, sentencesOf(m.text)[0] || m.text),
                el('span', { class: 'row-sub' },
                  `${dateOf(m.createdAt)} · ${t('paste.addedCount', { n: m.added.length })}`)),
              el('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›'))))
        : el('p', { class: 'muted empty-messages' }, t('paste.none')),
      dictionaryCredit(content.manifest.dictionary)));
}

/* ---------- one message: its words, and the word sheet ---------- */

export async function renderMessage(root, id) {
  const message = await deck.getMessage(id);
  if (!message) { go('/mine/paste'); return; }
  const content = await loadContent();
  const lang = content.course.target;
  const [s, dictionary, voice, mine] = await Promise.all([
    studySettings(), loadDictionary(), audio.deviceVoice(lang), deck.getUserItems(),
  ]);

  // What's yours already, and what the course teaches (its words, phrases and
  // sentences, not its kana and kanji), by how it's written.
  const yours = new Set(mine.map((u) => u.target));
  const inCourse = new Map();
  for (const item of content.phrases.values()) {
    if (item.kind === 'character' || item.categoryId === USER_DECK || !item.target) continue;
    if (!inCourse.has(item.target)) inCourse.set(item.target, item);
  }
  const withReadings = furiganaMode(s, null) === 'always';
  const here = `/mine/paste/${message.id}`;
  const summary = () => `${dateOf(message.createdAt)} · ${t('paste.addedCount', { n: message.added.length })}`;
  const head = header(t('paste.message'), summary());

  let sheet = null;
  let picked = null;

  async function remove() {
    if (!confirm(t('paste.deleteConfirm'))) return;
    await deck.deleteMessage(message.id);
    toast(t('paste.deleted'));
    go('/mine/paste');
  }

  function closeSheet() {
    sheet?.remove();
    sheet = null;
    picked?.classList.remove('is-picked');
    picked?.setAttribute('aria-expanded', 'false');
    picked = null;
  }

  function sentenceBlock(sentence) {
    const block = el('div', { class: 'message-sentence' });
    const line = el('p', { class: 'sentence-line', lang });
    for (const piece of dictionary ? segment(dictionary, sentence) : [{ text: sentence }]) {
      if (!piece.match) { line.append(piece.text); continue; }
      const top = piece.match.matches[0];
      const word = wordOf(top);
      // Text that acts as a button, rather than a <button>: a button is a box
      // the line may break beside, which would put 。 or ？ at the start of a
      // line. As text, the sentence wraps by Japanese rules, as one.
      const open = () => pick(piece, sentence, block, chip);
      const chip = el('span', {
        role: 'button', tabindex: '0',
        class: `word-chip${isMinor(top.entry) ? ' is-minor' : ''}${yours.has(word.target) ? ' is-added' : ''}`,
        'aria-label': word.target === piece.text ? piece.text : `${piece.text}, ${word.target}`,
        'aria-expanded': 'false',
        dataset: { word: word.target },
        onclick: open,
        onkeydown: (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          open();
        },
      }, ...(withReadings ? rubyNodes(furiganaOf(piece.text, readingOf(piece.text, top)), piece.text) : [piece.text]));
      line.append(chip);
    }
    const added = yours.has(sentence);
    block.append(line, el('button', {
      type: 'button', class: 'btn btn-small add-sentence', disabled: added, dataset: { action: 'add-sentence' },
      onclick: () => startNewWith({
        target: (dictionary && sentenceFurigana(dictionary, sentence)) || sentence,
        kind: 'sentence', note: t('paste.noteMessage', { date: dateOf(message.createdAt) }),
        messageId: message.id, returnTo: here,
      }),
    }, added ? t('paste.sentenceAdded') : t('paste.addSentence')));
    return block;
  }

  /** Open the word sheet for a tapped word, under its sentence; tapped again, close it. */
  function pick(piece, sentence, block, chip) {
    if (picked === chip) { closeSheet(); return; }
    closeSheet();
    picked = chip;
    chip.classList.add('is-picked');
    chip.setAttribute('aria-expanded', 'true');
    const { match } = piece;
    // The entries this spot could be, likeliest first; the set phrase it could
    // also be (今日は, "hello"); then shorter words that start here (今日 in 今日は).
    const options = [
      ...match.matches.slice(0, 4).map((m) => ({ surface: match.surface, m })),
      ...(match.longer?.matches.slice(0, 2) || []).map((m) => ({ surface: match.longer.surface, m })),
      ...alternativesAt(dictionary, sentence, match.start, match)
        .flatMap((alt) => alt.matches.slice(0, 2).map((m) => ({ surface: alt.surface, m }))),
    ].filter((o, i, all) => all.findIndex((x) => x.m.entry.id === o.m.entry.id) === i);
    sheet = wordSheet(options, sentence);
    block.after(sheet);
    sheet.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  function wordSheet(options, sentence) {
    let chosen = 0;
    let sense = 0;
    const box = el('section', { class: 'word-sheet', 'aria-label': t('paste.sheet') });

    const draw = () => {
      const { surface, m } = options[chosen];
      const { entry } = m;
      const { target, reading } = wordOf(m);
      const kanji = hasKanji(target);
      const notation = kanji ? alignReading(target, reading) || `{${target}|${reading}}` : null;
      const kind = wordKind(entry);
      const already = yours.has(target);
      const course = inCourse.get(target);
      const note = t('paste.noteFrom', { sentence });

      async function add(button) {
        button.disabled = true;
        const item = {
          id: `u-${Date.now().toString(36)}`,
          kind: 'word',
          target,
          reading: kanji ? reading : null,
          furigana: notation,
          meaning: entry.senses[sense],
          note,
          audioMode: voice ? 'tts' : 'none',
        };
        await deck.saveUserItem(item);
        await deck.markAdded(message.id, item.id);
        message.added.push(item.id);
        yours.add(target);
        toast(t('paste.addedToast', { word: target }));
        for (const c of view.querySelectorAll('.word-chip')) if (c.dataset.word === target) c.classList.add('is-added');
        head.querySelector('.lede').textContent = summary();
        draw();
      }

      clear(box).append(...[
        el('div', { class: 'sheet-head' },
          el('span', { class: 'sheet-word', lang }, ...rubyNodes(notation, target)),
          kind ? el('span', { class: 'pos' }, t(`pos.${kind}`)) : null,
          voice
            ? el('button', {
                type: 'button', class: 'audio-btn', 'aria-label': t('audio.play', { text: target }),
                onclick: () => audio.speak(reading || target, lang),
              }, '🔊')
            : null,
          el('button', {
            type: 'button', class: 'btn btn-small btn-ghost sheet-close', 'aria-label': t('paste.close'),
            onclick: closeSheet,
          }, '✕')),
        surface !== target || m.reasons.length
          ? el('p', { class: 'muted small sheet-form' },
              el('span', { lang }, `${surface} → ${target}`),
              m.reasons.length ? ` · ${reasonsShown(m.reasons).map((r) => t(`inflect.${r}`)).join(', ')}` : null)
          : null,
        entry.senses.length > 1 ? el('p', { class: 'muted small sheet-choose' }, t('paste.chooseMeaning')) : null,
        el('ol', { class: 'senses' }, entry.senses.map((text, i) => el('li', {},
          entry.senses.length > 1
            ? el('button', {
                type: 'button', class: i === sense ? 'sense is-on' : 'sense', 'aria-pressed': String(i === sense),
                onclick: () => { sense = i; draw(); },
              }, text)
            : el('span', { class: 'sense is-on' }, text)))),
        already
          ? el('p', { class: 'sheet-status is-yours' }, t('paste.inYours'))
          : course
            ? el('p', { class: 'sheet-status' }, t('paste.inCourse'), ' ',
                el('a', { href: deckHref(content, course.categoryId) }, course.categoryTitle))
            : null,
        el('div', { class: 'action-row sheet-actions' },
          el('button', {
            type: 'button', class: 'btn btn-primary', disabled: already, dataset: { action: 'add-word' },
            onclick: (e) => add(e.currentTarget),
          }, already ? t('paste.added') : t('paste.add')),
          el('button', {
            type: 'button', class: 'btn', dataset: { action: 'edit-word' },
            onclick: () => startNewWith({
              target, reading: kanji ? reading : '', meaning: entry.senses[sense], kind: 'word', note,
              messageId: message.id, returnTo: here,
            }),
          }, t('paste.edit'))),
        options.length > 1
          ? el('div', { class: 'alternatives' },
              el('span', { class: 'note-label' }, t('paste.alternatives')),
              el('div', { class: 'ref-list' }, options.map((o, i) => (i === chosen ? null : el('button', {
                type: 'button', class: 'chip alt-chip', dataset: { option: String(i) },
                onclick: () => { chosen = i; sense = 0; draw(); },
              }, el('span', { lang }, wordOf(o.m).target), ` · ${o.m.entry.senses[0].split('; ')[0]}`)))))
          : null,
      ].filter(Boolean));
    };
    draw();
    return box;
  }

  const view = el('div', { class: 'screen paste-message' },
    el('a', { class: 'back-link', href: link('/mine/paste') }, t('paste.backToMessages')),
    head,
    dictionary
      ? el('p', { class: 'muted small paste-hint' }, t('paste.tapHint'))
      : el('p', { class: 'paste-missing' }, t('paste.noDictionary')),
    el('div', { class: 'message-text' }, sentencesOf(message.text).map(sentenceBlock)),
    el('div', { class: 'action-row message-actions' },
      el('button', {
        type: 'button', class: 'btn btn-small btn-ghost', dataset: { action: 'delete-message' }, onclick: remove,
      }, t('paste.delete'))),
    dictionary ? dictionaryCredit(content.manifest.dictionary) : null);
  root.append(view);
}
