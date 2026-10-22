/**
 * translator-node.mjs — runs the app's own translator worker (js/translator-worker.js)
 * in Node, for tools/make-translator.mjs and the tests. The worker reads its files
 * from the browser's Cache API; here a stand-in cache reads them from the repo.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

/** A translator over the files on disk: { translate(pair, text) → { text, ms } }. */
export function nodeTranslator(root, registry) {
  const workerUrl = pathToFileURL(resolve(root, 'js/translator-worker.js')).href;
  let onMessage = null;
  const waiting = new Map();
  const context = {
    console, performance, WebAssembly, TextDecoder, TextEncoder, URL, Response, setTimeout, clearTimeout,
    location: { href: workerUrl },
    caches: {
      open: async () => ({
        match: async (url) => {
          const path = fileURLToPath(url);
          return existsSync(path) ? new Response(readFileSync(path)) : undefined;
        },
      }),
    },
    addEventListener: (type, fn) => { if (type === 'message') onMessage = fn; },
    postMessage: (msg) => { waiting.get(msg.id)?.(msg); waiting.delete(msg.id); },
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(root, 'js/translator-worker.js'), 'utf8'), context, { filename: 'translator-worker.js' });
  let id = 0;
  const send = (data) => new Promise((done, fail) => {
    const n = ++id;
    waiting.set(n, (msg) => (msg.ok ? done(msg) : fail(new Error(msg.error))));
    onMessage({ data: { ...data, id: n, registry } });
  });
  return {
    translate: (pair, text) => send({ type: 'translate', pair, text }),
    warm: (pair) => send({ type: 'warm', pair }),
  };
}

// A sentence each way per pair, for a quick proof that the files work together.
const SAMPLES = { en: 'Where is the toilet?', ja: 'トイレはどこですか。', id: 'Di mana toiletnya?' };

export async function translatorSmokeTest(root, registry) {
  const translator = nodeTranslator(root, registry);
  const results = [];
  for (const pair of Object.keys(registry.pairs)) {
    const text = SAMPLES[pair.split('-')[0]] || 'Hello.';
    const { text: out, ms } = await translator.translate(pair, text);
    if (!out.trim()) throw new Error(`${pair}: empty translation`);
    results.push({ pair, text, out, ms });
  }
  return results;
}
