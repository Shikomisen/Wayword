/**
 * choice.js — one "pick the right one" question card, shared by the daily
 * kana drill (reading.js) and the listening drill (listen-drill.js): the
 * option buttons, marking the answer, the verdict, and moving on.
 *
 * The caller supplies what differs: the prompt, the options, what to record
 * and show once answered (onAnswer), and the words for the verdict.
 */

import { el } from './render.js';

/**
 * @param {object} q
 * @param {string} q.kind          what's being asked, shown above the prompt
 * @param {Node[]} q.prompt        the question itself: a character, a play button…
 * @param {{ id: string, node: Node|string, className?: string }[]} q.options
 * @param {string} q.rightId
 * @param {{ right: string, wrong: string }} q.verdicts
 * @param {(ok: boolean, id: string) => Promise<Node[]>|Node[]} q.onAnswer
 *        record the answer; returns what to show under the verdict
 * @param {{ label: string, go: () => void }} q.next
 * @param {boolean} [q.autoAdvance] move on by itself after a right answer
 * @returns {{ node: HTMLElement, key: (k: string) => void }}
 *        `key` handles 1–9 (choose) and Enter (next) for the keyboard
 */
export function choiceQuestion({
  kind, prompt, options, rightId, verdicts, onAnswer, next,
  autoAdvance = false, cardClass = '', optionsClass = '', dataset = {},
}) {
  const feedback = el('div', { class: 'drill-feedback' });
  let answered = false;
  let moved = false;
  const go = () => {
    if (moved) return;
    moved = true;
    next.go();
  };

  const buttons = options.map((o) => el('button', {
    type: 'button', class: `btn option ${o.className || ''}`, dataset: { id: o.id },
    onclick: () => choose(o.id),
  }, o.node));

  const question = {
    node: null,
    key: (k) => { const n = Number(k); if (n >= 1 && n <= buttons.length) buttons[n - 1].click(); },
  };

  async function choose(id) {
    if (answered) return;
    answered = true;
    const ok = id === rightId;
    buttons.forEach((b) => {
      b.disabled = true;
      if (b.dataset.id === rightId) b.classList.add(ok ? 'is-right' : 'is-answer');
      else if (b.dataset.id === id) b.classList.add('is-wrong');
    });
    const shown = (await onAnswer(ok, id)) || [];
    feedback.append(...[
      el('p', { class: `verdict verdict-${ok ? 'right' : 'wrong'}` }, ok ? verdicts.right : verdicts.wrong),
      ...shown,
      el('button', { type: 'button', class: 'btn btn-primary btn-lg full drill-next', onclick: go }, next.label),
    ].filter(Boolean));
    question.key = (k) => { if (k === 'Enter') go(); };
    // A right answer moves on by itself; a wrong one waits to be looked at.
    if (ok && autoAdvance) setTimeout(() => { if (question.node.isConnected) go(); }, 900);
  }

  question.node = el('div', { class: `drill-card ${cardClass}`, dataset },
    el('div', { class: 'drill-kind' }, kind),
    ...prompt.filter(Boolean),
    el('div', { class: `drill-options ${optionsClass}` }, buttons),
    feedback);
  return question;
}
