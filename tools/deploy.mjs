/**
 * deploy.mjs — publish the site: `npm run deploy`.
 *
 * GitHub Pages serves this repository straight from `main` (ASSUMPTIONS A31),
 * so deploying *is* pushing main. This makes that one safe command:
 *
 *   1. preflight — on main, nothing uncommitted, not behind origin
 *   2. the test suites — content, integration, render, service worker and voice
 *   3. git push origin main
 *   4. wait until the live site serves this build's service worker, then
 *      print the URL
 *
 *   npm run deploy                 # all of the above
 *   npm run deploy -- --dry-run    # preflight and tests only: no push, no wait
 *   DEPLOY_GIT_USER=<account> npm run deploy   # push as this GitHub account
 *                                              # (default: the repository's owner)
 *
 * It used to force-push a separate gh-pages branch, which GitHub Pages never
 * served once the site moved to main/root — "deploying" changed nothing.
 *
 * Every git and node call passes its arguments as an array, never through a
 * shell, so paths with spaces (D:\Remote work\…) need no quoting.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');
const WAIT_MS = 10 * 60 * 1000;

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

/* ---------- 1. preflight ---------- */

let remote;
try {
  remote = git('remote', 'get-url', 'origin');
} catch {
  fail('No git remote named "origin", so there is nowhere to deploy.',
    'git remote add origin https://github.com/<you>/Wayword.git');
}
const repo = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
const liveUrl = repo ? `https://${repo[1].toLowerCase()}.github.io/${repo[2]}/` : null;

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`On branch "${branch}". GitHub Pages serves main — merge into main first.`);

const dirty = git('status', '--porcelain');
if (dirty) {
  fail('Uncommitted changes — commit them first, so what goes live is exactly what is in git.',
    dirty.split('\n').map((l) => `    ${l}`).join('\n'));
}

console.log(`Fetching ${remote}…`);
git('fetch', 'origin', 'main');
const behind = Number(git('rev-list', '--count', 'HEAD..origin/main'));
if (behind) fail(`main is ${behind} commit(s) behind origin/main.`, 'git pull --ff-only, then deploy again.');
const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));

/* ---------- 2. tests ---------- */

const suites = ['tools/selftest.mjs', 'tools/integration-test.mjs', 'tools/language-pack-test.mjs', 'tools/render-test.mjs', 'tools/sw-test.mjs', 'tools/voice-test.mjs'];
for (const suite of suites) {
  process.stdout.write(`— ${suite} … `);
  try {
    execFileSync(process.execPath, [resolve(ROOT, suite)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('passed');
  } catch (err) {
    console.log('FAILED');
    const lines = String(err.stdout || '').split('\n').filter((l) => l.includes('✗')).slice(0, 20);
    fail(`${suite} failed — nothing was pushed.`, lines.join('\n'));
  }
}

/* ---------- 3. push ---------- */

const local = readFileSync(resolve(ROOT, 'sw.js'), 'utf8').match(/CACHE_VERSION = '([^']+)'/)?.[1];

if (DRY_RUN) {
  console.log(`\n✓ Dry run: preflight and tests pass. ${ahead} commit(s) would be pushed; nothing was.`);
  process.exit(0);
}

if (ahead) {
  console.log(`\nPushing ${ahead} commit(s) to origin/main…`);
  // Git Credential Manager asks which account to use when it holds more than
  // one GitHub account — and fails outright where it can't ask. So name the
  // account up front: DEPLOY_GIT_USER, else git's own credential.username,
  // else the repository's owner. `-c` applies it to this push only.
  let configured = '';
  try { configured = git('config', '--get', 'credential.username'); } catch { /* not set */ }
  const account = process.env.DEPLOY_GIT_USER || configured || repo?.[1];
  const args = [...(account ? ['-c', `credential.username=${account}`] : []), 'push', 'origin', 'main'];
  try {
    // Inherit stdio: if Git Credential Manager needs a sign-in, its prompt must be visible.
    execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });
  } catch {
    fail(`git push failed${account ? ` as ${account}` : ''} — nothing was deployed.`,
      'If Git Credential Manager signs in to several GitHub accounts, set DEPLOY_GIT_USER to the one\n' +
      'that can push to this repository and deploy again — or push yourself: git push origin main');
  }
} else {
  console.log('\norigin/main already has this commit — checking the live site.');
}

/* ---------- 4. wait for the live site ---------- */

if (!liveUrl || !local) {
  console.log('\n✓ Pushed. (Could not work out the GitHub Pages URL to confirm it is live.)');
  process.exit(0);
}

console.log(`Waiting for ${liveUrl} to serve service worker ${local}…`);
const started = Date.now();
for (;;) {
  const live = await fetch(`${liveUrl}sw.js?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : ''))
    .then((t) => t.match(/CACHE_VERSION = '([^']+)'/)?.[1])
    .catch(() => null);
  if (live === local) {
    console.log(`\n✓ Live in ${Math.round((Date.now() - started) / 1000)}s: ${liveUrl}\n`);
    break;
  }
  if (Date.now() - started > WAIT_MS) {
    fail(`The push went through, but after 10 minutes ${liveUrl} still serves ${live ?? 'nothing'} (expected ${local}).`,
      `Check the Pages build: https://github.com/${repo[1]}/${repo[2]}/actions`);
  }
  await new Promise((r) => setTimeout(r, 10000));
}
