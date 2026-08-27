/**
 * What may be cached, and for how long. The one copy.
 *
 * This lived inside `api/cache.js`, the hand-rolled read cache that TanStack Query
 * replaced. Leaving it there made the new data layer depend on the module it was retiring:
 * `queries.ts` imported `cacheable`/`ttlFor` from a file scheduled for deletion, so deleting
 * that file would have silently taken the NEVER list with it.
 *
 * ⚠️ Deliberately `.js` with JSDoc types rather than `.ts`, and that is not laziness.
 * `node` cannot import a `.ts` module, and two runnable self-checks depend on this one —
 * `api/queries.test.mjs` and the camera/voice style checks that run with nothing installed.
 * TypeScript reads JSDoc fully, so the types are real; making this `.ts` would buy nothing
 * and cost the ability to test it without a bundler.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Paths whose responses must never be written down, matched as prefixes.
 *
 * `/auth` carries the token and the OTP exchange. `/uploads` describes an in-flight capture
 * that is meaningless a minute later.
 *
 * `/publish` and `/enhance` are job polls, and a cached job status is wrong by construction:
 * the loop asks "are you still running?" and a copy answers "yes" forever, so the screen
 * never leaves. Nothing at those call sites announces that danger — they look like any
 * other GET — which is why the guard lives in the data layer and not in a comment.
 *
 * @type {readonly string[]}
 */
export const NEVER = ['/auth', '/uploads', '/publish', '/enhance'];

/**
 * How long each family stays fresh before a revalidation is forced.
 *
 * These are not guesses about the data, they are guesses about the ARTISAN: how long can
 * this be wrong on screen before it misleads someone. Their own name is fixed for months;
 * an order that arrived while they were cataloguing matters within the minute.
 *
 * @type {readonly (readonly [string, number])[]}
 */
export const TTL = [
  ['/me', 30 * 60 * 1000],
  ['/thresholds', 60 * 60 * 1000],
  // The channel catalogue and its selector packs are effectively static config; what moves
  // is the `connected` flag, and that only moves because of a mutation on this device,
  // which invalidates the entry anyway.
  ['/channels', 30 * 60 * 1000],
  ['/products', 5 * 60 * 1000],
  ['/orders', 60 * 1000],
];

/**
 * @param {string} path
 * @returns {number} milliseconds this family stays fresh
 */
export function ttlFor(path) {
  const hit = TTL.find(([p]) => path.startsWith(p));
  return hit ? hit[1] : DEFAULT_TTL_MS;
}

/**
 * @param {string} path
 * @returns {boolean} false if the response must never be stored
 */
export function cacheable(path) {
  return !NEVER.some((p) => path.startsWith(p));
}
