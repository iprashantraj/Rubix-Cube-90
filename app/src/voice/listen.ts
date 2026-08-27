import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Safari and older Android WebViews only expose the prefixed constructor. Not in the DOM
 * lib because it is a vendor extension, and this app runs inside a WebView where it is
 * still the fallback that matters.
 */
type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

import { apiUrl } from '../api/client';
import { close, resume, Silence, suspend } from './micLifecycle.js';
import { shutUp } from './speak';

/**
 * Voice capture for the cataloger. Spec §6.
 *
 * Records with MediaRecorder and posts the clip to the server, which runs Bhashini ASR.
 * We never do speech recognition on-device: the target phone is a 2-3GB device and the
 * whole point of §5.1 is that a cheap phone and an expensive phone must produce the same
 * result. On-device ASR would make transcription quality a function of what the artisan
 * could afford.
 */

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function pickMime() {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

/**
 * A short rising tone, played the instant the microphone is actually live.
 *
 * This replaces `await say('voice.listening')`, which every caller ran BEFORE opening the
 * mic. That is about a second of text-to-speech during which the app had announced it was
 * listening and was not: anything the artisan said in reply to the prompt — which is
 * exactly when a person answers — was spoken into a microphone that did not exist yet.
 * They then got "I didn't hear anything" and blamed themselves.
 *
 * A tone rather than a sentence, for three reasons: it is 140ms instead of 1000ms, it
 * cannot be misheard as part of the question, and it does not put our own TTS into the
 * microphone we just opened. Rising pitch because every device on earth uses rising for
 * "go" and falling for "stop"; this is one of the few audio conventions our users will
 * already have.
 *
 * Fire-and-forget and fully wrapped: a phone that will not give us an oscillator is not a
 * reason to refuse to record. Silence costs a cue, a throw costs the feature.
 */
function cue() {
  try {
    const Ctx = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(990, ctx.currentTime + 0.12);
    // Ramped, not switched. A square-edged gain change is a click, and a click on a cheap
    // speaker is indistinguishable from the app crashing.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    /* no cue on this device; recording still works, which is the part that matters */
  }
}

/**
 * Start recording. Returns a handle with stop() -> Blob and cancel().
 * The caller owns the UI; this owns the microphone and gives it back on stop or cancel.
 *
 * ⏱ Resolves only once the recorder is genuinely capturing, so a caller can flip its UI to
 * "listening" on the line after the await and be telling the truth. Do not reintroduce a
 * spoken announcement before this call — see cue() above for what that cost.
 */
/** What `record()` hands back: stop and get the clip, or throw it away. */
export type RecHandle = { stop: () => Promise<Blob>; cancel: () => void };

export async function record({ onSilence }: { onSilence?: () => void } = {}) {
  // Nothing of ours may still be talking. `{audio: true}` recorded the phone's own speaker,
  // and the proof is in an artisan's confirmation screen reading back "आपका नाम क्या है?
  // मेरा नाम वैणगोपाल मुत्तुस्वामी अय्यर है।" — our question and their answer, transcribed
  // as one sentence, because the loudspeaker was still finishing the question when the mic
  // opened. shutUp() ends our side; echoCancellation handles the tail and the room.
  shutUp();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      // A courtyard, a workshop, a room with a fan. The answer is often softly spoken and
      // the phone is often not close.
      autoGainControl: true,
    },
  });
  const mimeType = pickMime();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  // After start(), never before: the tone is the promise that capture has begun, so it
  // must not be able to sound while the promise is still false. It lands in the first
  // 140ms of the clip, which is silence the artisan has not spoken into yet.
  cue();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  // The recording is settled here, at construction, rather than inside stop(). The mic can
  // now be closed by something other than the caller — see suspend() — and a stop() that
  // installed its own onstop afterwards would wait for an event that already fired.
  const finished = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      detach();
      release();
      resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
    };
  });

  /*
   * Leaving the app must not leave the microphone open.
   *
   * Two signals for one event, because neither is reliable alone: Capacitor's appStateChange
   * is the accurate one on a device but does not exist in a browser, and visibilitychange is
   * the portable one but has been known not to fire on some Android WebViews when the screen
   * simply locks. Both handlers are idempotent — they act on `rec.state`, not on a flag — so
   * a device that fires both pauses once.
   *
   * Pause, not stop: the artisan is mid-sentence describing a saree. Someone calls, they
   * take it, they come back — asking them to start the whole description again is how a
   * feature stops being used. The clip continues where it left off.
   */
  const pause = () => suspend(rec);
  const unpause = () => resume(rec, stream.getTracks());
  const onVisibility = () => (document.hidden ? pause() : unpause());
  const onPagehide = () => close(rec, release);

  /*
   * Stop when they stop talking.
   *
   * Tapping the button again to end a recording is a convention learned from other apps,
   * and our users do not have those apps. They answer the question, then wait — and the
   * mic stayed open until somebody who did not know they had to, pressed something.
   *
   * The caller still owns what "stop" means (it has to transcribe, and only it knows what
   * to do with the text), so this reports rather than acts. The decision itself is in
   * micLifecycle.Silence, where it can be tested without a microphone.
   */
  let vadTimer: ReturnType<typeof setInterval> | null = null;
  if (onSilence) {
    const AudioCtx =
      window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext!;
    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const frame = new Uint8Array(analyser.fftSize);
    const vad = new Silence();

    // setInterval, not requestAnimationFrame: rAF stops in a backgrounded WebView, and a
    // recording that is paused there must not also lose the timer that would end it.
    vadTimer = setInterval(() => {
      if (rec.state !== 'recording') return;
      analyser.getByteTimeDomainData(frame);
      let sum = 0;
      for (const v of frame) {
        const d = (v - 128) / 128;
        sum += d * d;
      }
      if (vad.update(Math.sqrt(sum / frame.length), performance.now()) === 'stop') {
        clearInterval(vadTimer!);
        vadTimer = null;
        ctx.close().catch(() => {});
        onSilence();
      }
    }, 100);
  }

  let appListener: PluginListenerHandle | null = null;
  let detached = false;
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPagehide);
  App.addListener('appStateChange', ({ isActive }) => (isActive ? unpause() : pause()))
    .then((h) => {
      appListener = h;
      // Registration is async and the recording can be over before it lands.
      if (detached) h.remove();
    })
    .catch(() => {});

  function detach() {
    detached = true;
    if (vadTimer !== null) clearInterval(vadTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPagehide);
    appListener?.remove();
  }

  const handle: RecHandle = {
    stop: () => {
      if (rec.state !== 'inactive') rec.stop();
      return finished;
    },
    cancel: () => {
      detach();
      try {
        if (rec.state !== 'inactive') rec.stop();
      } finally {
        release();
      }
    },
  };
  return handle;
}

/**
 * Transcribe one clip. `lang` is the artisan's chosen language, which is what tells
 * Bhashini which ASR pipeline to select.
 */
export async function transcribe(
  blob: Blob,
  lang: string,
): Promise<{ transcript: string; confidence: number }> {
  const form = new FormData();
  form.append('audio', blob, 'clip.webm');
  form.append('lang', lang);
  const res = await fetch(apiUrl('/asr'), { method: 'POST', body: form });
  if (!res.ok) throw new Error('asr_failed');
  return res.json(); // { transcript, confidence }
}

/**
 * Yes/no by voice, for the four readiness questions and every confirmation.
 *
 * Deliberately generous: we accept the word in any of our languages plus the common
 * English ones, because a Hindi-speaking user routinely answers "haan" or "yes"
 * interchangeably. Anything we cannot classify returns null and the caller re-asks
 * rather than guessing — a wrong guess on "do you have a PAN card" routes someone down
 * the wrong onboarding path for days.
 */
const YES = ['haan', 'ha', 'हाँ', 'हां', 'ହଁ', 'yes', 'yeah', 'ok', 'theek', 'ठीक'];
const NO = ['nahi', 'nahin', 'नहीं', 'ନା', 'no', 'nope', 'na'];

export function classifyYesNo(transcript: string | null | undefined): boolean | null {
  const words = (transcript ?? '').toLowerCase().trim().split(/\s+/);
  if (words.some((w) => YES.includes(w))) return true;
  if (words.some((w) => NO.includes(w))) return false;
  return null;
}
