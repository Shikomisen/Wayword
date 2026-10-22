/**
 * translator.js — the offline translator (README §2.14, §6.15).
 *
 * Mozilla's Bergamot engine and a Firefox Translations model per direction,
 * listed in mt/translator.json and served by this app's own site. They're
 * downloaded only when the learner asks, checked against their sha256, and
 * kept in a cache of their own ('wayword-translator') that outlives app
 * updates. Translating happens in a worker (translator-worker.js), on the
 * device: what's typed is never sent anywhere.
 */

export const CACHE_NAME = 'wayword-translator';

/** This course's two directions: say (speaker → target) and read (target → speaker), each null if missing. */
export function directionsFor(content) {
  const pairs = content.translator?.pairs || {};
  const { speaker, target } = content.course;
  const say = `${speaker}-${target}`;
  const read = `${target}-${speaker}`;
  return { say: pairs[say] ? say : null, read: pairs[read] ? read : null };
}

/** Every file the course's translator needs: the engine, its loader and each direction's model. */
export function filesFor(registry, pairs) {
  const files = [registry.engine.loader, registry.engine.wasm,
    ...pairs.filter(Boolean).flatMap((pair) => Object.values(registry.pairs[pair].files))];
  return [...new Map(files.map((f) => [f.path, f])).values()];
}

export const bytesOf = (files) => files.reduce((n, f) => n + f.size, 0);

/** "110 MB", in the interface's own number format. */
export function megabytes(bytes, locale) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1e6)} MB`;
}

const urlOf = (path) => new URL(path, document.baseURI).href;
const hasCaches = () => typeof caches !== 'undefined';

/** Whether this device can run it: WebAssembly with SIMD, workers and the Cache API. */
export function supported() {
  if (typeof WebAssembly !== 'object' || typeof Worker === 'undefined' || !hasCaches()) return false;
  try {
    // The smallest module that uses a SIMD instruction (i8x16.splat).
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

/** How much of it is on this device: { have, total, ready }. */
export async function status(files) {
  const total = bytesOf(files);
  if (!hasCaches()) return { have: 0, total, ready: false };
  const cache = await caches.open(CACHE_NAME);
  let have = 0;
  for (const f of files) if (await cache.match(urlOf(f.path))) have += f.size;
  return { have, total, ready: have === total };
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Why a download stopped, for the page to say: 'space', 'offline' or 'network', with the details. */
export class DownloadError extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * One file, streamed straight into the cache — never held whole in memory
 * while it downloads — then read back and checked against its sha256. A file
 * that isn't exactly right is taken out again.
 */
async function fetchInto(cache, url, file, onBytes) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    throw new DownloadError(navigator.onLine === false ? 'offline' : 'network', `${file.path}: ${err.message || err}`);
  }
  if (!res.ok || !res.body) throw new DownloadError('network', `${file.path}: HTTP ${res.status}`);
  let got = 0;
  const counted = res.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { got += chunk.byteLength; onBytes(got); controller.enqueue(chunk); },
  }));
  try {
    await cache.put(url, new Response(counted, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch (err) {
    await cache.delete(url).catch(() => {});
    if (err?.name === 'QuotaExceededError') throw new DownloadError('space', `${file.path}: ${err.message}`);
    throw new DownloadError('network', `${file.path}: stopped at ${got} of ${file.size} bytes (${err.message || err})`);
  }
  const stored = await (await cache.match(url))?.arrayBuffer();
  if (!stored || stored.byteLength !== file.size || (await sha256(stored)) !== file.sha256) {
    await cache.delete(url);
    throw new DownloadError('network', `${file.path}: arrived damaged (${stored?.byteLength ?? 0} of ${file.size} bytes)`);
  }
}

/**
 * Download what's missing. `onProgress` hears bytes done of the total. Each
 * file gets three tries; one that still fails stops the download with a
 * DownloadError, and what was already kept stays, so trying again carries on.
 */
export async function download(files, onProgress = () => {}) {
  // (Not navigator.storage.persist(): Firefox answers it with a permission
  // prompt, which would hold the download up until it's answered.)
  const cache = await caches.open(CACHE_NAME);
  const total = bytesOf(files);
  let done = 0;
  const missing = [];
  for (const f of files) {
    if (await cache.match(urlOf(f.path))) done += f.size;
    else missing.push(f);
  }
  onProgress(done, total);
  // Enough room for what's left? (An estimate: the browser may still say no.)
  try {
    const { quota, usage } = (await navigator.storage?.estimate?.()) || {};
    const need = bytesOf(missing);
    if (quota && quota - usage < need) throw new DownloadError('space', `needs ${need} bytes, ${quota - usage} free`);
  } catch (err) {
    if (err instanceof DownloadError) throw err;
  }
  for (const f of missing) {
    let failure = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await fetchInto(cache, urlOf(f.path), f, (got) => onProgress(done + got, total));
        failure = null;
        break;
      } catch (err) {
        failure = err instanceof DownloadError ? err : new DownloadError('network', `${f.path}: ${err?.message || err}`);
        if (failure.reason !== 'network') break;
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
    if (failure) throw failure;
    done += f.size;
    onProgress(done, total);
  }
}

/** Take it off this device. It can be downloaded again any time. */
export async function remove() {
  stopWorker();
  if (hasCaches()) await caches.delete(CACHE_NAME);
}

/* ---------- the worker ---------- */

let worker = null;
let nextId = 0;
const waiting = new Map();

function stopWorker() {
  worker?.terminate();
  worker = null;
  for (const [, fail] of waiting.values()) fail(new Error('stopped'));
  waiting.clear();
}

function send(message) {
  if (!worker) {
    worker = new Worker(urlOf('js/translator-worker.js'));
    worker.addEventListener('message', ({ data }) => {
      const entry = waiting.get(data.id);
      if (!entry) return;
      waiting.delete(data.id);
      if (data.ok) entry[0](data); else entry[1](new Error(data.error));
    });
    worker.addEventListener('error', () => stopWorker());
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, [resolve, reject]);
    worker.postMessage({ ...message, id });
  });
}

/** Translate text in one direction ('en-ja'…): { text, ms }. */
export function translate(registry, pair, text) {
  return send({ type: 'translate', registry, pair, text });
}

/** Load a direction's model ahead of use, so the first translation is quick. */
export function warm(registry, pair) {
  return send({ type: 'warm', registry, pair }).catch(() => {});
}

/** Japanese wants full-width ？ and ！; the models sometimes give the ASCII ones. */
export function tidy(text, lang) {
  return lang === 'ja' ? String(text).replace(/\?/g, '？').replace(/!/g, '！') : String(text);
}
