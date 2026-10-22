/**
 * search.js — finding what the course already teaches (README §2.14). Pure logic.
 *
 * The translator looks here first: a phrase, sentence or word in the course is
 * checked and comes with its audio, and learning it is one tap away. Matching
 * is by the text the learner typed against either side of each item — the
 * meaning (what they want to say) or the target text (what they want to
 * understand). Japanese is compared by pairs of characters, other languages by
 * words, so neither needs a dictionary.
 */

// Punctuation and spacing that shouldn't decide a match, in both scripts.
const NOISE = /[\s.,!?;:'"’‘“”…。、！？「」『』（）()［］[\]・〜~\-—–/]+/g;
const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

/** Lower case, full-width folded (NFKC), punctuation gone, single spaces. */
export function normalise(text) {
  // An apostrophe joins rather than splits: "I've" is one word, ive, not i + ve.
  return String(text || '').normalize('NFKC').toLowerCase().replace(/['’]/g, '').replace(NOISE, ' ').trim();
}

/**
 * The ways one side of an item can be said: its alternatives split apart —
 * "Yeah. / Yes.", "受け取る、拾う、迎えに行く", "a cold; flu" — with any
 * parenthetical aside dropped: "(said back to the staff)".
 */
export function variants(text) {
  const plain = String(text || '').replace(/[（(][^）)]*[）)]/g, ' ');
  // 、 separates a list of meanings, but inside a sentence (one that ends in 。, ！ or ？) it's just a comma.
  const parts = plain.split(/\s\/\s|[;；]/).flatMap((p) => (/[。！？!?]/.test(p) ? [p] : p.split('、')));
  return [...new Set(parts.map(normalise).filter(Boolean))];
}

// Little words that every English sentence shares: matching on them would pair
// "I lost my wallet on the train" with "I left my umbrella on the train".
const LITTLE = new Set(('a an the i me my mine you your he him his she her it its we us our they them their ' +
  'is am are was were be been do does did to of in on at for with and or but so this that these those there ' +
  'can could would will just please ' +
  'im ive id ill youre youve its thats theres whats lets dont doesnt didnt isnt arent wasnt cant wont').split(' '));

/** Japanese by character pairs; anything else by its words, leaving out the little ones. */
function units(text) {
  if (CJK.test(text)) {
    const s = text.replace(/\s+/g, '');
    if (s.length < 2) return [s];
    return Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
  }
  const words = text.split(' ').filter((w) => w.length > 1 || /\d/.test(w));
  const content = words.filter((w) => !LITTLE.has(w));
  return content.length ? content : words;
}

/** Dice similarity of two unit lists, counting repeats: 1 is the same, 0 shares nothing. */
function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const u of a) counts.set(u, (counts.get(u) || 0) + 1);
  let shared = 0;
  for (const u of b) {
    const n = counts.get(u);
    if (n) { shared++; counts.set(u, n - 1); }
  }
  return (2 * shared) / (a.length + b.length);
}

/** How well a typed text matches one side of an item: 1 for the same words, else 0–1. */
export function score(query, side) {
  const q = normalise(query);
  if (!q) return 0;
  let best = 0;
  for (const v of variants(side)) {
    if (v === q) return 1;
    best = Math.max(best, dice(units(q), units(v)));
  }
  return best;
}

/**
 * The course's best matches for what was typed: up to `limit` items whose
 * `side` ('meaning' or 'target') scores at least `min` (0.7: most of the words). Ties go to the
 * shorter item — the one closest to just what was asked.
 */
export function searchCourse(items, query, { side = 'meaning', limit = 3, min = 0.7 } = {}) {
  if (!normalise(query)) return [];
  const found = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || item.kind === 'character') continue;
    const text = side === 'target' ? item.target : item.meaning;
    if (!text) continue;
    const s = score(query, text);
    if (s < min) continue;
    // The same text in two places (a word deck and a lesson) is shown once.
    const key = normalise(item.target);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ item, score: s, exact: s === 1 });
  }
  return found
    .sort((a, b) => b.score - a.score || String(a.item.target).length - String(b.item.target).length)
    .slice(0, limit);
}
