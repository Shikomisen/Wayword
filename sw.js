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

const CACHE_VERSION = 'v5';
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
  './js/content.js',
  './js/course.js',
  './js/deck.js',
  './js/home.js',
  './js/i18n.js',
  './js/quiz.js',
  './js/characters.js',
  './js/render.js',
  './js/scenario.js',
  './js/srs.js',
  './js/store.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png',
];

const fetchJSON = (f) =>
  fetch(`./${f}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** Expand one course manifest into every file and clip it references. */
async function manifestAssets(manifestPath) {
  const assets = [`./${manifestPath}`];
  const manifest = await fetchJSON(manifestPath);
  if (!manifest) throw new Error(`could not read ${manifestPath}`);

  const categoryFiles = (manifest.categories || []).map((c) => c.file);
  const characterFiles = (manifest.characterSets || []).map((s) => s.file);
  const scenarioFiles = (manifest.scenarios || []).map((s) => s.file);
  assets.push(
    ...categoryFiles.map((f) => `./${f}`),
    ...characterFiles.map((f) => `./${f}`),
    ...scenarioFiles.map((f) => `./${f}`)
  );

  // Phrase clips live inside each category file...
  for (const cat of await Promise.all(categoryFiles.map(fetchJSON))) {
    for (const p of cat?.phrases || []) if (p.audio) assets.push(`./${p.audio}`);
  }

  // ...character clips inside each character set...
  for (const set of await Promise.all(characterFiles.map(fetchJSON))) {
    for (const c of set?.characters || []) if (c.audio) assets.push(`./${c.audio}`);
  }

  // ...and NPC-line clips inside each scenario file.
  for (const sc of await Promise.all(scenarioFiles.map(fetchJSON))) {
    for (const node of Object.values(sc?.nodes || {})) {
      if (node.audio) assets.push(`./${node.audio}`);
    }
  }
  return assets;
}

/** Read the course list and expand every available course into a full asset list. */
async function contentAssets() {
  const assets = ['./content/courses.json'];
  const courses = await fetchJSON('content/courses.json');
  const manifests = (courses?.courses || []).map((c) => c.manifest).filter(Boolean);

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
