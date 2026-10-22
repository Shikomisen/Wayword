/**
 * characters.js — the Characters section (hiragana, katakana, kanji).
 *
 * Two screens: a reference chart per set, and a list of sets. Review
 * itself is not implemented here — character cards are phrase-shaped
 * (see content.js → normaliseCharacter), so they go through the exact
 * same runSession() flashcard loop that phrases do. This file only has
 * to get the user into it.
 *
 * Kana render as the traditional grid by row; kanji as a browsable list
 * grouped by usage, each entry showing which phrases already contain it
 * so the two halves of the app reinforce each other rather than sitting
 * side by side (README §2.7).
 *
 * Only courses that ship character sets get this section (Japanese, for
 * English or Indonesian speakers); its wording is in the reading.* interface
 * strings, in the learner's language.
 */

import { loadContent, getCharacterSet, gridFor } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { link, go } from './course.js';
import { el, clear, targetNode, toast, romajiMode, romajiNode } from './render.js';
import { deckHref } from './shared.js';
import { kanaState, kanjiGated, kanaPanel } from './reading.js';
import { t } from './i18n.js';

const ROW_LABEL = {
  a: 'あ', ka: 'か', sa: 'さ', ta: 'た', na: 'な',
  ha: 'は', ma: 'ま', ya: 'や', ra: 'ら', wa: 'わ', n: 'ん',
  ga: 'が', za: 'ざ', da: 'だ', ba: 'ば', pa: 'ぱ',
  ki: 'き', shi: 'し', chi: 'ち', ni: 'に', hi: 'ひ',
  mi: 'み', ri: 'り', gi: 'ぎ', ji: 'じ', bi: 'び', pi: 'ぴ',
  extended: '—',
};

async function playCharacter(c) {
  const result = await audio.play(c.audio);
  if (result === 'missing') toast(t('reading.noClip', { char: c.character }));
  return result;
}

/** Take a character set out of study, once confirmed. Its cards keep their progress. */
async function removeSet(set) {
  if (!confirm(t('reading.removeConfirm', { set: set.title }))) return false;
  await deck.deactivateCharacterSet(set.id);
  toast(t('reading.removed', { set: set.title }));
  return true;
}

/* ---------- set list ---------- */

export async function renderCharacterList(root) {
  const { characterSets, levels = [] } = await loadContent();
  const s = await deck.getSettings();
  const kana = await kanaState();
  const gated = kanjiGated(kana);
  const hira = kana.progress.hiragana;

  const rows = await Promise.all(characterSets.map(async (set) => {
    const progress = await deck.setProgress(set.id);
    const active = s.activeCharacterSets.includes(set.id);
    const studied = progress.total - progress.new;
    const pct = set.characters.length ? Math.round((studied / set.characters.length) * 100) : 0;
    // Kanji wait for hiragana; until then they can be added, but only "anyway".
    const waits = !active && gated && set.script === 'kanji';

    return el('div', { class: `row-card ${active ? 'is-active' : ''} ${waits ? 'is-waiting' : ''}`, dataset: { set: set.id } },
      el('span', { class: 'row-icon char-icon' }, set.icon || '字'),
      el('a', { class: 'row-body', href: link(`/characters/${set.id}`) },
        el('span', { class: 'row-title' }, set.title),
        el('span', { class: 'row-sub' },
          set.missing
            ? t('browse.missing')
            : active
              ? t('reading.setStarted', { studied, total: set.characters.length, due: progress.due })
              : waits
                ? t('reading.afterHiragana', { n: hira.mastered, total: hira.total })
                : t('reading.setCount', { n: set.characters.length })),
        active ? el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` })) : null),
      // In the deck: tap again to take it out (asked first; its progress is kept).
      active
        ? el('button', {
            class: 'btn btn-small btn-in-deck', type: 'button', 'aria-pressed': 'true', title: t('browse.remove'),
            onclick: async (e) => {
              e.preventDefault();
              if (await removeSet(set)) renderCharacterList(clear(root));
            },
          }, `✓ ${t('browse.inDeck')}`)
        : el('button', {
            class: waits ? 'btn btn-small btn-ghost' : 'btn btn-small',
            onclick: async (e) => {
              e.preventDefault();
              const { added, seeded, readded } = await deck.activateCharacterSet(set.id);
              toast(readded
                ? t('reading.readded', { set: set.title })
                : t(seeded ? 'reading.addedSeeded' : 'reading.added', { added, seeded }));
              renderCharacterList(clear(root));
            },
          }, t(waits ? 'reading.addAnyway' : 'browse.add')));
  }));

  const summary = await deck.characterSummary();
  const stats = await deck.todayStats();
  const hasKana = Object.keys(kana.progress).length > 0;

  root.append(
    el('div', { class: 'screen' },
      el('header', { class: 'screen-header' },
        el('h1', {}, t('reading.title')),
        el('p', { class: 'lede' }, t('reading.lede'))),

      hasKana ? kanaPanel(kana) : null,

      el('h2', { class: 'section-title' }, t('reading.cards')),
      summary.total
        ? el('div', {},
            el('div', { class: 'stat-row' },
              stat(summary.due, t('stat.due')),
              stat(summary.new, t('reading.unseen')),
              stat(stats.charReviews, t('stat.doneToday')),
              stat(summary.mature, t('reading.mature'))),
            summary.due || summary.new
              ? el('button', {
                  class: 'btn btn-primary btn-lg full',
                  onclick: () => { go('/characters/review'); },
                }, t('reading.review'))
              : el('p', { class: 'muted queue-breakdown' }, t('reading.nothingDue')))
        : el('p', { class: 'muted' }, t('reading.noSets')),

      el('h2', { class: 'section-title' }, t('reading.sets')),
      // With levels, each set sits under its level (README §7.10).
      levels.length
        ? levels.map((l) => {
            const own = characterSets.map((set, i) => [set, rows[i]]).filter(([set]) => set.level === l.id).map(([, r]) => r);
            return own.length
              ? el('section', { class: 'level-group' },
                  el('h3', { class: 'level-subtitle' }, `${l.icon ? `${l.icon} ` : ''}${l.title}`),
                  el('div', { class: 'card-list' }, own))
              : null;
          })
        : el('div', { class: 'card-list' }, rows),

      el('p', { class: 'muted small footnote' }, t('reading.noWriting'))
    )
  );
}

function stat(value, label) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat-value' }, String(value)),
    el('div', { class: 'stat-label' }, label));
}

/* ---------- chart / reference view ---------- */

export async function renderCharacterSet(root, setId) {
  const set = await getCharacterSet(setId);
  if (!set) { go('/characters'); return; }

  const s = await deck.getSettings();
  const active = s.activeCharacterSets.includes(setId);
  const progress = await deck.setProgress(setId);
  const content = await loadContent();
  const kana = await kanaState();
  const waits = !active && set.script === 'kanji' && kanjiGated(kana);

  const view = el('div', { class: 'screen' });
  root.append(view);

  const add = async () => {
    const { added, readded } = await deck.activateCharacterSet(setId);
    toast(readded ? t('reading.readded', { set: set.title }) : t('reading.addedToDeck', { added }));
    renderCharacterSet(clear(root), setId);
  };

  view.append(
    el('a', { class: 'back-link', href: link('/characters') }, `← ${t('reading.title')}`),
    el('header', { class: 'screen-header' },
      el('h1', {}, `${set.icon || ''} ${set.title}`),
      el('p', { class: 'lede' }, set.description)),

    // The soft gate: kanji readings are written in hiragana, so kanji stick
    // far better once hiragana is solid. Adding them anyway is one tap.
    waits
      ? el('div', { class: 'kanji-gate' },
          el('p', {}, el('strong', {}, t('reading.gateTitle')), ' ',
            t('reading.gateBody', { n: kana.progress.hiragana.mastered, total: kana.progress.hiragana.total })),
          el('div', { class: 'action-row' },
            el('a', { class: 'btn btn-primary', href: link('/characters/drill/hiragana') }, t('reading.drillToday.hiragana')),
            el('button', { class: 'btn btn-ghost', type: 'button', onclick: add }, t('reading.addAnyway'))))
      : el('div', { class: 'action-row' },
          active
            ? el('button', {
                class: 'btn btn-primary',
                onclick: () => { go(`/characters/${setId}/study`); },
              }, t('reading.studySet'))
            : el('button', { class: 'btn btn-primary', onclick: add }, t('category.add')),
          active ? el('span', { class: 'muted small' }, t('reading.setPending', { due: progress.due, unseen: progress.new })) : null,
          active
            ? el('button', {
                class: 'btn btn-small btn-ghost remove-deck', type: 'button',
                onclick: async () => { if (await removeSet(set)) renderCharacterSet(clear(root), setId); },
              }, t('browse.remove'))
            : null),

    el('p', { class: 'muted small tap-hint chart-hint' }, t('reading.tapHint')),

    set.layout === 'list' || set.script === 'kanji'
      ? kanjiList(set, content, s)
      : kanaChart(set, s)
  );
}

/* ---------- kana grid ---------- */

function kanaChart(set, settings) {
  const wrap = el('div', { class: 'char-groups' });

  for (const group of set.groups || []) {
    const rows = gridFor(set, group.id);
    if (!rows.length) continue;

    wrap.append(
      el('section', { class: 'char-group' },
        el('h2', { class: 'section-title' }, group.title),
        group.description ? el('p', { class: 'muted small' }, group.description) : null,
        el('div', { class: `kana-grid ${group.id === 'yoon' || group.id === 'extended' ? 'kana-grid-wide' : ''}` },
          rows.map((row) =>
            el('div', { class: 'kana-row' },
              el('div', { class: 'kana-row-label muted' }, ROW_LABEL[row.row] || row.row),
              row.cells.map((c) => (c ? kanaCell(c, settings) : el('div', { class: 'kana-cell kana-empty' }))))))));
  }

  return wrap;
}

function kanaCell(c, settings) {
  // Romaji set to tap to show: the cell is already the thing you tap, to
  // hear it, so that tap shows its romaji too.
  const romaji = romajiMode(settings, c);
  return el('button', {
    class: 'kana-cell',
    type: 'button',
    title: c.note || c.romaji,
    'aria-label': `${c.character}, ${c.romaji}`,
    onclick: (e) => {
      playCharacter(c);
      // currentTarget is nulled once the event finishes dispatching, so the
      // timer must hold its own reference or the highlight never clears.
      const cell = e.currentTarget;
      cell.classList.add('just-played');
      cell.querySelector('.romaji-tap')?.classList.add('revealed');
      setTimeout(() => cell.classList.remove('just-played'), 400);
    },
  },
    el('span', { class: 'kana-char' }, c.character),
    romaji === 'hidden' ? null : el('span', { class: romaji === 'tap' ? 'kana-romaji romaji-tap' : 'kana-romaji' }, c.romaji));
}

/* ---------- kanji list ---------- */

function kanjiList(set, content, settings) {
  const wrap = el('div', { class: 'char-groups' });

  for (const group of set.groups || []) {
    const inGroup = set.characters.filter((c) => c.group === group.id);
    if (!inGroup.length) continue;

    wrap.append(
      el('section', { class: 'char-group' },
        el('h2', { class: 'section-title' }, `${group.title} · ${inGroup.length}`),
        group.description ? el('p', { class: 'muted small' }, group.description) : null,
        el('div', { class: 'kanji-list' }, inGroup.map((c) => kanjiRow(c, content, settings)))));
  }

  return wrap;
}

function kanjiRow(c, content, settings) {
  // Cross-references written by tools/crossref-kanji.mjs — the whole point
  // of the kanji set is that it overlaps the words and phrases being studied.
  const refs = (c.seenIn || []).map((id) => content.phrases.get(id)).filter(Boolean);

  return el('article', { class: 'kanji-row' },
    el('button', {
      class: 'kanji-glyph',
      type: 'button',
      'aria-label': `${c.character}, ${c.romaji}`,
      onclick: (e) => {
        playCharacter(c);
        const glyph = e.currentTarget; // see kanaCell — must outlive the event
        glyph.classList.add('just-played');
        setTimeout(() => glyph.classList.remove('just-played'), 400);
      },
    }, c.character),

    el('div', { class: 'kanji-body' },
      el('div', { class: 'kanji-meaning' }, c.meaning),
      el('div', { class: 'kanji-reading' },
        settings.furiganaMode !== 'hidden' ? (c.readings || []).join('・') : '',
        ' ',
        romajiNode(c, settings, { reading: c.romaji, tag: 'span' })),
      c.note ? el('div', { class: 'note' }, c.note) : null,

      refs.length
        ? el('div', { class: 'kanji-refs' },
            el('span', { class: 'note-label' }, t('reading.seenIn')),
            el('div', { class: 'ref-list' },
              refs.map((p) =>
                el('a', { class: 'ref-chip', href: deckHref(content, p.categoryId), title: p.meaning },
                  targetNode(p, { furigana: false })))))
        : null));
}

/* ---------- study entry points ---------- */

/**
 * Both of these just hand a queue to the shared flashcard session. The
 * character deck is separate from the phrase deck, but the review UI is
 * identical on purpose — one loop to learn, not two.
 */
export async function characterStudyQueue(setId = null) {
  return setId ? deck.characterQueue(setId) : deck.characterQueue();
}
