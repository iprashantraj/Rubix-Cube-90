import { useEffect, useRef, useState } from 'react';

/**
 * iOS 13+ gates the accelerometer behind a user-gesture permission call that is not in the
 * DOM lib, because it is a WebKit extension rather than a standard. Narrowed here rather
 * than cast at each use so the feature detection stays readable.
 */
type DmeWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};
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
  const [tilt, setTilt] = useState<{ pitch: number; roll: number } | null>(null);
  const pitch = useRef(new Smoothed(0.1));
  const roll = useRef(new Smoothed(0.1));

  const dme = DeviceMotionEvent as DmeWithPermission;
  useEffect(() => {
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
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
    if (typeof dme?.requestPermission === 'function') {
      dme.requestPermission!().then((s: string) => s === 'granted' && start());
    } else {
      start();
    }
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);

  return tilt;
}
