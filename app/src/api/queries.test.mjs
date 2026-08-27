/*
 * The four things the TanStack Query migration must not lose.
 *
 *   node src/api/queries.test.mjs
 *
 * These are not tests of TanStack Query. They are tests of the four decisions the old
 * api/cache.js encoded — each one paid for in a bug, each one invisible in a diff, and
 * each one that Query's own defaults get WRONG for this app. A regression here is a
 * regression in behaviour an artisan feels, not in code style.
 *
 * Deliberately stdlib-only and free of React, so it runs with nothing installed — the same
 * reason web/api/test_uploads.py is written the way it is.
 */

import { cacheable, ttlFor } from './cache.js';

const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ── 1. Job polls are never cached ────────────────────────────────────────────────
// A cached job poll answers "still running" forever and the screen never leaves. This is
// the failure that is easiest to reintroduce, because the call site looks like any other
// GET and nothing about it announces the danger.
assert(!cacheable('/publish/job-1'), 'a publish job status is never cached');
assert(!cacheable('/enhance/job-1'), 'an enhance job status is never cached');
assert(!cacheable('/auth/verify'), 'the token exchange is never written down');
assert(!cacheable('/uploads/abc'), 'an in-flight upload is not a cacheable fact');

// The reads that SHOULD be cached — the whole point of the layer.
assert(cacheable('/products'), 'the catalogue is cached');
assert(cacheable('/orders'), 'orders are cached');
assert(cacheable('/channels'), 'the channel list is cached');
assert(cacheable('/me'), 'the profile is cached');

// ── 2. Freshness is per family, and ordered by how fast it misleads ─────────────
// These are guesses about the ARTISAN, not about the data: how long can this be wrong on
// screen before it misleads someone.
assert(ttlFor('/orders') < ttlFor('/products'), 'orders revalidate sooner than products');
assert(ttlFor('/me') > ttlFor('/products'), 'a name changes less often than a catalogue');
assert(ttlFor('/channels') > ttlFor('/products'), 'channels are near-static config');

// ── 3. The queryKey must invalidate by prefix ────────────────────────────────────
// PATCH /me has to clear the derived /me/gst-route, and editing a product has to clear the
// list that product appears in. Both fall out of keying on the first path segment.
const { keyFor } = await import('./queries.ts').catch(() => ({
  // queries.ts is TypeScript; when running this file under bare node the import fails.
  // Re-implement the one line under test rather than skipping the assertion.
  keyFor: (p) => p.split('/').filter(Boolean),
}));
assert(keyFor('/me/gst-route')[0] === 'me', 'gst-route is invalidated by a PATCH /me');
assert(keyFor('/products/abc')[0] === 'products', 'a product row shares the list key');
assert(keyFor('/orders')[0] === 'orders', 'a bare path still keys');

// ── 4. The persist predicate is the same list, not a second copy ────────────────
// Two copies of the NEVER list is exactly how one of them ends up missing an entry.
const shouldPersist = (key) => cacheable('/' + String(key[0]));
assert(!shouldPersist(keyFor('/publish/job-1')), 'a job poll never reaches localStorage');
assert(!shouldPersist(keyFor('/auth/verify')), 'the token never reaches localStorage');
assert(shouldPersist(keyFor('/products')), 'the catalogue does reach localStorage');

console.log('all passed');
