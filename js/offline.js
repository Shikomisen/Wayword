/**
 * offline.js — keeping the courses this device uses available offline
 * (README §5).
 *
 * The service worker caches the app itself on install, and a course — its
 * content and every clip — once it's opened here. Entering a course asks the
 * worker to keep it; at launch the app also asks for every course started on
 * this device, so one the browser evicted comes back, and the worker's next
 * version knows which courses to download before it takes over.
 *
 * Both calls resolve to null when there's no worker to ask (plain http, an
 * old browser, the tests), and never reject: offline support is a bonus on
 * top of the app working, not something the app waits on.
 */

// A whole course on a slow phone connection takes a while.
const KEEP_TIMEOUT = 10 * 60 * 1000;
const STATUS_TIMEOUT = 15 * 1000;

/** Send the worker a message and wait for its answer on a port of our own. */
function ask(message, timeout) {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
  if (!sw?.ready || typeof MessageChannel !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    // The clock includes waiting for a worker at all: `ready` never settles
    // if registration failed.
    const timer = setTimeout(() => resolve(null), timeout);
    const done = (answer) => { clearTimeout(timer); resolve(answer ?? null); };
    sw.ready.then((reg) => {
      if (!reg?.active) return done(null);
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = (e) => done(e.data);
      reg.active.postMessage(message, [port2]);
    }, () => done(null));
  });
}

/**
 * Download whatever of these courses isn't cached yet, and remember them.
 * Resolves once done: { courses: [{ course, total, added, missing }] }.
 */
export const keepOffline = (courses) => ask({ type: 'keep-courses', courses }, KEEP_TIMEOUT);

/** How much of a course is on this device: { cached, total, kept, downloading }. */
export const offlineStatus = (course) => ask({ type: 'course-status', course }, STATUS_TIMEOUT);
