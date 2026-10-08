/**
 * scenario.js — branching dialogue trees (README §2 Day 2, §4.3).
 *
 * Static JSON, no engine. A node holds an NPC line and 2-3 player
 * options; each option carries a `quality` (good / awkward / wrong), a
 * feedback line explaining *why*, and a `next` node id.
 *
 * Picking an awkward option doesn't dead-end the scenario — it explains
 * what landed oddly and continues. The register mismatch is the lesson
 * (README §6), so failing forward teaches more than blocking.
 *
 * Player options reference phrase IDs from the category content rather
 * than duplicating text (§3a), which also means they reuse that phrase's
 * bundled audio clip.
 */

import { loadContent, loadScenario } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { link } from './course.js';
import { t, has } from './i18n.js';
import { el, clear, targetNode, meaningNode } from './render.js';

const QUALITY_ICON = { good: '✓', awkward: '~', wrong: '✕' };

/** Resolve an option to displayable text, following its phraseId if present. */
function resolveOption(option, phrases) {
  if (option.phraseId) {
    const p = phrases.get(option.phraseId);
    if (p) return { ...p, ...option, target: p.target, ruby: p.ruby, reading: p.reading, meaning: p.meaning };
    // Content moved under us — fall back to whatever the option carries.
    return { ...option, meaning: option.meaning || t('scenario.missingPhrase', { id: option.phraseId }) };
  }
  return option;
}

/* ---------- list screen ---------- */

export async function renderScenarioList(root) {
  const { manifest, byCategory } = await loadContent();
  const settings = await deck.getSettings();
  const scenarios = manifest.scenarios || [];

  root.append(
    el('div', { class: 'screen' },
      el('header', { class: 'screen-header' },
        el('h1', {}, t('scenarios.title')),
        el('p', { class: 'lede' }, t('scenarios.lede'))),

      el('div', { class: 'card-list' },
        scenarios.length
          ? scenarios.map((s) => {
              const cat = byCategory.get(s.category);
              const active = settings.activeCategories.includes(s.category);
              return el('a', { class: 'row-card', href: link(`/scenario/${s.id}`) },
                el('span', { class: 'row-icon' }, s.icon || '🗣️'),
                el('span', { class: 'row-body' },
                  el('span', { class: 'row-title' }, s.title),
                  el('span', { class: 'row-sub' },
                    `${cat ? cat.title : s.category}${active ? '' : t('scenarios.notInDeck')}`)),
                el('span', { class: 'row-chev' }, '›'));
            })
          : el('p', { class: 'muted' }, t('scenarios.none')))
    )
  );
}

/* ---------- player ---------- */

export async function renderScenario(root, id) {
  const scenario = await loadScenario(id);
  const { phrases } = await loadContent();
  const settings = await deck.getSettings();

  let nodeId = scenario.start;
  const transcript = []; // { speaker, node?, choice?, feedback? }

  const view = el('div', { class: 'screen scenario' });
  root.append(view);

  function speakerName(speaker) {
    if (speaker === 'narration') return null;
    return has(`speaker.${speaker}`) ? t(`speaker.${speaker}`) : speaker;
  }

  // Narration and scene-setting are written in the learner's own language;
  // they are stage directions, not lines to learn.
  const narration = (node) => meaningNode(node, { tag: 'div' });

  function npcLine(node, { muted = false } = {}) {
    if (node.speaker === 'narration') {
      return el('div', { class: 'narration' }, narration(node));
    }
    return el('div', { class: `dialogue npc ${muted ? 'past' : ''}` },
      el('div', { class: 'dialogue-who' }, speakerName(node.speaker)),
      targetNode(node, { furigana: settings.furigana }),
      settings.romaji && node.reading ? el('div', { class: 'romaji' }, node.reading) : null,
      meaningNode(node),
      node.audio
        ? el('button', {
            class: 'btn btn-ghost audio-inline', type: 'button',
            onclick: () => audio.play(node.audio),
          }, t('scenario.listen'))
        : null);
  }

  function choiceLine(entry) {
    const quality = QUALITY_ICON[entry.quality] ? entry.quality : 'good';
    return el('div', { class: `dialogue you past quality-${entry.quality}` },
      el('div', { class: 'dialogue-who' }, t('scenario.you')),
      entry.target ? targetNode(entry, { furigana: settings.furigana }) : null,
      settings.romaji && entry.reading ? el('div', { class: 'romaji' }, entry.reading) : null,
      meaningNode(entry),
      el('div', { class: `feedback feedback-${entry.quality}`, lang: entry.meaningLang || null },
        el('span', { class: 'feedback-tag' }, `${QUALITY_ICON[quality]} ${t(`quality.${quality}`)}`),
        entry.feedback));
  }

  function draw() {
    const node = scenario.nodes[nodeId];
    if (!node) {
      view.append(el('p', { class: 'error' }, t('scenario.broken', { id, node: nodeId })));
      return;
    }
    clear(view);

    const isEnd = node.end === true;

    // Native append() prints a null child as "null" — the end node has no options.
    view.append(...[
      el('a', { class: 'back-link', href: link('/scenarios') }, t('scenario.back')),
      el('header', { class: 'screen-header' },
        el('h1', {}, `${scenario.icon || ''} ${scenario.title}`),
        el('p', { class: 'lede' }, scenario.setting)),

      // Everything already said, greyed out.
      el('div', { class: 'transcript' },
        transcript.map((entry) =>
          entry.kind === 'npc' ? npcLine(entry.node, { muted: true }) : choiceLine(entry))),

      isEnd
        ? el('div', { class: 'scenario-end' },
            el('div', { class: 'narration' }, narration(node)),
            el('div', { class: 'action-row' },
              el('button', { class: 'btn btn-primary', onclick: restart }, t('scenario.again')),
              el('a', { class: 'btn btn-ghost', href: link('/scenarios') }, t('scenario.backToList'))))
        : npcLine(node),

      !isEnd && node.options?.length
        ? el('div', { class: 'scenario-options' },
            el('div', { class: 'muted small options-label' }, t('scenario.reply')),
            node.options.map((option) => optionButton(option, node)))
        : null,
    ].filter(Boolean));

    // Auto-play the NPC line so the ear gets the same reps the eye does.
    if (!isEnd && node.audio && settings.autoPlayAudio) audio.play(node.audio);
    if (isEnd) window.scrollTo(0, document.body.scrollHeight);
  }

  function optionButton(option, node) {
    const resolved = resolveOption(option, phrases);
    return el('button', {
      class: 'btn btn-option',
      onclick: () => choose(option, resolved, node),
    },
      resolved.target ? targetNode(resolved, { furigana: settings.furigana }) : null,
      settings.romaji && resolved.reading ? el('span', { class: 'romaji' }, resolved.reading) : null,
      meaningNode(resolved, { tag: 'span' }),
      option.phraseId ? el('span', { class: 'from-deck' }, t('scenario.fromDeck', { id: option.phraseId })) : null);
  }

  async function choose(option, resolved, node) {
    transcript.push({ kind: 'npc', node });
    transcript.push({
      kind: 'choice',
      target: resolved.target,
      ruby: resolved.ruby,
      reading: resolved.reading,
      meaning: resolved.meaning,
      targetLang: resolved.targetLang,
      meaningLang: resolved.meaningLang,
      quality: option.quality || 'good',
      feedback: option.feedback,
    });

    if (option.phraseId) {
      await audio.play(resolved.audio);
      // Using a phrase in context is a real recall event, but it's
      // self-selected from a list, so it's weaker evidence than a
      // flashcard. Nudge the schedule rather than grading it.
      await nudge(option.phraseId);
    }

    nodeId = option.next;
    draw();
  }

  /** A soft "you saw this in context" touch — never advances a new card. */
  async function nudge(phraseId) {
    const card = await deck.getCard(phraseId);
    if (!card || card.state === 'new') return;
    await deck.putCard({ ...card, lastReview: Date.now() });
  }

  function restart() {
    transcript.length = 0;
    nodeId = scenario.start;
    window.scrollTo(0, 0);
    draw();
  }

  draw();
}
