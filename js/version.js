/**
 * version.js — which version of Wayword this is, shown in Settings and on the
 * language picker so anyone can tell whether their phone has the latest.
 *
 * It must match CACHE_VERSION in sw.js: a changed sw.js is what makes phones
 * update, and npm test fails if the two disagree. Bump both together.
 */

export const VERSION = 'v13';
