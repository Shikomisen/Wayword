/**
 * updates.js — getting an installed app onto the latest version (README §5).
 *
 * The browser only looks for a new version when the app is opened afresh. A
 * phone that resumes the app from the background never does, and can sit on
 * an old version for weeks. So the app asks for a check whenever it comes back
 * to the foreground. The new service worker downloads in the background and
 * takes over by itself (sw.js skips waiting), but the screen in front of the
 * learner is still the old code until it reloads. That's when this says so:
 * a new version is ready — tap to update.
 */

let ready = false;
const listeners = new Set();

/** Has a new version taken over since this page loaded? */
export const updateReady = () => ready;

/** Call `fn` once a new version is ready (straight away, if it already is). */
export function onUpdateReady(fn) {
  listeners.add(fn);
  if (ready) fn();
  return () => listeners.delete(fn);
}

/**
 * Watch for new versions. `sw` and `doc` are the browser's own unless a test
 * passes stand-ins. A worker taking over a page that had none is a first
 * install, not an update, so that doesn't count.
 */
export function watchForUpdates(sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null,
  doc = typeof document !== 'undefined' ? document : null) {
  if (!sw?.addEventListener) return;
  let controlled = Boolean(sw.controller);
  sw.addEventListener('controllerchange', () => {
    if (controlled && !ready) {
      ready = true;
      listeners.forEach((fn) => fn());
    }
    controlled = true;
  });
  doc?.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') checkForUpdate(sw);
  });
}

/**
 * Ask the browser to look for a new version now. Resolves to:
 *   'ready'        a new version has taken over: reload to use it
 *   'downloading'  one was found, and is downloading in the background
 *   'latest'       this is the newest
 *   'offline'      couldn't reach the site to ask
 *   'unsupported'  no service worker here (plain http, an old browser):
 *                  every reload is already the latest
 */
export async function checkForUpdate(sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null) {
  if (ready) return 'ready';
  const reg = sw?.getRegistration ? await sw.getRegistration().catch(() => null) : null;
  if (!reg) return 'unsupported';
  try {
    await reg.update();
  } catch {
    return 'offline';
  }
  if (ready) return 'ready';
  return reg.installing || reg.waiting ? 'downloading' : 'latest';
}
