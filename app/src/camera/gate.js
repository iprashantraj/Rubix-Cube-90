/**
 * On-device camera quality gate. Spec §4.
 *
 * The phone's job is to STOP bad photos. The server's job is to BEAUTIFY good ones.
 * Every photo rejected here is data the artisan doesn't pay for and GPU we don't spend.
 *
 * Pure functions — no DOM, no camera, no imports. The caller supplies the downscaled
 * grayscale buffer, the accelerometer reading, and the thresholds. That keeps this
 * testable without a device (see demo() at the bottom) and keeps thresholds coming from
 * ai/thresholds.json at runtime rather than being duplicated here. Two copies drift, and
 * then the phone accepts photos the server rejects.
 *
 * Everything below runs on a 240x180 grayscale buffer (43k pixels), never the full frame.
 * At full resolution the canvas readback costs ~2fps and the feature is worthless.
 */

const GRID_COLS = 12;
const GRID_ROWS = 9;

/** Laplacian variance. High = sharp: brightness jumps hard between neighbouring pixels. */
export function blurScore(gray, w, h) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Histogram signals. Blown and crushed matter more than the mean: a blown-out white
 * region contains no information at all, and no amount of server-side AI recovers it.
 */
export function exposure(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  let weighted = 0;
  for (let v = 0; v < 256; v++) weighted += v * hist[v];

  let blown = 0;
  for (let v = 250; v < 256; v++) blown += hist[v];
  let crushed = 0;
  for (let v = 0; v <= 5; v++) crushed += hist[v];

  return {
    mean: weighted / gray.length,
    blownFraction: blown / gray.length,
    crushedFraction: crushed / gray.length,
  };
}

/**
 * Framing by grid variance — we don't detect the product, we detect where something is
 * happening. Empty floor is flat (low variance); a woven product is textured (high).
 *
 * Cell threshold is relative to the busiest cell rather than absolute, so it adapts to
 * both a dark matka and a bright dupatta without recalibration.
 */
export function framing(gray, w, h, busyRatio) {
  const cellVars = new Float64Array(GRID_COLS * GRID_ROWS);
  let maxVar = 0;

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x0 = Math.floor((col * w) / GRID_COLS);
      const x1 = Math.floor(((col + 1) * w) / GRID_COLS);
      const y0 = Math.floor((row * h) / GRID_ROWS);
      const y1 = Math.floor(((row + 1) * h) / GRID_ROWS);

      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = gray[y * w + x];
          sum += v;
          sumSq += v * v;
          n++;
        }
      }
      const mean = n ? sum / n : 0;
      const variance = n ? sumSq / n - mean * mean : 0;
      cellVars[row * GRID_COLS + col] = variance;
      if (variance > maxVar) maxVar = variance;
    }
  }

  if (maxVar === 0) return { fraction: 0, offsetX: 0, offsetY: 0, found: false };

  const cutoff = maxVar * busyRatio;
  let minCol = GRID_COLS;
  let maxCol = -1;
  let minRow = GRID_ROWS;
  let maxRow = -1;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (cellVars[row * GRID_COLS + col] < cutoff) continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
  }
  if (maxCol < 0) return { fraction: 0, offsetX: 0, offsetY: 0, found: false };

  const boxW = (maxCol - minCol + 1) / GRID_COLS;
  const boxH = (maxRow - minRow + 1) / GRID_ROWS;
  const centreX = (minCol + maxCol + 1) / 2 / GRID_COLS;
  const centreY = (minRow + maxRow + 1) / 2 / GRID_ROWS;

  return {
    fraction: boxW * boxH,
    offsetX: Math.abs(centreX - 0.5),
    offsetY: Math.abs(centreY - 0.5),
    found: true,
  };
}

/**
 * Tilt from the accelerometer, not the camera — this check is completely free, it rides
 * a separate event stream and does no image work at all.
 *
 * `pitch` is the camera axis relative to horizontal: 90 = looking straight down (what a
 * dhurrie or pattachitra on the floor wants), 0 = looking straight ahead (what a standing
 * matka or murti wants).
 *
 * Pass `accelerationIncludingGravity` straight through. Roll is meaningless when the
 * phone is near-horizontal (x and y both collapse toward zero), which is exactly when we
 * don't check it.
 */
export function tiltFrom({ x, y, z }) {
  const deg = 180 / Math.PI;
  return {
    pitch: Math.atan2(z, Math.hypot(x, y)) * deg,
    roll: Math.atan2(x, y) * deg,
  };
}

/**
 * Exponential smoothing. The raw sensor jitters constantly even when the phone is still;
 * without this the on-screen indicator vibrates and users give up.
 */
export class Smoothed {
  constructor(alpha = 0.1) {
    this.alpha = alpha;
    this.value = null;
  }
  push(reading) {
    this.value =
      this.value === null
        ? reading
        : (1 - this.alpha) * this.value + this.alpha * reading;
    return this.value;
  }
}

/**
 * The priority ladder (§4.5). Returns the single highest-priority problem, or null when
 * the frame is good.
 *
 * Showing four problems at once is how this feature fails: "photo blurry hai, andhera hai,
 * phone tedha hai, product door hai" gets the app uninstalled. Only reveal the next
 * problem once the current one clears.
 *
 * `relaxed` widens every threshold by `hysteresis_slack`. The caller passes it while the
 * state is already green, so a borderline frame doesn't bounce back out — different
 * thresholds entering green vs leaving it.
 */
export function findProblem(metrics, t, { mode = 'standing', relaxed = false } = {}) {
  const s = relaxed ? t.hysteresis_slack : 1;
  const { exposure: exp, blur, frame, tilt } = metrics;

  /*
   * 1. Light first — every other check is meaningless in the dark.
   *
   * Order within this rung is mean-low, mean-high, blown, crushed, and it is not arbitrary.
   * The crushed-shadow test used to run second, so a frame that was BLOWN OUT but happened
   * to carry deep shadows somewhere was announced as `photo.too_dark` — and the artisan,
   * who cannot read the screen and has only that sentence, added light to an already
   * over-exposed photograph. Verified on `pottery-earthen-sharp-01.png`: mean 173, 50.6%
   * blown highlights, announced as too dark (docs/Abhay/CHANGELOG.md, 2026-08-27).
   *
   * The verdict was never wrong — the photo does get refused either way. The INSTRUCTION
   * was wrong, and on this app the instruction is the entire interface.
   */
  if (exp.mean < t.brightness_mean_min / s) return 'photo.too_dark';
  if (exp.mean > t.brightness_mean_max * s) return 'photo.too_bright';
  if (exp.blownFraction > t.blown_pixel_fraction_max * s) return 'photo.too_bright';
  if (exp.crushedFraction > t.crushed_pixel_fraction_max * s) return 'photo.too_dark';

  /*
   * 2. Framing, BEFORE blur.
   *
   * Blur used to sit here, and a photograph taken from too far away scores blurry at full
   * resolution — the product is small in the frame, so there is little edge energy anywhere.
   * The artisan was told to hold still when the fix was to step closer. Framing is the
   * cause, blur is its symptom, and the rung that names the cause has to run first.
   *
   * ⚠️ Only when a product was actually FOUND. `frame.found === false` means no busy region
   * at all, and that is not the same fact as "the product is small": a frame with no texture
   * anywhere is out of focus, or pointed at a blank wall. Calling that "too far" sends the
   * artisan walking towards something the camera never saw. It falls through to the blur
   * rung below, and the not-found case is answered after it.
   */
  if (frame.found && frame.fraction < t.fill_fraction_min / s) return 'photo.too_far';
  if (frame.fraction > Math.min(t.fill_fraction_max * s, 1)) return 'photo.too_close';
  if (
    frame.offsetX > t.center_offset_max * s ||
    frame.offsetY > t.center_offset_max * s
  ) {
    return 'photo.off_centre';
  }

  // 3. Blur. Content-dependent — a plain white cloth scores blurry while being sharp — so
  //    this is surfaced as a suggestion and never hard-blocks the shutter. The server
  //    hard-rejects separately at blur_laplacian_variance_reject_min, which is measured at
  //    full resolution where the number means something (591-image fixture set).
  if (blur < t.blur_laplacian_variance_min / s) return 'photo.blurry';

  // Sharp, well lit, and still nothing that looks like a product. "Move closer" is the only
  // instruction that can help — the frame is in focus, so there is genuinely nothing there.
  if (!frame.found) return 'photo.too_far';

  // 4. Tilt, against whatever the product type wants.
  if (tilt) {
    const targetPitch = mode === 'flat' ? 90 : 0;
    if (Math.abs(tilt.pitch - targetPitch) > t.tilt_degrees_max * s) {
      return 'photo.tilted';
    }
    // Roll is undefined when the phone is looking straight down, so skip it there.
    if (mode !== 'flat' && Math.abs(tilt.roll) > t.tilt_degrees_max * s) {
      return 'photo.tilted';
    }
  }

  return null;
}

/**
 * Debounce for the traffic light. Borderline frames otherwise oscillate red/green ten
 * times a second and the app looks broken.
 *
 * A candidate state must hold for `state_hold_seconds` before it becomes the committed
 * state. Timestamps are passed in rather than read from the clock so this is testable.
 */
export class GateState {
  constructor(thresholds) {
    this.t = thresholds;
    this.committed = 'photo.too_dark'; // start red — never open the shutter on frame one
    this.candidate = null;
    this.since = 0;
    this.greenSince = null;
  }

  get isGreen() {
    return this.committed === null;
  }

  /** Feed one analysed frame. Returns the committed problem key, or null when green. */
  update(problem, nowMs) {
    if (problem !== this.candidate) {
      this.candidate = problem;
      this.since = nowMs;
    }
    const held = (nowMs - this.since) / 1000;
    if (problem !== this.committed && held >= this.t.state_hold_seconds) {
      this.committed = problem;
      this.greenSince = problem === null ? nowMs : null;
    }
    return this.committed;
  }

  /**
   * Auto-capture once green has been stable for a second. Pressing a physical button
   * shakes the phone and reintroduces the blur we just spent all this work avoiding —
   * removing the press removes the shake.
   */
  shouldAutoCapture(nowMs) {
    return this.greenSince !== null && nowMs - this.greenSince >= 1000;
  }
}

/**
 * Burst-and-pick. On capture, grab a few frames and keep the sharpest.
 *
 * Free quality: no extra model, no extra network, ~60ms of camera time, and it kills the
 * residual hand-shake blur that survives the live gate.
 */
export function pickSharpest(frames) {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    const score = blurScore(frames[i].gray, frames[i].w, frames[i].h);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Run every check over one frame. */
export function analyse(gray, w, h, t, tilt = null) {
  return {
    blur: blurScore(gray, w, h),
    exposure: exposure(gray),
    frame: framing(gray, w, h, t.cell_busy_ratio),
    tilt,
  };
}

// ---------------------------------------------------------------------------
// Self-check: node app/src/camera/gate.js
// ---------------------------------------------------------------------------

function demo() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error('FAIL: ' + msg);
    console.log('  ok  ' + msg);
  };

  const t = {
    blur_laplacian_variance_min: 100,
    brightness_mean_min: 60,
    brightness_mean_max: 200,
    blown_pixel_fraction_max: 0.05,
    crushed_pixel_fraction_max: 0.05,
    fill_fraction_min: 0.4,
    fill_fraction_max: 0.9,
    tilt_degrees_max: 8,
    state_hold_seconds: 0.5,
    cell_busy_ratio: 0.2,
    center_offset_max: 0.15,
    hysteresis_slack: 1.25,
  };

  const W = 240;
  const H = 180;

  // Flat field, plus an optional textured "product" covering `span` of each dimension.
  const frame = (bg, span, texA = 60, texB = 200) => {
    const g = new Uint8Array(W * H).fill(bg);
    if (span > 0) {
      const x0 = Math.floor((W * (1 - span)) / 2);
      const x1 = W - x0;
      const y0 = Math.floor((H * (1 - span)) / 2);
      const y1 = H - y0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          g[y * W + x] = (x + y) % 2 ? texA : texB;
        }
      }
    }
    return g;
  };

  const level = new Smoothed(0.1);
  console.log('camera gate');

  // The ladder fires in priority order, one problem at a time.
  // Shot at dusk: the product is textured and well-framed, but there is no light.
  const dark = analyse(frame(20, 0.8, 10, 40), W, H, t);
  assert(findProblem(dark, t) === 'photo.too_dark', 'dark frame -> too_dark');

  // Shot in direct midday sun: the highlights are blown and that detail is gone forever.
  const bright = analyse(frame(240, 0.8, 230, 255), W, H, t);
  assert(findProblem(bright, t) === 'photo.too_bright', 'blown frame -> too_bright');

  const flat = analyse(frame(128, 0), W, H, t);
  assert(findProblem(flat, t) === 'photo.blurry', 'no texture -> blurry');

  /*
   * A blown frame that ALSO has deep shadows must say too_bright.
   *
   * This is pottery-earthen-sharp-01.png from the fixture set: mean 173, 50.6% blown, and
   * the old rung order announced it as too_dark because the crushed-shadow test ran second.
   * The artisan adds light to an over-exposed photograph and it gets worse. A wrong verdict
   * and a wrong instruction are different bugs; this was the second kind, which is the one
   * that matters to someone who cannot read the screen.
   */
  const blownWithShadows = {
    exposure: { mean: 173, blownFraction: 0.506, crushedFraction: 0.2 },
    blur: 999,
    frame: { found: true, fraction: 0.6, offsetX: 0, offsetY: 0 },
    tilt: null,
  };
  assert(
    findProblem(blownWithShadows, t) === 'photo.too_bright',
    'blown highlights beat crushed shadows — add light to that and it gets worse',
  );

  // Too far at full resolution also scores blurry, because a small product leaves little
  // edge energy anywhere. The instruction has to be the cause, not the symptom.
  const farAndSoft = {
    exposure: { mean: 128, blownFraction: 0, crushedFraction: 0 },
    blur: 0,
    frame: { found: true, fraction: 0.05, offsetX: 0, offsetY: 0 },
    tilt: null,
  };
  assert(findProblem(farAndSoft, t) === 'photo.too_far', 'framing is the cause, blur the symptom');

  const far = analyse(frame(128, 0.3), W, H, t);
  assert(findProblem(far, t) === 'photo.too_far', 'small product -> too_far');

  const close = analyse(frame(128, 1.0), W, H, t);
  assert(findProblem(close, t) === 'photo.too_close', 'product fills frame -> too_close');

  const good = analyse(frame(128, 0.8), W, H, t);
  assert(findProblem(good, t) === null, 'well-framed textured product -> green');

  // Light is checked before blur: a dark frame reports darkness, never blurriness.
  const darkAndFlat = analyse(frame(10, 0), W, H, t);
  assert(findProblem(darkAndFlat, t) === 'photo.too_dark', 'dark beats blur in the ladder');

  // Tilt, per product type.
  const faceDown = tiltFrom({ x: 0, y: 0, z: 9.81 });
  assert(Math.abs(faceDown.pitch - 90) < 1, 'phone face-down -> pitch 90');
  const upright = tiltFrom({ x: 0, y: 9.81, z: 0 });
  assert(Math.abs(upright.pitch) < 1, 'phone upright -> pitch 0');

  const flatItem = analyse(frame(128, 0.8), W, H, t, faceDown);
  assert(findProblem(flatItem, t, { mode: 'flat' }) === null, 'dhurrie shot from above -> green');
  assert(
    findProblem(flatItem, t, { mode: 'standing' }) === 'photo.tilted',
    'matka shot from above -> tilted',
  );

  // Smoothing converges without jitter.
  for (let i = 0; i < 200; i++) level.push(i % 2 ? 91 : 89);
  assert(Math.abs(level.value - 90) < 1, 'accelerometer smoothing settles on the mean');

  // Hysteresis: a single bad frame must not drop us out of green.
  const state = new GateState(t);
  let now = 0;
  for (let i = 0; i < 20; i++) state.update(null, (now += 100));
  assert(state.isGreen, 'sustained good frames -> green');
  assert(state.shouldAutoCapture(now), 'green held past 1s -> auto-capture');

  state.update('photo.blurry', (now += 100));
  assert(state.isGreen, 'one bad frame does not break green');
  state.update(null, (now += 100));
  assert(state.isGreen, 'flicker absorbed');

  for (let i = 0; i < 10; i++) state.update('photo.blurry', (now += 100));
  assert(!state.isGreen, 'sustained bad frames -> red');
  assert(!state.shouldAutoCapture(now), 'red never auto-captures');

  // Burst-and-pick keeps the sharpest of the burst.
  const burst = [
    { gray: frame(128, 0), w: W, h: H },
    { gray: frame(128, 0.8), w: W, h: H },
    { gray: frame(128, 0), w: W, h: H },
  ];
  assert(pickSharpest(burst) === 1, 'burst picks the sharpest frame');

  console.log('all passed');
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('gate.js')) demo();
