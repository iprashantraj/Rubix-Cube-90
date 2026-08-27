import { useEffect, useRef, useState } from 'react';
import { Smoothed, tiltFrom } from './gate.js';

/**
 * Accelerometer tilt. Spec §4.4 check 3.
 *
 * This check is completely free — it rides a separate event stream and does no image work
 * at all. The raw sensor jitters constantly even when the phone is still, so both axes go
 * through an exponential filter; without it the on-screen indicator vibrates and users
 * give up.
 *
 * Throttled to ~10Hz of React state. The filter still sees every raw sample, so smoothing
 * quality is unaffected — we just don't re-render 60 times a second.
 */
export function useTilt() {
  const [tilt, setTilt] = useState(null);
  const pitch = useRef(new Smoothed(0.1));
  const roll = useRef(new Smoothed(0.1));

  useEffect(() => {
    let last = 0;
    const onMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null) return;
      const raw = tiltFrom(g);
      const p = pitch.current.push(raw.pitch);
      const r = roll.current.push(raw.roll);

      const now = performance.now();
      if (now - last < 100) return;
      last = now;
      setTilt({ pitch: p, roll: r });
    };

    // iOS 13+ gates DeviceMotion behind a user gesture. Android and Capacitor's WebView
    // fire it immediately; if the permission call is unavailable we just listen.
    const start = () => window.addEventListener('devicemotion', onMotion);
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then((s) => s === 'granted' && start());
    } else {
      start();
    }
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);

  return tilt;
}
