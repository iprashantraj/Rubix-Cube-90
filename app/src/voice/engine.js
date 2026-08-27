import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

/**
 * The speech engine. Spec §6.7, design law rule 2: every screen speaks on entry, and for
 * a user who cannot read a silent screen is a blank screen. So this file's only real job
 * is to never go quiet without saying why.
 *
 * Three tiers, tried in order, each reporting its own failure:
 *
 *   1. Server Bhashini  — best Indian-language and dialect coverage, so it goes first.
 *                         Clips are cached by (lang, text) because the prompt set is tiny
 *                         and repetitive — the camera gate says the same seven sentences
 *                         forever — so the hit rate approaches 1 within minutes.
 *   2. Native Capacitor — the Android system TTS engine. This is the tier that actually
 *                         talks on the artisan's phone. Needs the <queries> block in
 *                         AndroidManifest.xml or Android 11+ package visibility hides the
 *                         engine and the plugin fails silently.
 *   3. Web Speech       — laptop and dev fallback only. In the Capacitor WebView
 *                         `speechSynthesis` exists but has no engine bound to it, so it
 *                         is a silent no-op there. That is why it is last, not first.
 *
 * Every tier failure is warned in dev. The previous version swallowed all three failures
 * and produced zero diagnostics, which is the only reason the feature looked unbuilt.
 */

const DEV = import.meta.env?.DEV ?? false;

function warn(tier, err) {
  if (DEV) console.warn(`[voice] tier "${tier}" failed:`, err?.message ?? err);
}

// i18n/index.js imports JSON modules and api/client.js reads import.meta.env at module
// scope. Both are Vite-only, so they are imported at the point of use rather than at the
// top — that is what lets `node src/voice/engine.js` run the self-check at the bottom.

// -- cancellation ------------------------------------------------------------
// A generation counter, not a boolean. Every speak() and every shutUp() bumps it; an
// in-flight tier compares the generation it started under before it makes any sound.
// Without this, a fetch started on one screen resolves and plays over the next screen's
// prompt, and two voices at once is worse than silence.

let generation = 0;

/** True if a newer speak() or a shutUp() has superseded the call that owns `gen`. */
export function superseded(gen) {
  return gen !== generation;
}

/** Halts whatever is currently making noise. Replaced by each tier while it plays. */
let stopCurrent = () => {};

function stopPlayback() {
  const stop = stopCurrent;
  stopCurrent = () => {};
  stop();
}

/** Stop whatever is playing, and make sure nothing in flight starts. */
export function shutUp() {
  generation++;
  stopPlayback();
}

// -- audio unlock ------------------------------------------------------------
// Chrome and iOS both refuse to make sound before a user gesture, and /lang speaks on
// mount — pre-gesture, every time. So we prime the audio path on the first pointerdown
// and hold the prompt until then.

// Native starts unlocked: Android's TTS service has no gesture requirement, and Capacitor
// turns off mediaPlaybackRequiresUserGesture in its WebView. Holding the first prompt on
// a phone would leave /lang silent for someone who has no way to read "tap to begin" —
// the precise failure this file exists to remove.
let unlocked = Capacitor.isNativePlatform();
let audioCtx = null;
let pending = null; // most recent prompt only; stale ones must not pile up
const unlockListeners = new Set();

export function isUnlocked() {
  return unlocked;
}

/** Subscribe to the unlock. Lets a screen render a "tap to begin" affordance. */
export function onUnlock(fn) {
  unlockListeners.add(fn);
  return () => unlockListeners.delete(fn);
}

/**
 * Prime the audio path. Must be called from inside a user gesture.
 *
 * Order matters: the zero-length utterance goes first and synchronously, because awaiting
 * the AudioContext resume first would spend the gesture's user-activation window before
 * speechSynthesis ever sees it.
 */
export async function unlockAudio() {
  if (unlocked) return;
  unlocked = true;

  if (typeof window !== 'undefined') {
    try {
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(''));
    } catch (e) {
      warn('unlock:speech-synthesis', e);
    }
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (Ctx) {
        audioCtx ??= new Ctx();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
      }
    } catch (e) {
      warn('unlock:audio-context', e);
    }
  }

  for (const fn of unlockListeners) fn(true);

  const held = pending;
  pending = null;
  if (held) await speak(held.text, held.lang, held.tiers);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
}

// -- tier 1: server Bhashini -------------------------------------------------

const clips = new Map();

// A 503 means the server told us it has no Bhashini key — that is a standing answer, not
// a blip, so stop paying a network round trip for it on every single prompt. Network
// errors do NOT trip this: those come back.
let serverUnavailable = false;

/** Turn one /tts response into a verdict for this tier. */
function checkTtsResponse(status, ok) {
  if (status === 503) {
    serverUnavailable = true;
    throw new Error('server tts unavailable (503) — no Bhashini key configured');
  }
  if (!ok) throw new Error(`server tts http ${status}`);
}

async function fetchClip(text, lang) {
  const key = `${lang}:${text}`;
  const hit = clips.get(key);
  if (hit) return hit;

  // Always via apiUrl(): on a device Capacitor serves from https://localhost and a bare
  // '/api/...' resolves into the bundled assets instead of the server.
  const { apiUrl } = await import('../api/client');
  const res = await fetch(apiUrl('/tts'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang }),
    // A hung request is a silent screen, which is the failure we are here to kill.
    signal: AbortSignal.timeout?.(8000),
  });
  checkTtsResponse(res.status, res.ok);

  const url = URL.createObjectURL(await res.blob());
  clips.set(key, url);
  return url;
}

const SERVER = {
  name: 'server-bhashini',
  available: () => !serverUnavailable && typeof fetch === 'function',
  async play(text, lang, gen) {
    const url = await fetchClip(text, lang);
    if (superseded(gen)) return;
    await new Promise((resolve, reject) => {
      const audio = new Audio(url);
      stopCurrent = () => {
        audio.pause();
        resolve();
      };
      audio.onended = resolve;
      audio.onerror = () => reject(new Error('clip playback failed'));
      audio.play().catch(reject);
    });
  },
};

// -- tier 2: native Capacitor TTS --------------------------------------------

const NATIVE = {
  name: 'capacitor-native',
  available: () => Capacitor.isNativePlatform(),
  async play(text, lang, gen) {
    // ttsTag, not bcp47: the tag to SPEAK a language with is not always the tag to write it
    // with. English is written en-IN and spoken en-GB — see the note in i18n/index.js.
    const { ttsTag } = await import('../i18n/index');
    if (superseded(gen)) return;
    stopCurrent = () => TextToSpeech.stop().catch(() => {});
    // rate 0.9: these are instructions, not narration.
    await TextToSpeech.speak({ text, lang: ttsTag(lang), rate: 0.9 });
  },
};

// -- tier 3: Web Speech ------------------------------------------------------

// getVoices() returns [] until the engine has enumerated, so setting lang='hi-IN' on a
// cold start matches nothing. Wait for voiceschanged, but only briefly — some engines
// never fire it and we would rather speak in the default voice than not at all.
let voicesPromise = null;

function getVoices(synth) {
  voicesPromise ??= new Promise((resolve) => {
    const ready = synth.getVoices();
    if (ready.length) return resolve(ready);
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, 1500);
    synth.addEventListener('voiceschanged', done);
  });
  return voicesPromise;
}

function pickVoice(voices, tag) {
  const prefix = tag.split('-')[0];
  return (
    voices.find((v) => v.lang === tag) ??
    voices.find((v) => v.lang?.replace('_', '-').startsWith(prefix)) ??
    null
  );
}

const WEB = {
  name: 'web-speech',
  available: () => typeof window !== 'undefined' && !!window.speechSynthesis,
  async play(text, lang, gen) {
    const synth = window.speechSynthesis;
    const { ttsTag } = await import('../i18n/index');
    const voices = await getVoices(synth);
    if (superseded(gen)) return;

    const tag = ttsTag(lang);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = tag;
    u.rate = 0.9;
    const voice = pickVoice(voices, tag);
    if (voice) u.voice = voice;
    else if (DEV) console.warn(`[voice] no installed voice for ${tag}; using default`);

    await new Promise((resolve, reject) => {
      // Watchdog. A blocked or engine-less speechSynthesis sometimes fires neither `end`
      // nor `error`, and a promise that never settles is a screen that hangs mid-flow.
      // ponytail: 90ms/char is a rough speaking rate — widen if long prompts get cut.
      const timer = setTimeout(resolve, 2000 + text.length * 90);
      const settle = (fn) => (arg) => {
        clearTimeout(timer);
        fn(arg);
      };
      const finish = settle(resolve);
      stopCurrent = () => {
        synth.cancel();
        finish();
      };
      u.onend = finish;
      u.onerror = settle((e) => reject(new Error(`speechSynthesis: ${e?.error ?? 'error'}`)));
      synth.cancel(); // Chrome queues rather than replaces, and stale queues stack up.
      synth.speak(u);
    });
  },
};

const TIERS = [SERVER, NATIVE, WEB];

// -- the ladder --------------------------------------------------------------

/**
 * Speak a resolved string. Interrupts anything already playing.
 * Never throws — a TTS failure must not take a screen down with it.
 *
 * `tiers` is injectable for the self-check below; nothing in the app passes it.
 */
export async function speak(text, lang, tiers = TIERS) {
  if (!text) return;
  const gen = ++generation;
  stopPlayback();

  if (!unlocked) {
    // Hold the newest prompt only. Flushing a backlog on unlock would replay a queue of
    // prompts for screens the artisan already left.
    pending = { text, lang, tiers };
    return;
  }

  for (const tier of tiers) {
    if (superseded(gen)) return;
    if (!tier.available()) continue;
    try {
      await tier.play(text, lang, gen);
      return;
    } catch (e) {
      warn(tier.name, e);
    }
  }
  if (superseded(gen)) return;
  if (DEV) console.warn('[voice] every tier failed; screen is silent:', text);
}

/**
 * Warm the cache for strings a screen is about to need, so the first play is instant.
 * Fire and forget, and server-only — the other two tiers have nothing to prefetch.
 */
export function prefetch(texts, lang) {
  if (!SERVER.available()) return;
  for (const text of texts) fetchClip(text, lang).catch(() => {});
}

// ---------------------------------------------------------------------------
// Self-check: node src/voice/engine.js
// ---------------------------------------------------------------------------

async function demo() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error('FAIL: ' + msg);
    console.log('  ok  ' + msg);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const log = [];
  const tier = (name, { fail = false, ms = 0, up = true } = {}) => ({
    name,
    available: () => up,
    async play(text, lang, gen) {
      if (ms) await sleep(ms);
      if (fail) throw new Error(name + ' refused');
      if (superseded(gen)) return; // exactly what the server tier does after its fetch
      log.push(name);
    },
  });

  console.log('voice engine');

  // Pre-gesture, nothing may play — Chrome would block it and /lang speaks on mount.
  assert(!isUnlocked(), 'starts locked');
  await speak('first', 'hi', [tier('A')]);
  await speak('second', 'hi', [tier('B')]);
  assert(log.length === 0, 'speech before the first gesture is held, not played');

  // ...and only the newest prompt survives the wait.
  let notified = false;
  onUnlock(() => (notified = true));
  await unlockAudio();
  assert(log.join() === 'B', 'unlock flushes only the most recent held prompt');
  assert(notified && isUnlocked(), 'unlock notifies subscribers');

  // The ladder walks in order and falls through on failure, never silently.
  log.length = 0;
  await speak('x', 'hi', [tier('server', { fail: true }), tier('native'), tier('web')]);
  assert(log.join() === 'native', 'a failed tier falls through to the next one');

  log.length = 0;
  await speak('x', 'hi', [tier('server', { up: false }), tier('native')]);
  assert(log.join() === 'native', 'an unavailable tier is skipped without being tried');

  log.length = 0;
  await speak('x', 'hi', [tier('server'), tier('native')]);
  assert(log.join() === 'server', 'the first working tier wins; later tiers never run');

  log.length = 0;
  await speak('x', 'hi', [tier('a', { fail: true }), tier('b', { fail: true })]);
  assert(log.length === 0, 'all tiers failing is survivable — speak() never throws');

  // Cancellation: the whole reason for the generation counter.
  log.length = 0;
  const inFlight = speak('slow', 'hi', [tier('server', { ms: 20 })]);
  shutUp();
  await inFlight;
  await sleep(40);
  assert(log.length === 0, 'shutUp() stops an in-flight clip from ever playing');

  log.length = 0;
  const stale = speak('old screen', 'hi', [tier('slow', { ms: 20 })]);
  await speak('new screen', 'hi', [tier('fast')]);
  await stale;
  await sleep(40);
  assert(log.join() === 'fast', 'a superseded speak() never plays over the newer one');

  // The live path today: no Bhashini key, so /api/tts answers 503 forever. One round
  // trip is enough to learn that; every later prompt must skip straight to tier 2.
  assert(SERVER.available(), 'server tier starts available');
  let threw = false;
  try {
    checkTtsResponse(503, false);
  } catch {
    threw = true;
  }
  assert(threw, '503 is reported as a failure, not swallowed');
  assert(!SERVER.available(), 'after a 503 the server tier stops costing a round trip');

  console.log('all passed');
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('engine.js')) demo();
