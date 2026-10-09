/**
 * i18n.js — interface strings, in the learner's own language.
 *
 * The UI language follows the course's *speaker*, not its target: someone
 * learning English from Japanese gets a Japanese interface. The strings
 * themselves are content, in content/ui/<lang>.json — adding an interface
 * language is adding a file, not changing code. Course-specific wording (the
 * placement intro, note labels, group titles) lives in that course's
 * manifest instead.
 *
 * Templates use {placeholders}. Where a sentence changes with a number,
 * the file has `key_one` / `key_other` (and any other CLDR form the language
 * needs, e.g. `_few`), picked by Intl.PluralRules for the interface
 * language; a language without plurals just uses `key`. A key missing from a
 * dictionary falls back to English, then to the key itself — which is how
 * screens that only English-speaking learners can reach (Characters) get
 * away with no Japanese strings.
 *
 * A few boot-error strings are built in: they have to show when content
 * can't be loaded at all.
 */

const BUILT_IN = {
  en: {
    'error.title': 'Something went wrong',
    'error.lede': 'The app could not finish starting up.',
    'error.hint': 'If this was a connection problem, reloading once more usually fixes it — the offline cache installs in the background.',
    'error.reload': 'Reload',
  },
};

const dicts = { en: { ...BUILT_IN.en } };
const loading = new Map(); // lang → Promise<boolean>
let lang = 'en';

/** Fetch content/ui/<code>.json once. Resolves false (and retries next time) if it can't. */
export function loadStrings(code) {
  if (loading.has(code)) return loading.get(code);
  const promise = fetch(`content/ui/${code}.json`, { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((dict) => {
      if (!dict) { loading.delete(code); return false; }
      dicts[code] = { ...(BUILT_IN[code] || {}), ...dict };
      return true;
    });
  loading.set(code, promise);
  return promise;
}

/**
 * Switch the interface language, loading its strings first; also sets
 * <html lang> for fonts and screen readers. A language with no dictionary
 * falls back to English.
 */
export async function setLang(next) {
  await loadStrings('en'); // the fallback for anything a dictionary lacks
  if (next && next !== 'en') await loadStrings(next);
  lang = next && dicts[next] ? next : 'en';
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lang;
  }
}

export function getLang() {
  return lang;
}

/** Fill {placeholders} in a template — also used for manifest-supplied copy. */
export function fill(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

function pluralForm(code, n) {
  try { return new Intl.PluralRules(code).select(n); } catch { return n === 1 ? 'one' : 'other'; }
}

function lookup(code, key, n) {
  const dict = dicts[code];
  if (!dict) return undefined;
  if (typeof n === 'number') {
    const form = dict[`${key}_${pluralForm(code, n)}`] ?? dict[`${key}_other`];
    if (form !== undefined) return form;
  }
  return dict[key];
}

export function t(key, params = {}) {
  const value = lookup(lang, key, params.n) ?? lookup('en', key, params.n);
  return value === undefined ? key : fill(value, params);
}

export function has(key) {
  return [lang, 'en'].some((code) => dicts[code] && (key in dicts[code] || `${key}_other` in dicts[code]));
}

/** Locale for dates, from the dictionary's "$locale" (none = the device default). */
export function locale() {
  return dicts[lang]?.$locale || undefined;
}

/** Localised "next review in …" (srs.formatInterval is the English original). */
export function formatInterval(card, DAY = 86400000, MIN = 60000) {
  if (card.state === 'new') return t('interval.new');
  const ms = card.due - Date.now();
  if (ms <= 0) return t('interval.now');
  if (ms < 60 * MIN) return t('interval.min', { n: Math.max(1, Math.round(ms / MIN)) });
  if (ms < DAY) return t('interval.hr', { n: Math.round(ms / (60 * MIN)) });
  const days = Math.round(ms / DAY);
  if (days < 30) return t('interval.day', { n: days });
  return t('interval.mo', { n: Math.round(days / 30) });
}
