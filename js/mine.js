/**
 * mine.js — your own words and sentences.
 *
 * Things you want to learn that aren't in any deck: what your partner said
 * at dinner, a word you looked up. They live in the course's own storage
 * (deck.saveUserItem) and are studied exactly like everything else — the
 * deck is called "mine".
 *
 * Audio, where possible:
 *   - the device's own voice for the language, if it has one that runs on
 *     the device (checked when you add the card — see audio.deviceVoice);
 *   - and/or a recording you make, of yourself or of whoever said it.
 * With neither, the card says so clearly ("No audio") and gets no listening
 * card. Nothing is sent to an online speech service: README §8.
 */

import { loadContent, refreshUserItems, USER_DECK } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { go, link, languageName } from './course.js';
import { t } from './i18n.js';
import { el, clear, targetNode, meaningNode, audioButton, furiganaMode, toast } from './render.js';
import { header, playItem, studySettings } from './shared.js';
import { rubyText, alignReading, hasKanji } from './ruby.js';

/* ---------- list ---------- */

export async function renderMine(root) {
  const content = await loadContent();
  const items = content.userItems || [];
  const s = await studySettings();
  const progress = await deck.categoryProgress(USER_DECK);

  root.append(
    el('div', { class: 'screen' },
      el('a', { class: 'back-link', href: link('/browse') }, t('category.back')),
      header(t('mine.title'), t('mine.lede')),
      el('div', { class: 'action-row' },
        el('a', { class: 'btn btn-primary', href: link('/mine/new') }, t('mine.add')),
        items.length
          ? el('a', { class: 'btn', href: link(`/study/${USER_DECK}`) }, t('category.study'))
          : null,
        items.length ? el('span', { class: 'muted small' }, t('category.dueNew', { due: progress.due, fresh: progress.new })) : null),
      items.length
        ? el('div', { class: 'phrase-list' }, [...items].reverse().map((item) => mineCard(item, s)))
        : el('p', { class: 'muted empty-mine' }, t('mine.empty')))
  );
}

function mineCard(item, s) {
  return el('article', { class: 'phrase-card mine-card' },
    el('div', { class: 'phrase-main' },
      el('div', { class: 'phrase-block' },
        targetNode(item, { furigana: furiganaMode(s, item) }),
        meaningNode(item)),
      audioButton(item, playItem)),
    el('div', { class: 'mine-meta' },
      el('span', { class: `audio-state audio-state-${item.audioMode}` }, t(`mine.audioState.${item.audioMode}`)),
      el('span', { class: 'muted small' }, t(item.kind === 'sentence' ? 'mine.kindSentence' : 'mine.kindWord')),
      el('a', { class: 'btn btn-small', href: link(`/mine/${item.id}`) }, t('mine.edit'))));
}

/* ---------- add / edit ---------- */

export async function renderMineForm(root, id) {
  const content = await loadContent();
  const existing = id ? (await deck.getUserItems()).find((x) => x.id === id) : null;
  if (id && !existing) { go('/mine'); return; }

  const lang = content.course.target;
  const langName = languageName(lang, content.course.speaker);
  const voice = await audio.deviceVoice(lang);
  let recording = existing ? await deck.getRecording(existing.id) : null;
  let recorder = null;

  const field = (name, label, help, attrs = {}) => {
    const input = el(attrs.multiline ? 'textarea' : 'input', {
      name, id: `mine-${name}`, class: 'text-input', lang: attrs.lang || null,
      ...(attrs.multiline ? { rows: '2' } : { type: 'text' }),
      autocomplete: 'off', spellcheck: 'false',
    });
    input.value = attrs.value || '';
    return el('label', { class: 'form-field', for: `mine-${name}` },
      el('span', { class: 'form-label' }, label),
      input,
      help ? el('span', { class: 'muted small' }, help) : null);
  };

  // Show it the way it was typed: plain text plus a reading, or — if the
  // readings were written inline — the {漢字|かんじ} form.
  const targetValue = !existing ? ''
    : existing.reading || !existing.furigana ? existing.target : existing.furigana;
  const fTarget = field('target', langName, t('mine.fieldTargetHelp'), { value: targetValue, lang });
  const fReading = lang === 'ja'
    ? field('reading', t('mine.fieldReading'), t('mine.fieldReadingHelp'), { value: existing?.reading || '', lang })
    : null;
  const fMeaning = field('meaning', t('mine.fieldMeaning'), null, { value: existing?.meaning || '', lang: content.course.speaker });
  const fNote = field('note', t('mine.fieldNote'), t('mine.fieldNoteHelp'), { value: existing?.note || '', multiline: true });
  const value = (f) => f?.querySelector('input, textarea')?.value.trim() || '';

  let kind = existing?.kind || null; // decided from the text unless chosen
  const kindRow = el('div', { class: 'segmented kind-choice', role: 'group' });
  const drawKind = () => {
    const current = kind || guessKind(value(fTarget));
    clear(kindRow).append(...['word', 'sentence'].map((k) =>
      el('button', {
        type: 'button', class: current === k ? 'segment is-on' : 'segment',
        'aria-pressed': current === k ? 'true' : 'false', dataset: { kind: k },
        onclick: () => { kind = k; drawKind(); },
      }, t(k === 'word' ? 'mine.kindWord' : 'mine.kindSentence'))));
  };
  fTarget.querySelector('input').addEventListener('input', () => { if (!existing?.kind) drawKind(); });
  drawKind();

  // Audio: the device voice and/or a recording.
  const useVoice = el('input', { type: 'checkbox', name: 'use-voice' });
  useVoice.checked = existing ? existing.audioMode === 'tts' : Boolean(voice);
  const audioBox = el('div', { class: 'audio-box' });
  const drawAudio = () => {
    const state = recording ? 'recording' : voice && useVoice.checked ? 'tts' : 'none';
    // Native append() prints a null child as "null" — drop the absent controls first.
    clear(audioBox).append(...[
      el('p', { class: `audio-state audio-state-${state}` }, t(`mine.audioState.${state}`)),
      voice
        ? el('label', { class: 'setting compact' },
            el('span', {}, el('strong', {}, t('mine.audioDevice')),
              el('span', { class: 'muted small' }, t('mine.audioDeviceHelp', { voice: voice.name }))),
            useVoice)
        : el('p', { class: 'muted small' }, t('mine.audioDeviceNone', { lang: langName })),
      voice
        ? el('button', { type: 'button', class: 'btn btn-small', onclick: () => audio.speak(value(fReading) || plain(value(fTarget)), lang) },
            t('mine.hear'))
        : null,
      audio.canRecord()
        ? el('div', { class: 'action-row record-row' },
            recorder
              ? el('button', { type: 'button', class: 'btn btn-danger', onclick: stopRecording }, t('mine.stop'))
              : el('button', { type: 'button', class: 'btn', onclick: startRecording }, t('mine.record')),
            recording ? el('button', { type: 'button', class: 'btn btn-small', onclick: () => audio.play(recording) }, t('mine.playRecording')) : null,
            recording ? el('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { recording = null; drawAudio(); } }, t('mine.deleteRecording')) : null)
        : el('p', { class: 'muted small' }, t('mine.recordUnsupported')),
    ].filter(Boolean));
  };
  useVoice.addEventListener('change', drawAudio);

  async function startRecording() {
    try {
      recorder = await audio.startRecording();
      drawAudio();
    } catch (err) {
      recorder = null;
      toast(err?.name === 'NotAllowedError' ? t('mine.recordDenied') : t('mine.recordUnsupported'));
      drawAudio();
    }
  }
  async function stopRecording() {
    const r = recorder;
    recorder = null;
    recording = await r.stop();
    drawAudio();
  }
  drawAudio();

  const error = el('p', { class: 'error', role: 'alert' });

  async function save() {
    const raw = value(fTarget);
    const meaning = value(fMeaning);
    if (!raw || !meaning) {
      error.textContent = t('mine.required', { field: !raw ? langName : t('mine.fieldMeaning') });
      return;
    }
    if (recorder) await stopRecording();
    const target = plain(raw);
    const reading = value(fReading);
    // Furigana: typed inline as {漢字|かんじ}, or spread from the reading.
    const furigana = raw.includes('{')
      ? raw
      : reading && hasKanji(target) ? alignReading(target, reading) || `{${target}|${reading}}` : null;
    const item = {
      id: existing?.id || `u-${Date.now().toString(36)}`,
      kind: kind || guessKind(target),
      target,
      reading: reading || null,
      furigana,
      meaning,
      note: value(fNote) || null,
      audioMode: recording ? 'recording' : voice && useVoice.checked ? 'tts' : 'none',
    };
    await deck.setRecording(item.id, recording);
    await deck.saveUserItem(item);
    toast(t('mine.saved'));
    go('/mine');
  }

  async function remove() {
    if (!confirm(t('mine.deleteConfirm'))) return;
    await deck.deleteUserItem(existing.id);
    await refreshUserItems();
    go('/mine');
  }

  root.append(
    el('div', { class: 'screen mine-form' },
      el('a', { class: 'back-link', href: link('/mine') }, t('study.back')),
      header(existing ? t('mine.editTitle') : t('mine.newTitle')),
      el('form', {
        class: 'entry-form', onsubmit: (e) => { e.preventDefault(); save(); },
      },
        fTarget, fReading, fMeaning,
        el('div', { class: 'form-field' }, el('span', { class: 'form-label' }, t('mine.kind')), kindRow),
        fNote,
        el('div', { class: 'form-field' }, el('span', { class: 'form-label' }, t('mine.audioTitle')), audioBox),
        error,
        el('div', { class: 'action-row' },
          el('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, t('mine.save')),
          existing ? el('button', { type: 'button', class: 'btn btn-danger', onclick: remove }, t('mine.delete')) : null)))
  );
}

/** "{漢字|かんじ}" written in the text box → the plain text. */
const plain = (raw) => (raw.includes('{') ? rubyText(raw) : raw);

/**
 * A guess the learner can override: anything with sentence punctuation or
 * spaces, or long, is a sentence — and so is Japanese with a particle in the
 * middle (今日は暑いね, 一緒に行く), which a single word rarely has.
 */
function guessKind(text) {
  const s = plain(text);
  if (/[。？！?!、,.\s]/.test(s) || [...s].length > 10) return 'sentence';
  return /[一-龯々ァ-ヶー][はがをにでへと]./u.test(s) ? 'sentence' : 'word';
}
