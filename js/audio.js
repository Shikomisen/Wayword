/**
 * audio.js — playback of the pre-generated, bundled clips (README §3-audio).
 *
 * This is deliberately dumb: it plays a file. There is no speechSynthesis
 * call anywhere in the app, so playback does not depend on the user's
 * device having a Japanese voice installed, and works fully offline once
 * the service worker has cached the clips.
 */

let current = null;
let unlocked = false;

/**
 * iOS/Safari refuse to play audio that wasn't started from a user gesture.
 * The first tap anywhere primes a silent element so later programmatic
 * playback (e.g. auto-play on card flip) is allowed.
 */
export function primeOnFirstGesture() {
  if (unlocked) return;
  const prime = () => {
    unlocked = true;
    document.removeEventListener('pointerdown', prime);
    document.removeEventListener('keydown', prime);
  };
  document.addEventListener('pointerdown', prime, { once: true });
  document.addEventListener('keydown', prime, { once: true });
}

// The 🐢 button's speed: slow enough to catch each word, not so slow the
// voice smears.
export const SLOW = 0.75;

/**
 * @param {string} src path to the bundled clip
 * @param {{ rate?: number }} [options] playback speed — SLOW for the 🐢 button
 * @returns {Promise<'played'|'missing'|'blocked'>}
 */
export async function play(src, { rate = 1 } = {}) {
  if (!src) return 'missing';

  if (current) {
    current.pause();
    current.currentTime = 0;
  }

  const el = new Audio(src);
  el.preload = 'auto';
  if (rate !== 1) {
    // Safari resets playbackRate to the default when the clip loads, so set both.
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
    // Slower, not lower: the same voice, just taking its time.
    el.preservesPitch = true;
    el.mozPreservesPitch = true;
    el.webkitPreservesPitch = true;
  }
  current = el;

  try {
    await el.play();
    return 'played';
  } catch (err) {
    // NotAllowedError = autoplay policy; anything else = the file isn't there.
    return err && err.name === 'NotAllowedError' ? 'blocked' : 'missing';
  }
}

export function stop() {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
}

/** True if the clip actually exists — used to grey out dead play buttons. */
export async function exists(src) {
  if (!src) return false;
  try {
    const res = await fetch(src, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------- your own words: recordings and the device voice ---------- */

/**
 * Play whatever audio an item has: a bundled clip, a recording you made
 * (fetched only when played), or the device's own voice.
 * @returns {Promise<'played'|'missing'|'blocked'>}
 */
export async function playItem(item, { rate = 1 } = {}) {
  if (!item) return 'missing';
  if (item.audio) return play(item.audio, { rate });
  if (item.audioMode === 'recording' && item.loadRecording) {
    const url = await item.loadRecording();
    return url ? play(url, { rate }) : 'missing';
  }
  if (item.audioMode === 'tts') return speak(item.kana || item.target, item.targetLang, { rate });
  return 'missing';
}

const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

/** Voices load asynchronously in most browsers; give them a moment. */
async function voices() {
  const s = synth();
  if (!s) return [];
  let list = s.getVoices();
  if (list.length) return list;
  await new Promise((resolve) => {
    const done = () => { s.removeEventListener?.('voiceschanged', done); resolve(); };
    s.addEventListener?.('voiceschanged', done);
    setTimeout(done, 1200);
  });
  return s.getVoices();
}

/**
 * An on-device voice for a language, or null. Only voices that run locally
 * are used: a network voice would send the sentence to a speech service,
 * and nothing in this app leaves the device (README §8).
 */
export async function deviceVoice(lang) {
  const all = (await voices()).filter((v) => v.lang?.toLowerCase().startsWith(lang));
  return all.find((v) => v.localService) || null;
}

/** Say a line with the device voice. 'missing' if there's no local voice for it. */
export async function speak(text, lang, { rate = 1 } = {}) {
  const s = synth();
  const voice = s ? await deviceVoice(lang) : null;
  if (!s || !voice || !text) return 'missing';
  stop();
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95 * rate;
  return new Promise((resolve) => {
    u.onend = () => resolve('played');
    u.onerror = () => resolve('missing');
    s.speak(u);
  });
}

/** Record from the microphone until stop() is called; resolves to a data: URL. */
export async function startRecording() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Recording is not supported in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  recorder.start();
  return {
    stop: () => new Promise((resolve) => {
      recorder.addEventListener('stop', () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      }, { once: true });
      recorder.stop();
    }),
  };
}

export function canRecord() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}
