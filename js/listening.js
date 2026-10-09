/**
 * listening.js — the listening drill (README §18). Pure logic, no DOM:
 * listen-drill.js draws it, deck.js stores the per-item record.
 *
 * Two kinds of question, from the course's `listening` content:
 *   reply     hear something said back — at a counter, on a bus — and pick
 *             what it means
 *   contrast  hear one of two words that differ by a sound Japanese doesn't
 *             tell apart (light / right, fifteen / fifty) and pick which
 *
 * An item is mastered by the rule in mastery.js. A day's drill is about ten
 * questions: what's in progress (missed last time first), a few new items —
 * both kinds, so a first drill has some of each — and a couple of mastered
 * ones so they stay mastered.
 */

import { drillMastered, byNeed, shuffle } from './mastery.js';

export const DRILL_SIZE = 10;
export const NEW_PER_DRILL = 6;

/** Every item the drill can ask, across the course's listening sets. */
export const listeningItems = (sets) => sets.flatMap((s) => s.items || []);

export function listeningProgress(items, stats) {
  return {
    total: items.length,
    mastered: items.filter((i) => drillMastered(stats[i.id])).length,
    seen: items.filter((i) => stats[i.id]).length,
  };
}

/** New items in the order they're written, taking from both kinds in turn. */
function newItems(unseen, n) {
  const replies = unseen.filter((i) => i.kind === 'reply');
  const contrasts = unseen.filter((i) => i.kind === 'contrast');
  const out = [];
  while (out.length < n && (replies.length || contrasts.length)) {
    if (replies.length) out.push(replies.shift());
    if (out.length < n && contrasts.length) out.push(contrasts.shift());
  }
  return out;
}

/** Two other lines, with different meanings, to be the wrong options. */
const decoys = (item, pool, random) =>
  shuffle(pool.filter((o) => o.id !== item.id && o.meaning !== item.meaning), random).slice(0, 2);

/**
 * One day's drill. A reply question offers its meaning among two others; a
 * contrast question offers the two words of its pair, in their written order.
 */
export function buildListeningDrill(items, stats, { size = DRILL_SIZE, newMax = NEW_PER_DRILL, random = Math.random } = {}) {
  const mastered = (i) => drillMastered(stats[i.id]);
  const inProgress = byNeed(items.filter((i) => stats[i.id] && !mastered(i)), stats);
  const unseen = items.filter((i) => !stats[i.id]);
  const known = items.filter(mastered);

  const refreshCount = Math.min(known.length, 2);
  // Two seats are kept for something new, however much is in progress.
  const learning = inProgress.slice(0, Math.max(0, size - refreshCount - 2));
  const fresh = newItems(unseen, Math.max(0, Math.min(newMax, size - refreshCount - learning.length)));
  const refresh = shuffle(known, random).slice(0, Math.max(refreshCount, size - learning.length - fresh.length));
  const targets = [...learning, ...fresh, ...refresh].slice(0, size);

  const replyPool = items.filter((i) => i.kind === 'reply');
  return shuffle(targets, random).map((item) => (item.kind === 'reply'
    ? { type: 'reply', item, options: shuffle([item, ...decoys(item, replyPool, random)], random) }
    : { type: 'contrast', item, options: item.pair }));
}
