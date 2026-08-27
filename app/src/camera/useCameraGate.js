import { useEffect, useRef, useState } from 'react';
import { analyse, findProblem, GateState, pickSharpest } from './gate.js';

/**
 * The live capture loop. Spec §4.
 *
 * Deliberately plain getUserMedia + canvas rather than a camera-preview plugin: no native
 * bridge per frame, no base64 round-trip. drawImage does the downscale on the GPU, so the
 * readback is 43k pixels instead of two million. Benchmarked at 0.30ms/frame on desktop
 * and roughly 6ms on a low-end phone, against a 66-100ms budget.
 *
 * Do not raise GATE_W/GATE_H "for accuracy". At full resolution the readback alone costs
 * ~14ms and the feature stops feeling live. We are measuring the photo's *condition* —
 * "is it dark", "is it blurry" — and that is just as visible at 240x180.
 */
const GATE_W = 240;
const GATE_H = 180;
const SAMPLE_EVERY = 3; // ~10 checks/sec off a 30fps preview, which reads as live
const BURST = 3;

function toGray(rgba, out) {
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    // Rec.601 luma. Integer math — this runs 43k times per frame.
    out[p] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return out;
}

/**
 * @param {object} opts
 * @param {object} opts.thresholds  from GET /api/thresholds — never hardcode a copy
 * @param {'flat'|'standing'} opts.mode  flat items want the phone looking straight down
 * @param {{pitch:number,roll:number}|null} opts.tilt  from useTilt()
 * @param {(blob:Blob)=>void} opts.onCapture
 */
export function useCameraGate({ thresholds, mode = 'standing', tilt = null, onCapture }) {
  const videoRef = useRef(null);
  const [problem, setProblem] = useState('photo.too_dark');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  // Refs, not state: these change every frame and must never trigger a re-render.
  const tiltRef = useRef(tilt);
  tiltRef.current = tilt;
  const capturingRef = useRef(false);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;
  // Filled in by the scoring effect below so the manual shutter has something to call.
  const captureRef = useRef(null);

  /*
   * Opening the lens and scoring the frames are two separate effects, and the split is the
   * whole fix for "the camera never opens".
   *
   * They used to be one effect gated on `if (!thresholds) return`. GET /api/thresholds is a
   * network call, so with the API down — or simply not started — the camera was never asked
   * for at all: no permission prompt, no preview, no error, just a spinner. The lens has no
   * dependency on those numbers; only the scoring does. So the preview comes up immediately
   * and the gate arms a moment later when the numbers land.
   */
  useEffect(() => {
    let stream;
    let stopped = false;

    /*
     * `navigator.mediaDevices` is undefined outside a secure context, and reading
     * `.getUserMedia` off undefined throws SYNCHRONOUSLY — past the .catch below, out of
     * the effect, and React unmounts the tree. Which is exactly what happens when the dev
     * server is opened on a phone as http://192.168.x.x:5173 (vite.config sets host:true,
     * so that is the normal way to test this screen). Named as its own error because
     * "the camera did not open" sends someone hunting for a hardware fault.
     */
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn(
        '[camera] navigator.mediaDevices is undefined — this origin is not a secure ' +
          `context (${window.location.origin}). Use https, localhost, or the Capacitor ` +
          'build; getUserMedia is unavailable over plain http on a LAN address.',
      );
      setError('camera.insecure');
      return undefined;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((s) => {
        if (stopped || !videoRef.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        videoRef.current.srcObject = s;
        // play() rejects if the element is torn down mid-promise, and an unhandled
        // rejection here surfaces as a blank screen rather than as a camera problem.
        videoRef.current.play().catch(() => {});
        setReady(true);
      })
      .catch((e) => setError(e.name === 'NotAllowedError' ? 'camera.denied' : 'camera.failed'));

    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    // `ready` is in the deps because the loop reads pixels off a live <video>; starting it
    // against a stream that has not arrived just burns frames returning at readyState < 2.
    if (!thresholds || !ready) return undefined;
    let raf;
    let stopped = false;
    let frameNo = 0;

    const video = videoRef.current;
    const gateCanvas = document.createElement('canvas');
    gateCanvas.width = GATE_W;
    gateCanvas.height = GATE_H;
    const gateCtx = gateCanvas.getContext('2d', { willReadFrequently: true });
    const gray = new Uint8Array(GATE_W * GATE_H);
    const state = new GateState(thresholds);

    /** Grab one full-resolution still, plus its gate-sized grayscale for scoring. */
    const grabFull = () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      gateCtx.drawImage(video, 0, 0, GATE_W, GATE_H);
      const g = toGray(
        gateCtx.getImageData(0, 0, GATE_W, GATE_H).data,
        new Uint8Array(GATE_W * GATE_H),
      );
      return { canvas: c, gray: g, w: GATE_W, h: GATE_H };
    };

    /**
     * Burst-and-pick: three stills, keep the sharpest. Costs ~60ms and removes the
     * residual hand-shake that survives the live gate. No model, no network.
     */
    const capture = async () => {
      if (capturingRef.current) return;
      capturingRef.current = true;
      try {
        const shots = [];
        for (let i = 0; i < BURST; i++) {
          shots.push(grabFull());
          await new Promise((r) => setTimeout(r, 20));
        }
        const best = shots[pickSharpest(shots)];
        const blob = await new Promise((res) =>
          best.canvas.toBlob(res, 'image/jpeg', 0.92),
        );
        onCaptureRef.current?.(blob);
      } finally {
        capturingRef.current = false;
      }
    };
    captureRef.current = capture;

    const loop = () => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      if (video.readyState < 2) return;
      if (frameNo++ % SAMPLE_EVERY) return;
      if (capturingRef.current) return;

      gateCtx.drawImage(video, 0, 0, GATE_W, GATE_H);
      toGray(gateCtx.getImageData(0, 0, GATE_W, GATE_H).data, gray);

      const metrics = analyse(gray, GATE_W, GATE_H, thresholds, tiltRef.current);
      // Relax thresholds while already green so a borderline frame doesn't bounce out.
      const found = findProblem(metrics, thresholds, { mode, relaxed: state.isGreen });

      const now = performance.now();
      const committed = state.update(found, now);
      setProblem((prev) => (prev === committed ? prev : committed));

      // Auto-capture once green has held a second. Pressing a button shakes the phone
      // and reintroduces exactly the blur the gate just spent all this work avoiding.
      if (state.shouldAutoCapture(now)) capture();
    };

    raf = requestAnimationFrame(loop);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      captureRef.current = null;
      // Back to "not judged yet" rather than leaving the last verdict behind. A stale
      // `null` here would mean a re-armed gate starts out green and auto-fires on the
      // first frame it sees.
      setProblem('photo.too_dark');
    };
  }, [thresholds, mode, ready]);

  return {
    videoRef,
    problem,
    // Green is a claim about a live, scored frame. Before the stream is up or the
    // thresholds have landed, nothing has been measured — so nothing is green, and the
    // shutter stays locked.
    isGreen: ready && Boolean(thresholds) && problem === null,
    ready,
    error,
    /** The manual shutter. Null until the gate is armed, which is also when it is safe. */
    capture: () => captureRef.current?.(),
  };
}
