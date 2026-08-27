import { apiUrl } from '../api/client.js';

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
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
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
export async function record() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMime();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  // After start(), never before: the tone is the promise that capture has begun, so it
  // must not be able to sound while the promise is still false. It lands in the first
  // 140ms of the clip, which is silence the artisan has not spoken into yet.
  cue();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
        };
        rec.stop();
      }),
    cancel: () => {
      try {
        rec.stop();
      } finally {
        release();
      }
    },
  };
}

/**
 * Transcribe one clip. `lang` is the artisan's chosen language, which is what tells
 * Bhashini which ASR pipeline to select.
 */
export async function transcribe(blob, lang) {
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

export function classifyYesNo(transcript) {
  const words = (transcript ?? '').toLowerCase().trim().split(/\s+/);
  if (words.some((w) => YES.includes(w))) return true;
  if (words.some((w) => NO.includes(w))) return false;
  return null;
}
