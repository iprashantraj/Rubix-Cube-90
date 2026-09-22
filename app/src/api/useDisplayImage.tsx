import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { apiUrl } from './client';

/**
 * A stored image url as something fetchable from this device.
 *
 * The server stores enhanced renditions as `/api/enhanced/…` — root-relative, so that no
 * laptop's DHCP address is baked into a database row (see `_publish_local`). Relative is
 * exactly right for a browser and exactly wrong for Capacitor, where the app is served from
 * `https://localhost` and a leading `/api` resolves into the app's OWN bundled assets: the
 * request 404s against the WebView and never reaches a server at all. That is the failure
 * `client.ts` documents as the most confusing this app can produce.
 *
 * So relative urls go through `apiUrl()`, which is the same indirection every other API call
 * already uses. Absolute urls (S3, or anything already resolved) are returned untouched.
 */
function resolveSrc(url: string): string {
  return url.startsWith('/api/') ? apiUrl(url.slice('/api'.length)) : url;
}

/*
 * Urls that answered 404, so they are asked for once per session and not once per render.
 *
 * 🐞 The AI service used to write renders under /tmp, which is swept while the machine is
 * up. The `product_images` rows survive in Postgres, so every enhanced image from before a
 * sweep points at a file that is gone. Each one 404s — and because this hook refetches
 * whenever a component mounts, the shelf on /home and the list on /products re-asked for
 * the same dead files on every navigation. The server log was hundreds of 404s for a
 * handful of products, and the artisan's connection paid for all of them.
 *
 * The storage default is fixed, but rows written before it are unrecoverable: the bytes do
 * not exist anywhere. So a miss has to be remembered rather than retried forever.
 *
 * Deliberately a Set and deliberately not persisted: a 404 here means "this render is
 * gone", which is true for the session, and clearing on relaunch is the free retry for the
 * case where the file comes back — re-running /enhance rewrites the row and the url changes
 * anyway. Only 404 is remembered; a timeout or a 5xx is the network having a bad moment and
 * must stay retryable, or one dropped packet would blank an image until the app restarts.
 */
const gone = new Set<string>();

/**
 * Turn a server image url into something the WebView will actually paint.
 *
 * 🐞 Why this is not just `<img src={url}>`, 2026-09-02:
 *
 * Capacitor serves this app from `https://localhost` (androidScheme in
 * capacitor.config.json) and the dev API is plain `http://10.169.219.181:8000`. That makes
 * every server image MIXED CONTENT, and Chromium treats the two kinds differently:
 *
 *   blockable            (fetch, XHR, scripts) — blocked, unless something allows it
 *   optionally-blockable (img, video, audio)   — AUTO-UPGRADED to https, then blocked
 *                                                when the upgrade fails
 *
 * `MainActivity.java` sets `MIXED_CONTENT_ALWAYS_ALLOW`, which is why every API call in
 * this app works over plain http. It does NOT turn off the auto-upgrade, so an `<img>`
 * pointed at `http://…:8000/api/enhanced/…` is silently rewritten to `https://…:8000`,
 * finds no TLS listener, and paints nothing. The artisan sees an empty card — and on
 * /catalog/prefill that empty card is under the words "is this the real colour?", which is
 * the one question CONTRIBUTING.md rule 4 says must never be asked about an image nobody can see.
 *
 * The photograph was fine, the pipeline was fine, and the file answered 200 to `curl` from
 * the phone itself. Only the `<img>` failed.
 *
 * So: fetch the bytes on the path that IS allowed, and hand the tag a `blob:` url, which is
 * same-origin and exempt from mixed content entirely. `voice/engine.js` already reaches for
 * `URL.createObjectURL` for the same reason on the audio side.
 *
 * ⚠️ This is a dev-transport workaround, not the shape of production. Once the API is
 * HTTPS there is no mixed content and `<img src={url}>` is correct again — but leaving this
 * in place stays harmless, so it is not urgent to remove.
 *
 * Degrades the way everything else here degrades (rule 3): any failure falls back to the
 * artisan's own photo rather than showing an empty frame.
 */
export function useDisplayImage(url?: string | null, fallback?: string | null) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    // Not a server url — a blob: or data: url is already paintable, and the artisan's own
    // photo is the fallback in every other case. `/api/…` counts as a server url: it is how
    // enhanced renditions are stored, and resolveSrc turns it into a reachable one.
    // A url already known to be gone: go straight to the fallback. Asking again costs the
    // artisan data and the server a log line, and the answer will not have changed.
    if (!url || gone.has(url) || !(/^https?:/.test(url) || url.startsWith('/api/'))) {
      setObjectUrl(null);
      return undefined;
    }

    let alive = true;
    let created: string | null = null;

    // Show the fallback while the enhanced image is in flight rather than a blank frame.
    setObjectUrl(null);

    fetch(resolveSrc(url))
      .then((res) => {
        if (res.ok) return res.blob();
        // 404 is "this render does not exist", which is permanent for this session. Any
        // other status is the server or the network having a moment and stays retryable.
        if (res.status === 404) gone.add(url);
        throw new Error(`HTTP ${res.status}`);
      })
      .then((blob) => {
        if (!alive) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        // The enhanced render is a nicety; the listing is not. Keep the artisan's photo.
      });

    return () => {
      alive = false;
      // Only ever revokes a url this hook created. `fallback` belongs to the draft store
      // and is still needed by the next screen — revoking it would break the very fallback
      // this exists to protect.
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return objectUrl ?? fallback ?? undefined;
}

type ServerImageProps = { src?: string | null; fallback?: string | null } & Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src'
>;

/**
 * An `<img>` for a url that came from the API. Same fix as the hook, in the shape a list
 * needs: one component instance per row, because a hook cannot be called inside a `.map`.
 *
 * Every product thumbnail on /home, /products and /products/:id is a server url, so all
 * three went blank for exactly the same reason the colour screen did.
 *
 * ponytail: fetches each thumbnail eagerly, which drops the `loading="lazy"` the browser
 * would have honoured on a plain src. Fine at the handful of products a dev account has;
 * if a list ever grows past a screenful, gate this on an IntersectionObserver rather than
 * reaching back for a raw <img>, which does not render here at all.
 */
export function ServerImage({ src, fallback, ...rest }: ServerImageProps) {
  const resolved = useDisplayImage(src, fallback);
  // Nothing to show yet and nothing to fall back to: render no src rather than a broken
  // icon. Callers already branch on `p.image` before reaching for this.
  return <img src={resolved} {...rest} />;
}
