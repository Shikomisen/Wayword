/**
 * browser-check.mjs — the app in a real browser (Firefox), including offline.
 *
 * jsdom (render-test, sw-test) can't run a service worker or Cache Storage,
 * so this is the check that the installed app really works with no network:
 *
 *   node tools/browser-check.mjs                     # this working tree, served locally
 *   node tools/browser-check.mjs --upgrade-from origin/main
 *        # install that build first, use it, then serve this one at the same
 *        # URL — exactly what a returning user's browser goes through
 *   node tools/browser-check.mjs --live https://shikomisen.github.io/Wayword/
 *
 * Offline is real: Firefox is routed through a local proxy that drops every
 * connection (page and service worker alike), and its HTTP cache is turned
 * off, so anything that loads must have come from the service worker.
 *
 * Needs Firefox and the puppeteer-core dev dependency. Temporary profiles and
 * the --upgrade-from checkout live in tmp/ (gitignored) and are removed after.
 */

import http from 'node:http';
import net from 'node:net';
import { readFile, stat, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, 'tmp');

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const LIVE = arg('--live');
const UPGRADE_FROM = arg('--upgrade-from');

const FIREFOX = [
  process.env.FIREFOX_PATH,
  'C:/Program Files/Mozilla Firefox/firefox.exe',
  'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/usr/bin/firefox',
].find((p) => p && existsSync(p));

let puppeteer;
try {
  ({ default: puppeteer } = await import('puppeteer-core'));
} catch {
  console.log('\npuppeteer-core not installed — run npm install. Browser check SKIPPED.\n');
  process.exit(0);
}
if (!FIREFOX) {
  console.log('\nFirefox not found (set FIREFOX_PATH). Browser check SKIPPED.\n');
  process.exit(0);
}

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail !== '' && detail !== undefined ? ` — ${detail}` : ''}`);
};

/* ---------- a proxy that can drop everything ---------- */

let offline = false;
const sockets = new Set();
const track = (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); };
const proxy = http.createServer((req, res) => {
  if (offline) return req.socket.destroy();
  const u = new URL(req.url);
  const up = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search,
    method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => res.destroy());
  req.pipe(up);
});
proxy.on('connection', track);
proxy.on('connect', (req, client, head) => {
  if (offline) return client.destroy();
  const [host, port] = req.url.split(':');
  const up = net.connect(Number(port) || 443, host, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    up.write(head); up.pipe(client); client.pipe(up);
  });
  track(up);
  up.on('error', () => client.destroy());
  client.on('error', () => up.destroy());
});
const goOffline = () => { offline = true; for (const s of sockets) s.destroy(); };

/* ---------- local server: the site under /Wayword/, like GitHub Pages ---------- */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
let siteRoot = ROOT;
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/Wayword/')) {
    let file = join(siteRoot, path.slice('/Wayword/'.length));
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(body);
    } catch { /* fall through to 404 */ }
  }
  res.writeHead(404); res.end('not found');
});
server.on('connection', track);

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const proxyPort = await listen(proxy);
const base = LIVE || `http://localhost:${await listen(server)}/Wayword/`;
const newCache = `wayword-${readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/CACHE_VERSION = '([^']+)'/)[1]}`;

/* ---------- --upgrade-from: a checkout of the previous build ---------- */

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let oldTree = null;
if (UPGRADE_FROM && !LIVE) {
  oldTree = join(TMP, 'upgrade-from');
  await rm(oldTree, { recursive: true, force: true });
  try { git('worktree', 'prune'); } catch { /* nothing to prune */ }
  git('worktree', 'add', '--detach', oldTree, UPGRADE_FROM);
  siteRoot = oldTree;
}

/* ---------- browser ---------- */

await mkdir(TMP, { recursive: true });
const profile = join(TMP, `firefox-profile-${process.pid}`);
const launch = () => puppeteer.launch({
  browser: 'firefox', executablePath: FIREFOX, headless: true, userDataDir: profile,
  extraPrefsFirefox: {
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': proxyPort,
    'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': proxyPort,
    'network.proxy.no_proxies_on': '',
    'network.proxy.allow_hijacking_localhost': true, // otherwise localhost skips the proxy
    'browser.cache.disk.enable': false,              // only the SW may serve anything offline
    'browser.cache.memory.enable': false,
    'dom.serviceWorkers.enabled': true,
    'intl.accept_languages': 'en-US, en',
  },
});
// Firefox can relaunch itself on its first start after an update; one retry covers it.
const browser = await launch().catch(() => launch());
console.log(`\nBrowser: ${await browser.version()} · ${LIVE ? 'live' : 'local'} · ${base}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (page, fn, arg = null, timeout = 30000) =>
  page.waitForFunction(fn, { timeout, polling: 200 }, arg).then(() => true, () => false);
// textContent, not innerText: section titles are uppercased by CSS.
const appText = (page) => page.$eval('#app', (e) => e.textContent).catch(() => '');
const rendered = (page) => waitFor(page, () => {
  const t = document.querySelector('#app')?.textContent || '';
  return t.length > 40 && !t.includes('Loading…');
}, null, 15000);

/**
 * Navigate by hash and wait for the *new* screen. The old screen is marked
 * stale first, so a heading left over from the previous route can't pass.
 */
async function visit(page, href) {
  await page.evaluate((h) => {
    if (location.hash === h) return; // already there: the screen is current, nothing will re-render
    document.querySelector('#app')?.firstElementChild?.setAttribute('data-stale', '1');
    location.hash = h;
  }, href);
  const ok = await waitFor(page,
    () => !document.querySelector('#app [data-stale]') && Boolean(document.querySelector('#app h1')), null, 10000);
  return {
    ok,
    heading: await page.$eval('#app h1', (e) => e.textContent).catch(() => '(no heading)'),
    text: await appText(page),
  };
}

/** Enter a course from the picker; get past its placement quiz if it shows. */
async function enterCourse(page, id) {
  await page.evaluate((c) => {
    document.querySelector('#app')?.firstElementChild?.setAttribute('data-stale', '1');
    location.hash = `#/${c}/`;
  }, id);
  await waitFor(page, () => !document.querySelector('#app [data-stale]') &&
    document.querySelector('.placement-intro, .stat-row'), null, 15000);
  if (await page.$('.placement-intro')) {
    // The intro's ghost button is "skip" in every language.
    await page.evaluate(() => document.querySelector('.placement-intro .btn-ghost')?.click());
    await waitFor(page, () => document.querySelector('.stat-row'), null, 15000);
  }
  return Boolean(await page.$('.stat-row'));
}

/** Every file the service worker's own walk should precache, read from the served site. */
const expectedAssets = () => async function () {
  const j = (f) => fetch(`./${f}`, { cache: 'no-store' }).then((r) => r.json());
  const sw = await (await fetch('./sw.js', { cache: 'no-store' })).text();
  const out = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  out.push('./content/courses.json');
  const reg = await j('content/courses.json');
  for (const f of reg.ui || []) out.push(`./${f}`);
  const items = (list, key) => (list || []).flatMap((x) => x[key] || []);
  for (const c of reg.courses.filter((x) => x.manifest)) {
    const m = await j(c.manifest);
    out.push(`./${c.manifest}`);
    const decks = [...(m.categories || []), ...(m.vocab || []), ...(m.lessons || []), ...(m.characterSets || [])];
    for (const d of decks) {
      out.push(`./${d.file}`);
      const data = await j(d.file);
      const all = [...items([data], 'phrases'), ...items([data], 'words'), ...items([data], 'characters'),
        ...items([data], 'examples')];
      for (const x of all) {
        if (x.audio) out.push(`./${x.audio}`);
        if (x.politeAudio) out.push(`./${x.politeAudio}`);
      }
    }
    for (const s of m.scenarios || []) {
      out.push(`./${s.file}`);
      for (const n of Object.values((await j(s.file)).nodes || {})) if (n.audio) out.push(`./${n.audio}`);
    }
  }
  return [...new Set(out)];
};

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));

try {
  if (oldTree) {
    console.log(`\n[1] Previous build (${UPGRADE_FROM}) installed and used`);
    await page.goto(base, { waitUntil: 'load' });
    check('previous service worker takes control', await waitFor(page, () => navigator.serviceWorker.controller !== null, null, 60000));
    await waitFor(page, () => caches.keys().then((k) => k.length > 0), null, 60000);
    const oldCaches = await page.evaluate(() => caches.keys());
    check('previous build cached itself', oldCaches.length > 0, oldCaches.join(', '));
    await page.goto(`${base}#/en-ja/`, { waitUntil: 'load' });
    check('made progress in the previous build (placement done)', await enterCourse(page, 'en-ja'));

    console.log('\n[2] This build deployed to the same URL');
    siteRoot = ROOT;
    await page.goto(base, { waitUntil: 'load' });
    await rendered(page);
    const first = await appText(page);
    check('first launch after the update still renders', first.length > 40 && !/Something went wrong/.test(first),
      first.slice(0, 50));
    check(`new service worker installs ${newCache} and removes the old caches`,
      await waitFor(page, ([fresh, old]) => caches.keys().then((k) => k.includes(fresh) && old.every((o) => !k.includes(o))),
        [newCache, oldCaches.filter((c) => c !== newCache)], 120000),
      (await page.evaluate(() => caches.keys())).join(', '));
    await page.goto(base, { waitUntil: 'load' });
    await page.goto(`${base}#/en-ja/`, { waitUntil: 'load' });
    await waitFor(page, () => document.querySelector('.placement-intro, .stat-row'), null, 15000);
    check('progress survived: Japanese opens on Today, not placement',
      Boolean(await page.$('.stat-row')) && !(await page.$('.placement-intro')));
  } else {
    console.log('\n[1] Install');
    await page.goto(base, { waitUntil: 'load' });
    check('service worker takes control', await waitFor(page, () => navigator.serviceWorker.controller !== null, null, 60000));
    check('scope is exactly the app URL', (await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope))) === base);
    check(`${newCache} cache installed`, await waitFor(page, (c) => caches.keys().then((k) => k.includes(c)), newCache, 120000),
      (await page.evaluate(() => caches.keys())).join(', '));
    check('page title is Wayword', (await page.title()) === 'Wayword');
  }

  console.log('\n[3] Precache');
  await page.goto(base, { waitUntil: 'load' });
  const expected = await page.evaluate(expectedAssets());
  const missing = await page.evaluate(async (list, cacheName) => {
    const c = await caches.open(cacheName);
    const miss = [];
    for (const u of list) if (!(await c.match(new URL(u, location.href).href))) miss.push(u);
    return miss;
  }, expected, newCache);
  const audio = expected.filter((u) => u.endsWith('.mp3')).length;
  check(`${newCache} holds every asset (${expected.length}, ${audio} audio clips)`, missing.length === 0,
    missing.slice(0, 5).join(', ') || 'none missing');

  console.log('\n[4] Every course, every tab (online)');
  const courses = (await page.evaluate(() => fetch('./content/courses.json').then((r) => r.json()))).courses;
  const available = courses.filter((c) => c.status === 'available');
  const tabsByCourse = {};
  for (const c of available) {
    check(`${c.id}: enters past placement`, await enterCourse(page, c.id));
    tabsByCourse[c.id] = await page.$$eval('.tabbar a', (a) => a.map((x) => x.getAttribute('href')));
    for (const href of tabsByCourse[c.id]) {
      const v = await visit(page, href);
      check(`${href} renders`, v.ok && !/\bnull\b|undefined|Something went wrong/.test(v.text), v.heading);
    }
  }

  console.log('\n[5] Offline');
  goOffline();
  if (!LIVE) server.close();
  check('network is really down',
    (await page.evaluate(() => fetch(`https://example.com/?${Date.now()}`, { mode: 'no-cors' }).then(() => 'up', () => 'down'))) === 'down');
  await page.goto(base, { waitUntil: 'load' }).catch(() => {});
  check('cold offline launch opens the picker', await waitFor(page, () => document.querySelectorAll('.course-card').length >= 2, null, 15000));
  for (const c of available) {
    for (const href of tabsByCourse[c.id]) {
      const v = await visit(page, href);
      check(`offline ${href}`, v.ok && !/\bnull\b|undefined|Something went wrong/.test(v.text), v.heading);
    }
  }
  const results = await page.evaluate(async (list) => {
    const bad = [];
    let bytes = 0;
    for (const u of list) {
      try { const r = await fetch(u); if (!r.ok) bad.push(`${u} ${r.status}`); else bytes += (await r.arrayBuffer()).byteLength; }
      catch (e) { bad.push(`${u} ${e.message}`); }
    }
    return { bad, bytes };
  }, expected);
  check(`every asset loads offline (${expected.length} files, ${(results.bytes / 1048576).toFixed(1)} MB)`,
    results.bad.length === 0, results.bad.slice(0, 5).join(', ') || 'all 200');

  const errs = logs.filter((l) => /error|failed/i.test(l) && !/registered/.test(l));
  check('no errors logged by the app', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await browser.close().catch(() => {});
  proxy.close();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  if (oldTree) {
    try { git('worktree', 'remove', '--force', oldTree); } catch { /* best effort */ }
    try { git('worktree', 'prune'); } catch { /* best effort */ }
  }
}

console.log(failures ? `\n✗ ${failures} of ${checks} browser checks failed\n` : `\n✓ all ${checks} browser checks passed\n`);
process.exit(failures ? 1 : 0);
