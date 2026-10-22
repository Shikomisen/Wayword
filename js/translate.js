/**
 * translate.js — the Translate tab (README §2.14).
 *
 *   #/<course>/translate
 *
 * Type what you want to say, or something you want to understand. The course
 * is searched first (search.js): what it teaches is checked, has its audio,
 * and is one tap from being studied. Then the offline translator
 * (translator.js) translates it on this device, once it's been downloaded.
 * Either way, ＋ Add to my words turns the result into a card.
 */

import { loadContent } from './content.js';
import * as audio from './audio.js';
import { link, languageName } from './course.js';
import { t, locale } from './i18n.js';
import { el, clear, phraseBlock, audioButton, targetNode, furiganaMode, toast } from './render.js';
import { header, playItem, studySettings } from './shared.js';
import { toSegments } from './ruby.js';
import { loadDictionary, sentenceFurigana } from './dictionary.js';
import { startNewWith } from './mine.js';
import { searchCourse, score } from './search.js';
import * as translator from './translator.js';

// What was typed, and the last translation, while the app is open — so adding
// a card and coming back finds them still here.
let state = { courseId: null, direction: 'say', text: '', machine: null };

// The download, if one is running: it carries on when the screen is left.
let downloading = null; // { courseId, done, total, error }

export async function renderTranslate(root) {
  const content = await loadContent();
  const s = await studySettings();
  const { course } = content;
  const dirs = translator.directionsFor(content);
  if (state.courseId !== course.id) state = { courseId: course.id, direction: dirs.say ? 'say' : 'read', text: '', machine: null };
  const registry = content.translator;
  const files = translator.filesFor(registry, [dirs.say, dirs.read]);
  const size = translator.megabytes(translator.bytesOf(files), locale());
  const canRun = translator.supported();
  let ready = canRun && (await translator.status(files)).ready;

  const items = [...content.phrases.values()];
  const name = (lang) => languageName(lang, course.speaker);
  const from = () => (state.direction === 'say' ? course.speaker : course.target);
  const to = () => (state.direction === 'say' ? course.target : course.speaker);
  const pair = () => (state.direction === 'say' ? dirs.say : dirs.read);

  const input = el('textarea', {
    class: 'text-input translate-input', rows: '3', lang: from(), autocomplete: 'off', spellcheck: 'false',
    'aria-label': t('translate.inputLabel'),
    placeholder: t(state.direction === 'say' ? 'translate.placeholderSay' : 'translate.placeholderRead', { lang: name(course.target) }),
  });
  input.value = state.text;
  // What the course teaches word for word comes first; what's merely similar, after the translation.
  const exactBox = el('section', { class: 'translate-course translate-exact' });
  const similarBox = el('section', { class: 'translate-course translate-similar' });
  const machineBox = el('section', { class: 'translate-machine' });
  const panel = el('section', { class: 'translator-panel' });

  /* ---------- from the course ---------- */

  const deckLink = (item) => {
    const deck = content.byCategory.get(item.categoryId);
    const path = deck?.type === 'lesson' ? `/connectors/${item.categoryId}`
      : deck?.type === 'mine' ? '/mine' : `/category/${item.categoryId}`;
    return el('a', { class: 'ref-chip', href: link(path) }, `${item.categoryTitle || deck?.title || ''} ›`);
  };

  const card = ({ item }) =>
    el('article', { class: 'phrase-card translate-match', dataset: { item: item.id } },
      el('div', { class: 'phrase-main' }, phraseBlock(item, s), audioButton(item, playItem)),
      el('div', { class: 'ref-list' }, deckLink(item)));

  let exactItems = [];

  function drawCourse() {
    const text = state.text.trim();
    exactItems = [];
    clear(exactBox);
    clear(similarBox);
    if (!text) return;
    const matches = searchCourse(items, text, { side: state.direction === 'say' ? 'meaning' : 'target' });
    const exact = matches.filter((m) => m.exact);
    exactItems = exact.map((m) => m.item);
    const similar = matches.filter((m) => !m.exact);
    if (exact.length) exactBox.append(el('h2', { class: 'section-title' }, t('translate.fromCourse')), el('div', { class: 'phrase-list' }, exact.map(card)));
    if (similar.length) similarBox.append(el('h2', { class: 'section-title' }, t('translate.similar')), el('div', { class: 'phrase-list' }, similar.map(card)));
    // Without the translator, the course is all there is: say when it has nothing.
    if (!matches.length && !ready) exactBox.append(el('p', { class: 'muted small' }, t('translate.noMatch')));
  }

  /* ---------- the offline translator ---------- */

  let token = 0;
  let timer = null;

  async function furiganaFor(text, lang) {
    if (lang !== 'ja' || !content.features.dictionary) return null;
    const dict = await loadDictionary();
    return dict ? sentenceFurigana(dict, text) : null;
  }

  async function runMachine() {
    const text = state.text.trim();
    const p = pair();
    if (!text || !ready || !p) { state.machine = null; drawMachine(); return; }
    if (state.machine?.input === text && state.machine.direction === state.direction) { drawMachine(); return; }
    const mine = ++token;
    drawMachine(true);
    try {
      const { text: out } = await translator.translate(registry, p, text);
      if (mine !== token) return;
      const output = translator.tidy(out, to());
      // The Japanese side gets readings: the translation when saying, what was typed when reading.
      const jaText = state.direction === 'say' ? output : text;
      const jaLang = state.direction === 'say' ? to() : from();
      state.machine = { input: text, output, direction: state.direction, furigana: await furiganaFor(jaText, jaLang) };
    } catch (err) {
      if (mine !== token) return;
      console.error(err);
      state.machine = { input: text, error: true, direction: state.direction };
    }
    drawMachine();
  }

  function drawMachine(working = false) {
    clear(machineBox);
    if (!state.text.trim() || !ready || !pair()) return;
    machineBox.append(el('h2', { class: 'section-title' }, t('translate.machine')));
    const m = state.machine;
    if (working || !m) { machineBox.append(el('p', { class: 'muted' }, t('translate.working'))); return; }
    if (m.error) { machineBox.append(el('p', { class: 'error' }, t('translate.failed'))); return; }
    const saying = m.direction === 'say';
    // The course already says exactly this: once is enough.
    if (exactItems.some((item) => score(m.output, saying ? item.target : item.meaning) === 1)) { clear(machineBox); return; }
    // The target-language side, with its readings: what to say, or what was read.
    const targetSide = {
      target: saying ? m.output : m.input,
      ruby: m.furigana ? toSegments(m.furigana) : null,
      targetLang: course.target,
    };
    const meaning = saying ? m.input : m.output;
    const speakBtn = el('button', {
      type: 'button', class: 'audio-btn', 'aria-label': t('translate.listen'),
      onclick: async () => {
        if ((await audio.speak(targetSide.target, course.target)) === 'missing') toast(t('translate.noVoice'));
      },
    }, '🔊');
    machineBox.append(
      el('article', { class: 'phrase-card translate-result', lang: null },
        el('div', { class: 'phrase-main' },
          el('div', { class: 'phrase-block phrase-md' },
            targetNode(targetSide, { furigana: furiganaMode(s, targetSide) }),
            el('div', { class: 'meaning', lang: course.speaker }, meaning)),
          speakBtn),
        el('div', { class: 'action-row' },
          el('button', {
            type: 'button', class: 'btn btn-small translate-add',
            onclick: () => startNewWith({
              target: m.furigana || targetSide.target, meaning, note: t('translate.noteMachine'), returnTo: '/translate',
            }),
          }, t('translate.addMine')))),
      el('p', { class: 'muted small' }, t('translate.machineNote')));
  }

  /* ---------- downloading it ---------- */

  function drawPanel() {
    clear(panel);
    if (!canRun) { panel.append(el('p', { class: 'muted small' }, t('translate.unsupported'))); return; }
    const mine = downloading?.courseId === course.id ? downloading : null;
    if (ready) {
      panel.append(el('div', { class: 'translator-ready' },
        el('span', { class: 'muted small' }, t('translate.ready', { size })),
        el('button', {
          type: 'button', class: 'btn btn-small btn-ghost translate-remove',
          onclick: async () => {
            if (!confirm(t('translate.removeConfirm'))) return;
            await translator.remove();
            ready = false;
            state.machine = null;
            drawMachine();
            drawPanel();
          },
        }, t('translate.remove'))));
      return;
    }
    const percent = mine && mine.total ? Math.floor((mine.done / mine.total) * 100) : 0;
    panel.append(el('div', { class: 'translator-get' },
      el('h2', { class: 'section-title' }, t('translate.getTitle')),
      el('p', { class: 'small' }, t('translate.getBody', { size })),
      mine && !mine.error
        ? el('div', {},
            el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${percent}%` })),
            el('p', { class: 'muted small translate-progress' }, t('translate.downloading', { percent })))
        : el('div', {},
            mine?.error ? el('p', { class: 'error small' }, t('translate.downloadFailed')) : null,
            el('button', { type: 'button', class: 'btn btn-primary translate-download', onclick: startDownload },
              t('translate.download', { size })))));
  }

  async function startDownload() {
    downloading = { courseId: course.id, done: 0, total: translator.bytesOf(files), error: false };
    drawPanel();
    let last = 0;
    try {
      await translator.download(files, (done, total) => {
        downloading.done = done;
        downloading.total = total;
        // Redraw at most every percent, and only while this screen is showing.
        const p = Math.floor((done / total) * 100);
        if (p !== last && panel.isConnected) { last = p; drawPanel(); }
      });
      downloading = null;
      ready = (await translator.status(files)).ready;
      if (!panel.isConnected) return;
      drawPanel();
      if (ready) { translator.warm(registry, pair()); runMachine(); }
    } catch (err) {
      console.error(err);
      downloading.error = true;
      if (panel.isConnected) drawPanel();
    }
  }

  /* ---------- the screen ---------- */

  const dirButton = (dir) => {
    const p = dir === 'say' ? dirs.say : dirs.read;
    const [a, b] = dir === 'say' ? [course.speaker, course.target] : [course.target, course.speaker];
    return el('button', {
      type: 'button', class: `segment ${state.direction === dir ? 'is-on' : ''}`, dataset: { direction: dir },
      disabled: !p,
      onclick: () => {
        if (state.direction === dir) return;
        state.direction = dir;
        state.machine = null;
        renderTranslate(clear(root));
      },
    }, t('translate.direction', { from: name(a), to: name(b) }));
  };

  input.addEventListener('input', () => {
    state.text = input.value;
    drawCourse();
    clearTimeout(timer);
    timer = setTimeout(() => { if (input.isConnected) runMachine(); }, 500);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); clearTimeout(timer); runMachine(); }
  });

  root.append(
    el('div', { class: 'screen translate' },
      header(t('translate.title'), t('translate.lede')),
      el('div', { class: 'segmented translate-direction' }, dirButton('say'), dirButton('read')),
      el('div', { class: 'form-field translate-field' }, input),
      el('div', { class: 'action-row' },
        el('button', {
          type: 'button', class: 'btn btn-primary translate-go',
          onclick: () => { state.text = input.value; drawCourse(); clearTimeout(timer); runMachine(); },
        }, t('translate.go')),
        state.text ? el('button', {
          type: 'button', class: 'btn btn-ghost translate-clear',
          onclick: () => { state.text = ''; state.machine = null; renderTranslate(clear(root)); },
        }, t('translate.clear')) : null),
      exactBox,
      machineBox,
      similarBox,
      panel,
      el('p', { class: 'muted small footnote translate-credit' },
        t('translate.credit'), ' ',
        el('a', { href: registry.source, target: '_blank', rel: 'noopener' }, 'Mozilla'), ' · ',
        el('a', { href: registry.licenceFile, target: '_blank', rel: 'noopener' }, registry.licence)))
  );

  drawCourse();
  drawPanel();
  if (ready && state.text.trim()) runMachine();
  else drawMachine();
  if (ready) translator.warm(registry, pair());
}
