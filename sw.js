/**
 * sw.js — offline-first service worker (README §5).
 *
 * Installing caches the app itself — the shell, the course list and the
 * interface strings, about forty files — and takes over straight away. That
 * has to be quick: a phone that closes the app mid-install throws the install
 * away, so a long one may never finish.
 *
 * Courses come after. The app tells the worker which courses it uses (a
 * 'keep-courses' message). The worker remembers them and downloads whatever
 * of them this version hasn't cached yet, walking each course's manifest to
 * its category, deck, lesson, listening and scenario files and the clips they
 * name. Interrupted, it picks up where it stopped next time.
 *
 * Until a new version has every course this device keeps, the previous
 * version's cache stays as the offline fallback, so an update never takes
 * offline away. Once they're all in, it goes.
 *
 * Adding a category — or a whole course — needs no service-worker edit: bump
 * CACHE_VERSION (and VERSION in js/version.js) and it's picked up.
 *
 * Strategy:
 *   - navigations      -> network-first, falling back to the cached shell
 *   - everything else  -> this version's cache, then the network (cached as it
 *                         comes), then — offline — an older version's copy
 */

const CACHE_VERSION = 'v14';
const CACHE_PREFIX = 'wayword-';
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;

// The courses this device keeps offline. Deliberately not versioned: it
// outlives each version's cache, so the next version knows what to download.
const KEPT = `${CACHE_PREFIX}kept`;
const KEPT_LIST = './__kept-courses.json';

// Every prefix this app has cached under, including the pre-rename
// `nihongo-tabi-`. Only caches with these prefixes are ever deleted: the
// github.io origin is shared with other projects, so nothing else on it is
// ours to remove.
const OWN_PREFIXES = [CACHE_PREFIX, 'nihongo-tabi-'];

// Versions before v12 can't tell the learner an update is ready — they have
// no update bar — so a page running one is reloaded into the new version.
const FIRST_WITH_UPDATE_BAR = 12;

const SHELL = [
  './',
  './index.html',
  './app.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/audio.js',
  './js/backup.js',
  './js/connectors.js',
  './js/content.js',
  './js/course.js',
  './js/deck.js',
  './js/drills.js',
  './js/home.js',
  './js/i18n.js',
  './js/kana.js',
  './js/listen-drill.js',
  './js/listening.js',
  './js/mastery.js',
  './js/mine.js',
  './js/offline.js',
  './js/quiz.js',
  './js/reading.js',
  './js/characters.js',
  './js/choice.js',
  './js/render.js',
  './js/ruby.js',
  './js/scenario.js',
  './js/shared.js',
  './js/srs.js',
  './js/store.js',
  './js/study.js',
  './js/updates.js',
  './js/version.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png',
];

/**
 * A JSON file from the network — or, given a cache, from that cache first.
 * Installing always reads the network (it's fetching a new version); keeping
 * a course reads this version's own cache, so it works offline too. A
 * dropped request is tried again: a manifest that doesn't arrive would
 * leave its whole course out.
 */
async function readJSON(f, cache = null, attempts = 3) {
  const url = `./${f}`;
  const hit = cache ? await cache.match(url) : null;
  if (hit) return hit.json().catch(() => null);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt - 1)));
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) return await res.json();
      if (res.status === 404) return null; // really not there: no point asking again
    } catch {
      // dropped: try again
    }
  }
  return null;
}

// Every list a course manifest can declare; each entry names a content file.
const MANIFEST_LISTS = ['categories', 'decks', 'lessons', 'listening', 'characterSets', 'scenarios'];

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
async function manifestAssets(manifestPath, cache = null) {
  const assets = [`./${manifestPath}`];
  const manifest = await readJSON(manifestPath, cache);
  if (!manifest) throw new Error(`could not read ${manifestPath}`);

  const files = MANIFEST_LISTS.flatMap((list) => (manifest[list] || []).map((entry) => entry.file)).filter(Boolean);
  assets.push(...files.map((f) => `./${f}`));
  for (const data of await Promise.all(files.map((f) => readJSON(f, cache)))) audioIn(data, assets);
  return [...new Set(assets)];
}

/** What every visitor gets: the course list, and the interface strings for each language people learn from. */
function baseAssets(registry) {
  const assets = ['./content/courses.json'];
  // English is always there: it is every other dictionary's fallback.
  for (const lang of new Set(['en', ...(registry?.speakers || [])])) assets.push(`./content/ui/${lang}.json`);
  return assets;
}

/* ---------- which courses this device keeps ---------- */

async function keptCourses() {
  const hit = await (await caches.open(KEPT)).match(KEPT_LIST);
  return hit ? hit.json().catch(() => null) : null;
}

// Read-modify-write, one at a time, so two messages arriving together can't
// drop a course between them.
let keptWrites = Promise.resolve();
function rememberCourses(ids) {
  keptWrites = keptWrites.then(async () => {
    const kept = (await keptCourses()) || [];
    const next = [...new Set([...kept, ...ids])];
    await (await caches.open(KEPT)).put(KEPT_LIST,
      new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } }));
  });
  return keptWrites;
}

/** Earlier versions' caches: the offline fallback while this version fills its own. */
async function olderCaches() {
  return (await caches.keys()).filter((k) => k !== CACHE && k !== KEPT && OWN_PREFIXES.some((p) => k.startsWith(p)));
}

/** A cache from a version without the update bar: pre-rename, or before v12. */
const fromBeforeUpdateBar = (name) =>
  name.startsWith('nihongo-tabi-') || Number(/^wayword-v(\d+)$/.exec(name)?.[1] ?? Infinity) < FIRST_WITH_UPDATE_BAR;

/**
 * Cache every URL not cached already, a few at a time, retrying the ones
 * that fail.
 *
 * Skipping what's there means an install or a download that was cut short
 * picks up where it stopped. addAll() would reject the whole batch if a
 * single request failed — and over hundreds of files on a phone's
 * connection, the odd one failing is normal (the first deploy of v6 lost a
 * clip exactly that way). So requests go out a dozen at a time, and failures
 * get two more tries after a pause. Anything still missing is skipped and
 * reported — the fetch handler caches it the first time it's used online.
 * Returns what couldn't be cached.
 */
async function cacheAllTolerant(cache, urls, { concurrency = 12, attempts = 3, pause = 1500 } = {}) {
  let pending = [];
  for (const url of new Set(urls)) if (!(await cache.match(url))) pending.push(url);
  for (let attempt = 1; attempt <= attempts && pending.length; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, pause * (attempt - 1)));
    const failed = [];
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        const url = pending[next++];
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch {
          failed.push(url);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    pending = failed;
  }
  if (pending.length) console.warn(`[sw] ${pending.length} file(s) could not be cached`, pending.slice(0, 10));
  return pending;
}

/* ---------- keeping a course: asked for by the app ---------- */

/** Courses that can be kept, by id → manifest path. */
async function availableCourses(cache) {
  const registry = await readJSON('content/courses.json', cache);
  return new Map((registry?.courses || []).filter((c) => c.manifest).map((c) => [c.id, c.manifest]));
}

const keeping = new Map(); // course id → its download in progress, so two asks share one

/** Download whatever of a course this version hasn't cached yet. */
function keepCourse(id, manifestPath, cache) {
  if (keeping.has(id)) return keeping.get(id);
  const work = (async () => {
    try {
      const assets = await manifestAssets(manifestPath, cache);
      const absent = [];
      for (const url of assets) if (!(await cache.match(url))) absent.push(url);
      const failed = absent.length ? await cacheAllTolerant(cache, absent) : [];
      return { course: id, total: assets.length, added: absent.length - failed.length, missing: failed.length };
    } catch (err) {
      // Offline, and this course was never downloaded: nothing to do until it's online.
      return { course: id, total: 0, added: 0, missing: 0, error: String(err?.message || err) };
    } finally {
      keeping.delete(id);
    }
  })();
  keeping.set(id, work);
  return work;
}

/**
 * Keep these courses, and every course already kept here: after an update,
 * the first ask after taking over brings all of them into this version. Once
 * they're all complete, older versions' caches have done their job as the
 * offline fallback, and go.
 */
async function keepCourses(ids) {
  const cache = await caches.open(CACHE);
  const known = await availableCourses(cache);
  const asked = [...new Set(ids)].filter((id) => known.has(id));
  await rememberCourses(asked);
  const wanted = [...new Set([...asked, ...((await keptCourses()) || [])])].filter((id) => known.has(id));
  const courses = [];
  for (const id of wanted) courses.push(await keepCourse(id, known.get(id), cache));
  if (courses.every((c) => !c.error && c.missing === 0)) {
    await Promise.all((await olderCaches()).map((k) => caches.delete(k)));
  }
  return { courses };
}

/** How much of a course this version has cached. */
async function courseStatus(id) {
  const cache = await caches.open(CACHE);
  const path = (await availableCourses(cache)).get(id);
  if (!path) return null;
  const kept = ((await keptCourses()) || []).includes(id);
  let assets;
  try {
    assets = await manifestAssets(path, cache);
  } catch {
    return { course: id, kept, cached: 0, total: 0 };
  }
  let cached = 0;
  for (const url of assets) if (await cache.match(url)) cached++;
  return { course: id, kept, cached, total: assets.length, downloading: keeping.has(id) };
}

/* ---------- lifecycle ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // The app itself, and nothing else: quick enough to finish before a
      // phone puts the app away. Courses follow once the app asks.
      const cache = await caches.open(CACHE);
      const registry = await readJSON('content/courses.json');
      await cacheAllTolerant(cache, [...SHELL, ...baseAssets(registry)]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const older = await olderCaches();
      // Older caches stay as the offline fallback until this version has the
      // courses this device keeps — unless it keeps none, so nothing to wait for.
      const kept = await keptCourses();
      if (Array.isArray(kept) && kept.length === 0) await Promise.all(older.map((k) => caches.delete(k)));
      await self.clients.claim();
      // A page from before the update bar can't say a new version is ready:
      // take it to the new version now. (Newer pages show the bar instead.)
      if (older.some(fromBeforeUpdateBar)) {
        for (const client of await self.clients.matchAll({ type: 'window' })) {
          Promise.resolve(client.navigate?.(client.url)).catch(() => {});
        }
      }
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
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch {
        // Offline, and this version hasn't got it yet: an older version's
        // copy — kept until this one has its own — beats nothing.
        return (await caches.match(request, { ignoreSearch: true })) ||
          new Response('', { status: 504, statusText: 'Offline and not cached' });
      }
    })()
  );
});

/**
 * Messages from the app. 'keep-courses' and 'course-status' answer on the
 * port the app sends along (see js/offline.js).
 */
self.addEventListener('message', (event) => {
  const { data } = event;
  if (data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  const reply = (answer) => event.ports?.[0]?.postMessage(answer);
  const answer = (work) => event.waitUntil(work.then(reply, (err) => reply({ error: String(err?.message || err) })));
  if (data?.type === 'keep-courses' && Array.isArray(data.courses)) answer(keepCourses(data.courses));
  else if (data?.type === 'course-status' && typeof data.course === 'string') answer(courseStatus(data.course));
});
