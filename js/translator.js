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

/**
 * Download what's missing, checking each file before it's kept. `onProgress`
 * hears bytes done of the total. A file that doesn't arrive whole, or doesn't
 * match its checksum, stops the download with an error; what was already kept
 * stays, so trying again carries on.
 */
export async function download(files, onProgress = () => {}) {
  const cache = await caches.open(CACHE_NAME);
  const total = bytesOf(files);
  let done = 0;
  for (const f of files) {
    const url = urlOf(f.path);
    if (await cache.match(url)) { done += f.size; onProgress(done, total); continue; }
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`download failed: ${f.path} (${res.status})`);
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      got += value.byteLength;
      onProgress(done + got, total);
    }
    const buffer = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { buffer.set(c, at); at += c.byteLength; }
    if (got !== f.size || (await sha256(buffer)) !== f.sha256) throw new Error(`download damaged: ${f.path}`);
    await cache.put(url, new Response(buffer, { headers: { 'content-type': 'application/octet-stream' } }));
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
