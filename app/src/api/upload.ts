import { api, ApiError } from './client';

/**
 * Resumable chunked upload. Spec §4.8, amended by docs/decisions.md.
 *
 * This replaces the offline queue from the v1 spec. We are online-first: there is no
 * local database and no sync engine. What we do handle is the connection dropping in the
 * middle of a 3MB photo on a rural tower — the upload resumes from the last acknowledged
 * chunk instead of restarting, and failure is spoken rather than left as a silent spinner.
 */

const CHUNK = 256 * 1024;
const MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
 * Upload size budget.
 *
 * 1600px on the long edge at quality 0.82 takes a ~2.5MB camera frame to roughly 350KB.
 *
 * The number that justifies this is not our storage bill — it is the artisan's mobile data.
 * They are on a metered prepaid pack on a weak rural connection, and a 2.5MB upload per
 * photo is a cost they pay, per product, to use us. It is also the difference between an
 * upload that finishes and one that times out twice and gets abandoned.
 *
 * Why 2000 and not less: it is the listing canvas size (`listing_canvas_px` in
 * ai/thresholds.json), so the master the pipeline works from is never an upscale.
 *
 * ⚠️ It was 1600, and combined with a 16:9 capture that made EVERY photograph
 * unprocessable: 1600 on the long edge is 900 on the short edge at 16:9, and the server
 * gate refuses anything under 1000 there. The capture is 4:3 now (camera/useCameraGate.ts),
 * so 2000 on the long edge is 1500 on the short — clear of the floor with room for a phone
 * that hands back a slightly different aspect than it was asked for.
 *
 * This costs the artisan data: roughly 350KB -> 550KB per photo. That is a real cost on a
 * metered prepaid pack and it is being paid deliberately, because the alternative is an
 * upload that completes, charges them for it, and is then refused by the server.
 *
 * Why 0.82 and not 0.92: on photographs of textiles and pottery the two are visually
 * indistinguishable at any size a phone displays, and 0.82 is about 40% of the bytes.
 * ⚠️ Do NOT lower it further to save more. Below ~0.75, JPEG ringing shows up along the
 * high-contrast thread boundaries in ikat and Sambalpuri weave — which is precisely the
 * detail the product is being sold on, and precisely what the camera gate spent all that
 * effort capturing sharply.
 */
const MAX_EDGE_PX = 2000;
const JPEG_QUALITY = 0.82;

/**
 * 🔒 Strip EXIF and downscale before anything leaves the device.
 *
 * An artisan's home GPS coordinates must never reach a public listing. Decoding to a
 * canvas and re-encoding discards every metadata block — no EXIF parser to keep correct,
 * no tag we forgot to clear. The downscale rides along on the same decode, so it is free:
 * we were already re-encoding for the privacy reason.
 *
 * Photos from useCameraGate are already canvas-encoded and therefore already clean of
 * metadata; the EXIF half matters for anything picked from the gallery, and the resize
 * half matters for both.
 */
export async function stripExif(blob: Blob): Promise<Blob> {
  /*
   * `imageOrientation: 'from-image'` — apply the rotation BEFORE the tag carrying it is
   * destroyed.
   *
   * A phone's sensor is mounted sideways in the body. Held upright to photograph a tall
   * matka, it records a sideways image and attaches an EXIF tag saying "rotate this 90°
   * before display". Every photo app reads that tag, which is why nobody notices it exists.
   *
   * This function throws every tag away deliberately — one of them is the artisan's home
   * GPS position. But the default for this option is `'none'`, and Android WebViews are not
   * consistent about it, so the rotation could be discarded along with the tag: sideways
   * pixels, no note, permanently, and nothing downstream able to recover the right way up.
   *
   * The capture gate would never have caught it — its measurements are averages, a
   * symmetric blur kernel and a box area, identical either way. `ai/`'s crop and composite
   * stages care enormously: they cut the product out and place it on clean white, so a
   * sideways input produces a neatly cropped product lying on its side, and that is the
   * version that reaches the listing.
   * (docs/Abhay/CHANGELOG.md, 2026-08-27 — flagged there as needing a real phone to
   * confirm. Setting it explicitly costs nothing and removes the question.)
   */
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });

  // Scale the LONG edge, so portrait and landscape both land on the same budget and a
  // photo that is already small is never upscaled.
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  // Non-null: a 2d context is only absent if the canvas was already claimed by a
  // different context type, which cannot happen for one created three lines ago.
  const ctx = canvas.getContext('2d')!;
  // Without these, the WebView's default box filter aliases a 4:1 downscale badly — woven
  // texture turns into moiré, which on this app's subject matter is the whole product.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  bitmap.close?.();
  return new Promise<Blob>((res) =>
    canvas.toBlob((b) => res(b as Blob), 'image/jpeg', JPEG_QUALITY),
  );
}

/**
 * Upload one blob, resuming across network drops.
 *
 * @param {Blob} blob
 * @param {object} opts
 * @param {(fraction:number)=>void} opts.onProgress
 * @param {(key:string)=>void} opts.onRetry  spoken feedback — never fail silently
 * @param {AbortSignal} opts.signal
 * @returns {Promise<{url:string}>}
 */
export async function upload(
  blob: Blob,
  {
    onProgress,
    onRetry,
    signal,
  }: {
    onProgress?: (fraction: number) => void;
    onRetry?: (key: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ url: string }> {
  const total = Math.ceil(blob.size / CHUNK);
  const { upload_id } = await api.post('/uploads', {
    size: blob.size,
    chunks: total,
    content_type: blob.type || 'image/jpeg',
  });

  // Ask what the server already has. On a fresh upload this is empty; after a drop it is
  // how we avoid re-sending the first two megabytes.
  const done = new Set((await api.get(`/uploads/${upload_id}`)).received ?? []);

  for (let i = 0; i < total; i++) {
    if (done.has(i)) {
      onProgress?.((i + 1) / total);
      continue;
    }
    const slice = blob.slice(i * CHUNK, (i + 1) * CHUNK);

    let attempt = 0;
    for (;;) {
      signal?.throwIfAborted();
      try {
        const form = new FormData();
        form.append('chunk', slice);
        await api.form(`/uploads/${upload_id}/chunk/${i}`, form, { signal });
        break;
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        // A 4xx means this request is wrong and will stay wrong. Only retry transport
        // failures and server errors, or we hammer the API for no reason.
        const retryable = !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
        if (!retryable || ++attempt >= MAX_ATTEMPTS) throw e;
        onRetry?.((e instanceof ApiError && e.messageKey) || 'net.retrying');
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }
    onProgress?.((i + 1) / total);
  }

  return api.post(`/uploads/${upload_id}/complete`, {});
}
