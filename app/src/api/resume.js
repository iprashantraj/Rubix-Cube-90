/*
 * What an in-progress upload should do when it finds an id it has seen before.
 *
 * Pure and dependency-free, in the same spirit as policy.js: the decision is three branches
 * and each wrong one is expensive — re-sending 3MB of an artisan's metered data, or worse,
 * assembling two different photographs into one corrupt file. Orchestration lives in
 * upload.ts; the judgement lives here where a plain `node` can check it.
 */

/**
 * Identify a photo by its CONTENT.
 *
 * ⚠️ Not by `blob.size`. Two photographs of the same saree, taken seconds apart at the same
 * resolution and quality, can land on the same byte count — and resuming photo B onto the
 * parts photo A already uploaded assembles a file that is the first half of one and the
 * second half of the other. Every request returns 200. The artisan gets a corrupt listing
 * image and nothing anywhere reports a failure.
 *
 * 16 bytes of SHA-256 is 128 bits, which is not a collision anyone reaches.
 *
 * @param {Blob} blob
 * @returns {Promise<string>} sessionStorage key
 */
export async function resumeKey(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `up:${hex}`;
}

/**
 * Given what `GET /uploads/{id}` said about a remembered id, what now.
 *
 * @param {{url?: string|null, received?: number[]}|null} prior
 *   the server's answer, or null if there was no remembered id / it 404'd
 * @returns {{action: 'done'|'resume'|'fresh', done: number[], url: string|null}}
 */
export function planResume(prior) {
  // Already assembled. The connection dropped on `complete`'s RESPONSE, not before it —
  // the bytes are on the server and the url is the answer. Re-uploading here would spend
  // the artisan's data to be told the same thing.
  if (prior && prior.url) return { action: 'done', done: [], url: prior.url };

  // A live upload with acknowledged chunks. This is the whole reason the chunking exists.
  if (prior && Array.isArray(prior.received) && prior.received.length > 0) {
    return { action: 'resume', done: prior.received, url: null };
  }

  // No memory, a 404, or an id that never got a chunk in. Start clean — a resume cushion
  // must never be the reason a photo cannot be uploaded at all.
  return { action: 'fresh', done: [], url: null };
}
