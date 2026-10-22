/**
 * translator-worker.js — the offline translator's engine, in a worker (README §6.15).
 *
 * Mozilla's Bergamot engine (WebAssembly) and a model per direction, read from
 * the cache the app filled when the translator was downloaded (js/translator.js).
 * A classic worker: the engine's loader is a plain script, which this reads
 * from the same cache and evaluates, so nothing here needs the network.
 * tools/translator-node.mjs runs this same file in Node, for the tools and tests.
 *
 *   in:  { id, type: 'translate', registry, pair, text }   registry: mt/translator.json
 *        { id, type: 'warm', registry, pair }                load a direction ahead of use
 *   out: { id, ok: true, text, ms } | { id, ok: false, error }
 */

const TRANSLATOR_CACHE = 'wayword-translator';

// Byte alignment of each file in the engine's memory, as Firefox loads them.
const ALIGN = { model: 256, lex: 64, vocab: 64, srcvocab: 64, trgvocab: 64 };

// Marian's settings, as Firefox uses them: greedy search, no quality model, soft alignment.
const CONFIG = {
  'beam-size': '1', normalize: '1.0', 'word-penalty': '0', 'max-length-break': '128', 'mini-batch-words': '1024',
  workspace: '128', 'max-length-factor': '2.0', 'skip-cost': 'true', 'cpu-threads': '0', quiet: 'true',
  'quiet-translation': 'true', alignment: 'soft',
};

let bergamot = null;
let service = null;
const models = new Map();

/** A file the app stored, by its path from the site root (mt/…). */
async function file(path) {
  const url = new URL(`../${path}`, self.location.href).href;
  const hit = await (await caches.open(TRANSLATOR_CACHE)).match(url);
  if (!hit) throw new Error(`missing ${path}`);
  return hit;
}

async function engine(registry) {
  if (bergamot) return bergamot;
  // The loader defines loadBergamot(); evaluated globally, as a script tag would.
  (0, eval)(await (await file(registry.engine.loader.path)).text());
  const wasmBinary = await (await file(registry.engine.wasm.path)).arrayBuffer();
  bergamot = await new Promise((resolve, reject) => {
    const instance = self.loadBergamot({
      // 40 MiB to start: it grows as models load (Firefox found starting small uses less).
      INITIAL_MEMORY: 41_943_040,
      print() {},
      printErr() {},
      onAbort: () => reject(new Error('engine-failed')),
      onRuntimeInitialized: async () => { await Promise.resolve(); resolve(instance); },
      wasmBinary,
    });
  });
  service = new bergamot.BlockingService({ cacheSize: 0 });
  return bergamot;
}

function aligned(type, buffer) {
  const memory = new bergamot.AlignedMemory(buffer.byteLength, ALIGN[type]);
  memory.getByteArrayView().set(new Uint8Array(buffer));
  return memory;
}

async function model(registry, pair) {
  if (models.has(pair)) return models.get(pair);
  const entry = registry.pairs[pair];
  if (!entry) throw new Error(`no model for ${pair}`);
  await engine(registry);
  const bytes = async (type) => (entry.files[type] ? (await file(entry.files[type].path)).arrayBuffer() : null);
  const vocabs = new bergamot.AlignedMemoryList();
  for (const type of entry.files.vocab ? ['vocab'] : ['srcvocab', 'trgvocab']) vocabs.push_back(aligned(type, await bytes(type)));
  const precision = entry.files.model.path.endsWith('intgemm8.bin') ? 'int8shiftAll' : 'int8shiftAlphaAll';
  const indent = '            ';
  const config = `\n${Object.entries({ ...CONFIG, 'gemm-precision': precision }).map(([k, v]) => `${indent}${k}: ${v}\n`).join('')}${indent}`;
  const [from, to] = pair.split('-');
  const loaded = new bergamot.TranslationModel(from, to, config, aligned('model', await bytes('model')),
    aligned('lex', await bytes('lex')), vocabs, null);
  models.set(pair, loaded);
  return loaded;
}

function translate(translationModel, text) {
  const messages = new bergamot.VectorString();
  const options = new bergamot.VectorResponseOptions();
  let responses = null;
  try {
    messages.push_back(text);
    options.push_back({ qualityScores: false, alignment: false, html: false });
    responses = service.translate(translationModel, messages, options);
    return responses.get(0).getTranslatedText();
  } finally {
    messages.delete();
    options.delete();
    responses?.delete();
  }
}

// One job at a time: loading a model awaits, and the engine itself is synchronous.
let queue = Promise.resolve();

self.addEventListener('message', ({ data }) => {
  const { id, type, registry, pair, text } = data || {};
  queue = queue.then(async () => {
    try {
      const translationModel = await model(registry, pair);
      if (type === 'warm') { self.postMessage({ id, ok: true, text: '', ms: 0 }); return; }
      const start = performance.now();
      const out = String(text || '').trim() ? translate(translationModel, String(text)) : '';
      self.postMessage({ id, ok: true, text: out, ms: Math.round(performance.now() - start) });
    } catch (err) {
      self.postMessage({ id, ok: false, error: String(err?.message || err) });
    }
  });
});
