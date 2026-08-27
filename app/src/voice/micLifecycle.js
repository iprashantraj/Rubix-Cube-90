/**
 * What a live recording does when the app goes away and comes back.
 *
 * Pure and dependency-free on purpose: the events that drive these transitions (WebView
 * visibility, Capacitor app state, Android revoking the mic) only exist on a device, so the
 * decisions have to be checkable without one — `node src/voice/micLifecycle.js`.
 *
 * Every function acts on `rec.state` rather than on a flag of our own, which is what makes
 * them idempotent. listen.js listens for both visibilitychange and appStateChange because
 * neither signal is reliable alone, and on a device that fires both, the second call is a
 * no-op instead of a double pause.
 */

/** Backgrounded. Pause — never stop: the artisan is mid-sentence and will come back to it. */
export function suspend(rec) {
  if (rec.state === 'recording') rec.pause();
}

/**
 * Foregrounded. Resume, unless the microphone did not survive the trip.
 *
 * Android can revoke mic access while the app is in the background; the track ends and
 * resume() on it throws. Finalising instead hands the caller the audio already spoken,
 * which is worth more than an exception — a saree description is a minute of the artisan's
 * effort and re-recording it is how people stop using a feature.
 */
export function resume(rec, tracks) {
  if (rec.state !== 'paused') return;
  if (tracks.some((t) => t.readyState === 'ended')) rec.stop();
  else rec.resume();
}

/**
 * Closing, not backgrounding. Hand the microphone back now.
 *
 * Stopping the recorder releases the tracks through its own onstop; when it is already
 * inactive nothing else will, so release directly. The point is that the OS recording
 * indicator clears — being left with a live mic indicator after closing an app is the kind
 * of thing that makes someone uninstall it, and they would be right.
 */
export function close(rec, release) {
  if (rec.state !== 'inactive') rec.stop();
  else release();
}

/**
 * When to stop recording on the artisan's behalf.
 *
 * They finish speaking and then wait, because nothing told them the app is still listening
 * and nothing told them to press the button again. Tapping to stop is a convention learned
 * from other apps; our users do not have those apps. So silence ends the recording.
 *
 * Three timers, and each is a different failure:
 *   hangMs   they spoke and stopped. End it, but leave room for the pause mid-sentence
 *            that every person takes — 1.5s is longer than a breath and shorter than a wait.
 *   leadMs   they never spoke at all. The mic opened onto a silent room; something went
 *            wrong (permission, a dead mic, they missed the cue) and holding it open
 *            forever teaches nothing.
 *   maxMs    a hard ceiling. A stuck-open microphone in someone's home is the worst thing
 *            in this file, and a room with a television in it never falls below threshold.
 *
 * `rms` is 0..1 loudness. The threshold is deliberately low: a soft-spoken answer in a
 * courtyard is the normal case, not the edge one.
 */
export class Silence {
  constructor({ speech = 0.02, hangMs = 1500, leadMs = 8000, maxMs = 60000 } = {}) {
    Object.assign(this, { speech, hangMs, leadMs, maxMs });
    this.spoke = false;
    this.quietSince = 0;
    this.startedAt = null;
  }

  /** 'listening' | 'stop'. Feed it loudness every ~100ms. */
  update(rms, now) {
    this.startedAt ??= now;
    if (now - this.startedAt >= this.maxMs) return 'stop';

    if (rms >= this.speech) {
      this.spoke = true;
      this.quietSince = 0;
      return 'listening';
    }
    if (!this.spoke) return now - this.startedAt >= this.leadMs ? 'stop' : 'listening';
    this.quietSince ||= now;
    return now - this.quietSince >= this.hangMs ? 'stop' : 'listening';
  }
}

function demo() {
  const assert = (c, m) => {
    if (!c) throw new Error(m);
  };
  const fake = (state) => ({
    state,
    calls: [],
    pause() {
      this.calls.push('pause');
      this.state = 'paused';
    },
    resume() {
      this.calls.push('resume');
      this.state = 'recording';
    },
    stop() {
      this.calls.push('stop');
      this.state = 'inactive';
    },
  });
  const live = [{ readyState: 'live' }];
  const dead = [{ readyState: 'ended' }];

  let rec = fake('recording');
  suspend(rec);
  assert(rec.state === 'paused', 'backgrounding pauses');
  suspend(rec);
  assert(rec.calls.filter((c) => c === 'pause').length === 1, 'both signals pause once');

  resume(rec, live);
  assert(rec.state === 'recording', 'returning resumes the same clip');
  assert(!rec.calls.includes('stop'), 'resuming never restarts the recording');
  resume(rec, live);
  assert(rec.calls.filter((c) => c === 'resume').length === 1, 'both signals resume once');

  rec = fake('recording');
  suspend(rec);
  resume(rec, dead);
  assert(rec.state === 'inactive', 'a revoked mic finalises instead of throwing');

  rec = fake('paused');
  close(rec, () => rec.calls.push('release'));
  assert(rec.calls.includes('stop'), 'closing while paused still stops');

  rec = fake('inactive');
  close(rec, () => rec.calls.push('release'));
  assert(rec.calls.includes('release'), 'an already-stopped recorder still releases the mic');

  // Idle app switches must not touch a recording that is not running.
  rec = fake('inactive');
  suspend(rec);
  resume(rec, live);
  assert(rec.calls.length === 0, 'no recording in progress -> nothing happens');

  // Silence detection. Times are absolute ms, fed the way the real loop feeds them.
  const speech = 0.1;
  let vad = new Silence();
  assert(vad.update(speech, 0) === 'listening', 'speaking keeps the mic open');
  assert(vad.update(0, 1000) === 'listening', 'a pause mid-sentence is not the end');
  assert(vad.update(0, 2600) === 'stop', 'silence after speech ends the recording');

  vad = new Silence();
  for (let t = 0; t < 8000; t += 500) assert(vad.update(0, t) === 'listening', 'waiting to be spoken to');
  assert(vad.update(0, 8000) === 'stop', 'a mic that was never spoken into closes itself');

  // A pause that resumes must not have started the clock for good.
  vad = new Silence();
  vad.update(speech, 0);
  vad.update(0, 1000);
  vad.update(speech, 1200);
  assert(vad.update(0, 2400) === 'listening', 'speaking again resets the hang timer');

  vad = new Silence();
  for (let t = 0; t <= 60000; t += 1000) var last = vad.update(speech, t);
  assert(last === 'stop', 'the hard ceiling closes a mic that never goes quiet');

  console.log('all passed');
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('micLifecycle.js')) demo();
