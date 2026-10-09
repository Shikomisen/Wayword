/**
 * sw.js — offline-first service worker (README §5).
 *
 * Precaches the app shell on install, then walks content/courses.json and
 * every course manifest it lists to cache each category file, scenario file
 * and audio clip. That means adding a category — or a whole course — needs
 * no service-worker edit: bump CACHE_VERSION and the new content is picked
 * up on the next install.
 *
 * Strategy:
 *   - navigations      -> network-first, falling back to the cached shell
 *   - everything else  -> cache-first (content and audio never change
 *                         under a given cache version)
 */

const CACHE_VERSION = 'v6';
const CACHE_PREFIX = 'wayword-';
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;

// Every prefix this app has cached under, including the pre-rename
// `nihongo-tabi-`. Activation only deletes stale caches with these prefixes:
// the github.io origin is shared with other projects, so nothing else on it
// is ours to remove.
const OWN_PREFIXES = [CACHE_PREFIX, 'nihongo-tabi-'];

const SHELL = [
  './',
  './index.html',
  './app.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/audio.js',
  './js/connectors.js',
  './js/content.js',
  './js/course.js',
  './js/deck.js',
  './js/drills.js',
  './js/home.js',
  './js/i18n.js',
  './js/mine.js',
  './js/quiz.js',
  './js/characters.js',
  './js/render.js',
  './js/ruby.js',
  './js/scenario.js',
  './js/shared.js',
  './js/srs.js',
  './js/store.js',
  './js/study.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png',
];

const fetchJSON = (f) =>
  fetch(`./${f}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// Every list a course manifest can declare; each entry names a content file.
const MANIFEST_LISTS = ['categories', 'decks', 'lessons', 'characterSets', 'scenarios'];

/**
 * Every clip a content file declares, wherever it sits: phrases, a casual
 * phrase's polite version, words, sentences, lesson examples, characters,
 * scenario lines — anything with an `audio` path. Walking the whole file
 * means a new kind of content needs no service-worker edit.
 */
function audioIn(node, out) {
  if (Array.isArray(node)) node.forEach((n) => audioIn(n, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'audio' && typeof value === 'string') out.push(`./${value}`);
      else audioIn(value, out);
    }
  }
  return out;
}

/** Expand one course manifest into every file and clip it references. */
async function manifestAssets(manifestPath) {
  const assets = [`./${manifestPath}`];
  const manifest = await fetchJSON(manifestPath);
  if (!manifest) throw new Error(`could not read ${manifestPath}`);

  const files = MANIFEST_LISTS.flatMap((list) => (manifest[list] || []).map((entry) => entry.file)).filter(Boolean);
  assets.push(...files.map((f) => `./${f}`));
  for (const data of await Promise.all(files.map(fetchJSON))) audioIn(data, assets);
  return assets;
}

/** Read the course list and expand every available course into a full asset list. */
async function contentAssets() {
  const assets = ['./content/courses.json'];
  const courses = await fetchJSON('content/courses.json');
  const manifests = (courses?.courses || []).map((c) => c.manifest).filter(Boolean);

  // Interface strings, one file per language people learn *from* (English
  // is always there: it is every other dictionary's fallback).
  for (const lang of new Set(['en', ...(courses?.speakers || [])])) assets.push(`./content/ui/${lang}.json`);

  for (const path of manifests) {
    try {
      assets.push(...(await manifestAssets(path)));
    } catch (err) {
      // Offline on first install, or a malformed manifest. The shell still
      // works; content fills in on a later visit. One broken course must not
      // stop the others from being cached.
      console.warn('[sw] could not expand content manifest', path, err);
    }
  }
  return [...new Set(assets)];
}

/** addAll() rejects the whole batch if any single request 404s. */
async function cacheAllTolerant(cache, urls) {
  await Promise.all(
    urls.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {
        /* a missing clip must not fail the install */
      })
    )
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cacheAllTolerant(cache, SHELL);
      await cacheAllTolerant(cache, await contentAssets());
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((k) => k !== CACHE && OWN_PREFIXES.some((p) => k.startsWith(p)))
        .map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (await caches.match('./index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline and not cached' });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
