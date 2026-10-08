/**
 * course.js — which language pair is active, and app-wide preferences.
 *
 * A course pairs the learner's own language (speaker) with the language
 * being learned (target), e.g. en-ja is English speakers learning Japanese.
 * The list lives in content/courses.json; the home page offers it.
 *
 * Activating a course does three things at once so nothing can drift out of
 * step: points storage at that course's own database, switches the
 * interface to the speaker's language, and makes course-relative links and
 * content loads resolve against it.
 */

import * as store from './store.js';
import { setLang } from './i18n.js';

const DEFAULT_COURSE = 'en-ja';

let registry = null;
let currentId = DEFAULT_COURSE;

export async function loadCourses() {
  if (registry) return registry;
  const res = await fetch('content/courses.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load content/courses.json (${res.status})`);
  registry = await res.json();
  return registry;
}

export async function getCourse(id) {
  const { courses } = await loadCourses();
  return courses.find((c) => c.id === id) || null;
}

export function currentCourseId() {
  return currentId;
}

export async function currentCourse() {
  return getCourse(currentId);
}

export async function setCourse(id) {
  const course = await getCourse(id);
  if (!course) throw new Error(`Unknown course: ${id}`);
  currentId = id;
  store.useNamespace(id);
  setLang(course.speaker);
  return course;
}

/** A language's name as shown in a given interface language. */
export function languageName(code, uiLang) {
  const lang = registry?.languages?.[code];
  if (!lang) return code;
  return lang.name[uiLang] ?? lang.name.en ?? code;
}

export function languageInfo(code) {
  return registry?.languages?.[code] ?? { name: { en: code }, native: code, badge: code.toUpperCase() };
}

/* ---------- course-relative navigation ---------- */

/** href for a path inside the current course: link('/browse') → '#/en-ja/browse'. */
export function link(path = '/') {
  return `#/${currentId}${path}`;
}

export function go(path = '/') {
  location.hash = `/${currentId}${path}`;
}

export function goHome() {
  location.hash = '/';
}

/* ---------- app-wide preferences ---------- */

const DEFAULT_PREFS = { speaker: null, lastCourse: null, textScale: null };

export async function getPrefs() {
  return { ...DEFAULT_PREFS, ...((await store.get('meta', 'prefs', 'app')) || {}) };
}

export async function savePrefs(patch) {
  const prefs = { ...(await getPrefs()), ...patch };
  await store.set('meta', 'prefs', prefs, 'app');
  return prefs;
}

/** First-visit guess at the learner's language: the device language, if we teach from it. */
export function guessSpeaker(speakers) {
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  const code = nav.slice(0, 2).toLowerCase();
  return speakers.includes(code) ? code : 'en';
}

/**
 * Text size is an accessibility setting, so it applies across every course.
 * It used to live in the Japanese course's settings; that value is carried
 * over the first time it is read rather than resetting anyone to 1×.
 */
export async function getTextScale() {
  const prefs = await getPrefs();
  if (typeof prefs.textScale === 'number') return prefs.textScale;
  const legacy = await store.get('meta', 'settings', DEFAULT_COURSE);
  return typeof legacy?.textScale === 'number' ? legacy.textScale : 1;
}
