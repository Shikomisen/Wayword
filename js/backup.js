/**
 * backup.js — export and import of everything this app stores (README §17).
 *
 * Progress lives in one browser on one device: clearing site data, losing
 * the phone or switching browsers would lose it. A backup is one JSON file
 * holding every namespace store.js keeps — each course's cards, settings,
 * placement, stats, your own words and their recordings, and the app-wide
 * preferences — exactly as stored:
 *
 *   {
 *     "format": "wayword-backup", "version": 1, "exportedAt": "…",
 *     "namespaces": {
 *       "app":   { "meta": { "prefs": {…} }, "srs": {} },
 *       "en-ja": { "meta": { "settings": {…}, "userItems": […], "rec:u-…": "data:…" },
 *                  "srs":  { "w-iku": {…}, "w-iku~p": {…} } }
 *     }
 *   }
 *
 * Restoring replaces the namespaces the backup holds and leaves any others
 * alone. What it replaces is kept first, so one restore can be undone.
 */

import * as store from './store.js';
import { loadCourses } from './course.js';

export const FORMAT = 'wayword-backup';
export const VERSION = 1;
const STORES = ['meta', 'srs'];
const APP_NS = 'app';
// Where the state from before the last restore is kept. Never part of a backup.
const UNDO_NS = 'restore-undo';

/** The namespaces with anything worth keeping: the app's own and every course's. */
async function allNamespaces() {
  const { courses } = await loadCourses();
  return [APP_NS, ...courses.filter((c) => c.status === 'available').map((c) => c.id)];
}

async function readNamespace(ns) {
  const out = {};
  for (const s of STORES) out[s] = Object.fromEntries(await store.entries(s, ns));
  return out;
}

const isEmpty = (data) => STORES.every((s) => !Object.keys(data[s] || {}).length);

/** Everything, as one backup object. Namespaces with nothing in them are left out. */
export async function exportAll() {
  const namespaces = {};
  for (const ns of await allNamespaces()) {
    const data = await readNamespace(ns);
    if (!isEmpty(data)) namespaces[ns] = data;
  }
  return { format: FORMAT, version: VERSION, app: 'Wayword', exportedAt: new Date().toISOString(), namespaces };
}

/** The file name a backup is saved under: wayword-backup-2026-10-09.json */
export const fileName = (backup) => `wayword-backup-${String(backup.exportedAt).slice(0, 10)}.json`;

const NS_NAME = /^(app|[a-z]{2}-[a-z]{2})$/;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Is this a backup this version can restore? { ok: true } or { ok: false,
 * reason: 'notBackup' | 'newer' } — checked before anything is touched.
 */
export function validateBackup(data) {
  if (!isPlain(data) || data.format !== FORMAT) return { ok: false, reason: 'notBackup' };
  if (typeof data.version !== 'number') return { ok: false, reason: 'notBackup' };
  if (data.version > VERSION) return { ok: false, reason: 'newer' };
  if (!isPlain(data.namespaces) || !Object.keys(data.namespaces).length) return { ok: false, reason: 'notBackup' };
  for (const [ns, stores] of Object.entries(data.namespaces)) {
    if (!NS_NAME.test(ns) || !isPlain(stores)) return { ok: false, reason: 'notBackup' };
    for (const s of STORES) if (stores[s] !== undefined && !isPlain(stores[s])) return { ok: false, reason: 'notBackup' };
    for (const card of Object.values(stores.srs || {})) {
      if (!isPlain(card) || typeof card.id !== 'string') return { ok: false, reason: 'notBackup' };
    }
  }
  return { ok: true };
}

/** Per course in a backup: how many cards, how many of your own words. For the restore prompt. */
export function summarise(data) {
  return Object.entries(data.namespaces)
    .filter(([ns]) => ns !== APP_NS)
    .map(([ns, stores]) => ({
      course: ns,
      cards: Object.keys(stores.srs || {}).length,
      mine: (stores.meta?.userItems || []).length,
    }));
}

/**
 * Restore a (validated) backup: each namespace it holds is cleared and
 * rewritten exactly as backed up; namespaces it doesn't hold are untouched.
 * Unless told not to, what is about to be replaced is saved first, so the
 * restore can be undone.
 */
export async function importBackup(data, { keepUndo = true } = {}) {
  const names = Object.keys(data.namespaces);
  if (keepUndo) {
    const before = {};
    for (const ns of names) before[ns] = await readNamespace(ns);
    await store.set('meta', 'beforeRestore', {
      at: Date.now(),
      restored: data.exportedAt || null,
      data: { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), namespaces: before },
    }, UNDO_NS);
  }
  for (const ns of names) {
    await store.clearAll(ns);
    for (const s of STORES) {
      const entries = Object.entries(data.namespaces[ns][s] || {});
      if (entries.length) await store.setMany(s, entries, ns);
    }
  }
  return names;
}

/** The undo for the last restore, if there is one: { at, restored }. */
export async function undoInfo() {
  const saved = await store.get('meta', 'beforeRestore', UNDO_NS);
  return saved ? { at: saved.at, restored: saved.restored } : null;
}

/** Put back what the last restore replaced. */
export async function undoRestore() {
  const saved = await store.get('meta', 'beforeRestore', UNDO_NS);
  if (!saved) return false;
  await importBackup(saved.data, { keepUndo: false });
  await store.del('meta', 'beforeRestore', UNDO_NS);
  return true;
}

/** Read a chosen file as text, in browsers old and new. */
export function readFile(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
