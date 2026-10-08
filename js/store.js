/**
 * store.js — persistence layer.
 *
 * IndexedDB with a transparent localStorage fallback (private browsing, or
 * any environment where IDB is blocked). Everything is a simple key/value
 * get/set/getAll over two logical stores: `srs` and `meta`.
 *
 * Storage is split into namespaces, one per course plus `app` for
 * course-independent preferences. Each namespace is its own IndexedDB
 * database (and its own localStorage prefix), so two courses can share card
 * ids without colliding and resetting one course can never touch another.
 * Every call works on the current namespace unless one is passed explicitly.
 *
 * All state is client-side. Nothing here ever touches the network (README §8).
 */

const DB_VERSION = 1;
const STORES = ['srs', 'meta'];

/**
 * The English → Japanese course deliberately keeps the pre-rename database
 * name (the app was "Nihongo Tabi") and the `nt:` localStorage prefix. The
 * github.io origin is the same before and after the move, so renaming either
 * would orphan existing SRS progress rather than carry it over.
 */
const NAMES = {
  'en-ja': { db: 'nihongo-tabi', ls: 'nt' },
  app: { db: 'wayword', ls: 'ww' },
};
const namesFor = (ns) => NAMES[ns] || { db: `wayword-${ns}`, ls: `ww-${ns}` };

let current = 'en-ja';
const dbPromises = new Map();
const fallbackFor = new Set(); // namespaces that ended up on localStorage

/** Point every un-namespaced call at a course's storage. */
export function useNamespace(ns) {
  current = ns;
}

export function namespace() {
  return current;
}

function openDB(ns) {
  if (dbPromises.has(ns)) return dbPromises.get(ns);

  const promise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      fallbackFor.add(ns);
      return resolve(null);
    }
    let settled = false;
    // Safari/private-mode can hang the open request rather than erroring.
    const bail = setTimeout(() => {
      if (!settled) { settled = true; fallbackFor.add(ns); resolve(null); }
    }, 2000);

    const req = indexedDB.open(namesFor(ns).db, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      if (settled) return;
      settled = true; clearTimeout(bail); resolve(req.result);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true; clearTimeout(bail); fallbackFor.add(ns); resolve(null);
    };
  });

  dbPromises.set(ns, promise);
  return promise;
}

/* ---------- localStorage fallback ---------- */

const lsKey = (ns, store, key) => `${namesFor(ns).ls}:${store}:${key}`;

const fallback = {
  get(ns, store, key) {
    const raw = localStorage.getItem(lsKey(ns, store, key));
    return raw === null ? undefined : JSON.parse(raw);
  },
  set(ns, store, key, value) {
    localStorage.setItem(lsKey(ns, store, key), JSON.stringify(value));
  },
  del(ns, store, key) {
    localStorage.removeItem(lsKey(ns, store, key));
  },
  getAll(ns, store) {
    const prefix = lsKey(ns, store, '');
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(JSON.parse(localStorage.getItem(k)));
    }
    return out;
  },
  clear(ns, store) {
    const prefix = lsKey(ns, store, '');
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  },
};

/* ---------- public API ---------- */

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.onerror = () => reject(t.error);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      t.oncomplete = () => resolve();
    }
  });
}

export async function get(store, key, ns = current) {
  const db = await openDB(ns);
  if (!db || fallbackFor.has(ns)) return fallback.get(ns, store, key);
  try { return await tx(db, store, 'readonly', (s) => s.get(key)); }
  catch { return fallback.get(ns, store, key); }
}

export async function set(store, key, value, ns = current) {
  const db = await openDB(ns);
  if (!db || fallbackFor.has(ns)) return fallback.set(ns, store, key, value);
  try { return await tx(db, store, 'readwrite', (s) => s.put(value, key)); }
  catch { return fallback.set(ns, store, key, value); }
}

export async function del(store, key, ns = current) {
  const db = await openDB(ns);
  if (!db || fallbackFor.has(ns)) return fallback.del(ns, store, key);
  try { return await tx(db, store, 'readwrite', (s) => s.delete(key)); }
  catch { return fallback.del(ns, store, key); }
}

export async function getAll(store, ns = current) {
  const db = await openDB(ns);
  if (!db || fallbackFor.has(ns)) return fallback.getAll(ns, store);
  try { return await tx(db, store, 'readonly', (s) => s.getAll()); }
  catch { return fallback.getAll(ns, store); }
}

export async function setMany(store, entries, ns = current) {
  // entries: [[key, value], ...]
  const db = await openDB(ns);
  if (!db || fallbackFor.has(ns)) {
    entries.forEach(([k, v]) => fallback.set(ns, store, k, v));
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      entries.forEach(([k, v]) => os.put(v, k));
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } catch {
    entries.forEach(([k, v]) => fallback.set(ns, store, k, v));
  }
}

/** Wipes one namespace — a course reset never reaches another course. */
export async function clearAll(ns = current) {
  const db = await openDB(ns);
  if (db && !fallbackFor.has(ns)) {
    for (const s of STORES) {
      try { await tx(db, s, 'readwrite', (os) => os.clear()); } catch { /* fall through */ }
    }
  }
  STORES.forEach((s) => fallback.clear(ns, s));
}

export function backend(ns = current) {
  return fallbackFor.has(ns) ? 'localStorage' : 'IndexedDB';
}
