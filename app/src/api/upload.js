import { api, ApiError } from './client.js';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 🔒 Strip EXIF before anything leaves the device.
 *
 * An artisan's home GPS coordinates must never reach a public listing. Decoding to a
 * canvas and re-encoding discards every metadata block — no EXIF parser to keep correct,
 * no tag we forgot to clear.
 *
 * Photos from useCameraGate are already canvas-encoded and therefore already clean; this
 * matters for anything picked from the gallery.
 */
export async function stripExif(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
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
export async function upload(blob, { onProgress, onRetry, signal } = {}) {
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
        if (e.name === 'AbortError') throw e;
        // A 4xx means this request is wrong and will stay wrong. Only retry transport
        // failures and server errors, or we hammer the API for no reason.
        const retryable = !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
        if (!retryable || ++attempt >= MAX_ATTEMPTS) throw e;
        onRetry?.(e.messageKey ?? 'net.retrying');
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }
    onProgress?.((i + 1) / total);
  }

  return api.post(`/uploads/${upload_id}/complete`, {});
}
