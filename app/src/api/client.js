import { Capacitor } from '@capacitor/core';
import { useSession } from '../store.js';

/*
 * Where the API lives.
 *
 * In the browser this is a relative path and Vite proxies it. On a device the app is served
 * from https://localhost by Capacitor, so a relative '/api' resolves into the app's OWN
 * bundled assets — every request 404s against the WebView, `fetch` never reaches a server,
 * and the app tells the artisan "no network" while the phone sits on full signal. That is
 * the single most confusing failure this app can produce, and it was the default.
 *
 * So the native build no longer falls back to a path that cannot work. It defaults to the
 * loopback address that `adb reverse tcp:8000 tcp:8000` provides, which is the workflow
 * res/xml/network_security_config.xml already whitelists cleartext for. Point
 * VITE_API_BASE at a real host for anything that is not a laptop-tethered demo.
 */
const BASE =
  import.meta.env.VITE_API_BASE ??
  (Capacitor.isNativePlatform() ? 'http://localhost:8000/api' : '/api');

/**
 * Build an absolute API URL.
 *
 * Anything that calls the API must go through this, including the modules that use bare
 * `fetch` rather than the wrapper below. A hardcoded '/api/...' works in the browser and
 * then silently resolves into Capacitor's bundled assets on a device — the request 404s
 * against the app itself and the failure looks like a server problem.
 */
export const apiUrl = (path) => BASE + path;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message_key ?? body?.detail ?? `http_${status}`);
    this.status = status;
    this.body = body;
    // Server errors carry a message_key so the app can speak them in the artisan's
    // language rather than showing an English string they cannot read.
    this.messageKey = body?.message_key ?? null;
  }
}

async function request(path, { method = 'GET', body, signal, form } = {}) {
  const { token } = useSession.getState();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: form ?? (body ? JSON.stringify(body) : undefined),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // Distinguish "no network" from "server said no" — they get different spoken
    // messages and only one of them is worth retrying.
    throw new ApiError(0, { message_key: 'net.offline' });
  }

  if (res.status === 401) {
    useSession.getState().signOut();
    throw new ApiError(401, { message_key: 'auth.expired' });
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (p, o) => request(p, o),
  post: (p, body, o) => request(p, { ...o, method: 'POST', body }),
  patch: (p, body, o) => request(p, { ...o, method: 'PATCH', body }),
  del: (p, o) => request(p, { ...o, method: 'DELETE' }),
  form: (p, form, o) => request(p, { ...o, method: 'POST', form }),
};

/**
 * Calibration thresholds: bundled as a floor, fetched as the truth.
 *
 * The app's camera gate and the server's quality gate MUST read the same numbers. Two
 * copies drift, and then the phone happily accepts photos the server turns around and
 * rejects — which is the exact frustration the on-device gate exists to prevent. So the
 * server's copy always wins the moment it arrives, and recalibrating stays a server-side
 * JSON edit rather than an app release rural users never install.
 *
 * But "fetch or nothing" made the camera — the one genuinely on-device feature in this
 * app — unusable whenever the API was unreachable, which for our users is a normal Tuesday.
 * So there is a bundled floor underneath.
 *
 * 🔑 The bundled copy is `ai/thresholds.json` ITSELF, imported at build time. Not a
 * transcription of it, not a copy someone syncs by hand — the same file the server reads.
 * That is what makes the drift argument above stop applying: there is exactly one set of
 * numbers in the repository and two ways of reaching it. Do not replace this import with a
 * literal, and do not "tidy" it into a local JSON file.
 *
 * (This crosses the app/ai folder line, which `web/` is forbidden to cross. The rule there
 * is about RUNTIME coupling between deploy units — web/ must call ai/ over HTTP. This is a
 * build-time read of a static config file in the same repository, and the alternative is a
 * hand-maintained duplicate, which is the thing the rule exists to prevent.)
 */
import bundledThresholds from '../../../ai/thresholds.json';

let serverThresholds = null;
let inflight = null;

/**
 * The numbers to gate with right now. **Never null**, so the camera is never blocked.
 *
 * This is the one place the app is deliberately NOT online-first, because the camera is the
 * one feature that is genuinely a device feature. A weaver standing over a saree with the
 * light right should not be told to wait for a web server before their phone will look
 * through its own lens. Photography is local; only judging the result at scale is not.
 */
export function thresholdsNow() {
  return serverThresholds ?? bundledThresholds;
}

/**
 * Fetch the server's copy and switch to it. Resolves with the numbers now in force.
 *
 * ⚠️ Cache the SUCCESS, never the failure. `??=` on its own memoises a rejected promise, so
 * one unreachable API at startup used to disarm the gate for the entire session — every
 * later visit to /camera got the same dead promise back and sat on a spinner forever.
 * Dropping it on rejection makes the next attempt a real attempt.
 */
export function refreshThresholds() {
  inflight ??= api
    .get('/thresholds')
    .then((t) => {
      serverThresholds = t;
      return t;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}
