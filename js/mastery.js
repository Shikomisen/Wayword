/**
 * mastery.js — when a drilled item counts as learned (README §16). Shared by
 * the kana drill (kana.js) and the listening drill (listening.js); deck.js
 * stores each item's record.
 *
 * Right three times in a row, on at least two different days: knowledge that
 * lasted overnight, not a lucky run.
 */

export const STREAK = 3;
export const DAYS = 2;

/** Has the drill record shown this item mastered? */
export const drillMastered = (stat) =>
  Boolean(stat && stat.streak >= STREAK && (stat.days || []).length >= DAYS);

/** The record after one answer: a right answer extends the streak (and its days), a wrong one starts over. */
export function nextStat(stat, right, day, now = Date.now()) {
  const s = { right: 0, wrong: 0, streak: 0, days: [], last: null, ...(stat || {}) };
  if (right) {
    s.right += 1;
    s.streak += 1;
    if (!s.days.includes(day)) s.days = [...s.days, day].slice(-DAYS - 2);
  } else {
    s.wrong += 1;
    s.streak = 0;
    s.days = [];
  }
  s.last = now;
  return s;
}

/** Items in progress, ordered for practice: missed last time first, then the ones seen longest ago. */
export function byNeed(items, stats) {
  return [...items].sort((a, b) =>
    Number(stats[b.id].streak === 0) - Number(stats[a.id].streak === 0) || (stats[a.id].last || 0) - (stats[b.id].last || 0));
}

export function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
