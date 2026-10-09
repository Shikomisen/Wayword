/**
 * drills.js — the sentence-building drills (README §15). Pure logic, no DOM:
 * which drills a lesson's examples make, the order a session runs in, and
 * the checks. connectors.js draws them.
 *
 *   fill     pick what fills the gap — the connector, or the form before it
 *   order    rebuild a sentence from its shuffled pieces, given its meaning
 *   combine  join two sentences into one, with trap pieces in the pile
 *
 * All three come from an example's own data (content.js normalises it):
 * `chunks` are the pieces, `gap` the fill-in, `combine` the two sentences
 * and their traps, `alsoOrders` any other order that is just as right.
 */

export const DRILL = { FILL: 'fill', ORDER: 'order', COMBINE: 'combine' };

/** Every drill a lesson's examples support. Ordering needs three pieces to be worth doing. */
export function drillsFor(lesson) {
  const out = [];
  for (const ex of lesson.items || []) {
    if (ex.gap) out.push({ type: DRILL.FILL, ex, lesson });
    if ((ex.chunks || []).length >= 3) out.push({ type: DRILL.ORDER, ex, lesson });
    if (ex.combine && (ex.chunks || []).length) out.push({ type: DRILL.COMBINE, ex, lesson });
  }
  return out;
}

export function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A practice session: the lessons' drills shuffled, at most `size` of them,
 * spread so the same sentence doesn't come up twice in a row where that can
 * be avoided — the second drill would just be the first one's answer.
 */
export function buildSession(lessons, { size = Infinity, random = Math.random } = {}) {
  const rest = shuffle(lessons.flatMap(drillsFor), random).slice(0, size);
  const out = [];
  while (rest.length) {
    const last = out.at(-1)?.ex.id;
    const left = new Map();
    for (const d of rest) left.set(d.ex.id, (left.get(d.ex.id) || 0) + 1);
    // Next: the sentence with the most drills still to come (other than the
    // one just asked) — taking the biggest pile first is what guarantees the
    // rest can still be spread out. Ties fall to the shuffle.
    let pick = -1;
    rest.forEach((d, i) => {
      if (d.ex.id !== last && (pick < 0 || left.get(d.ex.id) > left.get(rest[pick].ex.id))) pick = i;
    });
    out.push(rest.splice(pick < 0 ? 0 : pick, 1)[0]);
  }
  return out;
}

/** Is this sequence of piece indices a right answer? Some sentences allow more than one order. */
export function isRightOrder(ex, sequence) {
  const n = (ex.chunks || []).length;
  const orders = [Array.from({ length: n }, (_, i) => i), ...(ex.alsoOrders || [])];
  return orders.some((o) => o.length === sequence.length && o.every((v, i) => v === sequence[i]));
}

/**
 * The tiles for an order or combine drill: the sentence's pieces (tagged
 * with `chunk`, their position) plus, for combine, the traps (tagged with
 * `trap`). Shuffled so the real pieces never start out already in a right order.
 */
export function tilesFor(drill, random = Math.random) {
  const pieces = drill.ex.chunks.map((c, i) => ({ ...c, chunk: i }));
  const traps = drill.type === DRILL.COMBINE ? drill.ex.combine.distractors.map((d, i) => ({ ...d, trap: i })) : [];
  const all = [...pieces, ...traps];
  if (pieces.length < 2) return all;
  const inOrder = (tiles) => isRightOrder(drill.ex, tiles.filter((t) => t.trap === undefined).map((t) => t.chunk));
  for (let tries = 0; tries < 50; tries++) {
    const tiles = shuffle(all, random);
    if (!inOrder(tiles)) return tiles;
  }
  return [...all].reverse();
}

/** Right if the placed tiles are the sentence's pieces in a right order, with no trap among them. */
export function checkTiles(drill, placed) {
  if (placed.some((t) => t.trap !== undefined)) return false;
  return isRightOrder(drill.ex, placed.map((t) => t.chunk));
}
