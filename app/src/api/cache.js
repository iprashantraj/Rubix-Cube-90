/*
 * Read-through cache for GET responses. Stale-while-revalidate.
 *
 * The screens were online-first in the literal sense: every visit to /products re-fetched
 * the catalogue and showed a spinner while it did, even when the answer was the same
 * fourteen rows as forty seconds earlier. On a metered 2G connection that is the artisan's
 * money, and on a cheap phone the spinner IS the app as far as they can tell.
 *
 * So: answer from the cache immediately, ask the server in the background, and update the
 * screen only if the answer actually changed. The network stops being the thing between
 * the artisan and their own data — it becomes the thing that corrects it.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 * Not an offline store and not a sync engine. Nothing here queues writes, resolves
 * conflicts or pretends a mutation succeeded — see docs/decisions.md, we deliberately did
 * not build that. A cached read that turns out to be stale costs a second of wrong numbers;
 * a fake write costs an artisan a product they think they published and did not.
 *
 * 🔒 Nothing from /auth is ever cached, and the whole store is dropped on sign-out and on
 * DPDP erasure. A phone gets handed around a family; the next person to hold it must not
 * find the last one's orders sitting in localStorage.
 */

const PREFIX = 'kaarigar.cache.';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 60;

/**
 * Paths whose responses must never be written down, matched as prefixes.
 *
 * /auth carries the token and the OTP exchange. /uploads answers describe an in-flight
 * capture that is meaningless a minute later.
 *
 * /publish and /enhance are job polls, and a cached job status is a wrong one by
 * construction: the loop asks "are you still running?" and a copy answers "yes" forever.
 * Both are polled with plain `api.get` today, so this is a guard on the next caller rather
 * than a fix — which is the point. Nothing about those call sites announces that switching
 * them to `cachedGet` would hang the screen.
 */
const NEVER = ['/auth', '/uploads', '/publish', '/enhance'];

/**
 * How long each family of data stays fresh before a revalidation is forced.
 *
 * These are not guesses about the data, they are guesses about the ARTISAN: how long can
 * this be wrong on screen before it misleads someone. Their own name is fixed for months;
 * an order that arrived while they were cataloguing matters within the minute.
 */
const TTL = [
  ['/me', 30 * 60 * 1000],
  ['/thresholds', 60 * 60 * 1000],
  // The channel catalogue and its selector packs are effectively static config; what moves
  // is the `connected` flag, and that only moves because of a mutation on this device,
  // which invalidates the entry anyway. Long TTL: this is walked in and out of repeatedly
  // during setup, with the artisan's other hand on a marketplace app.
  ['/channels', 30 * 60 * 1000],
  ['/products', 5 * 60 * 1000],
  ['/orders', 60 * 1000],
];

export function ttlFor(path) {
  return TTL.find(([p]) => path.startsWith(p))?.[1] ?? DEFAULT_TTL_MS;
}

export function cacheable(path) {
  return !NEVER.some((p) => path.startsWith(p));
}

/**
 * Everything in this module goes through an injected store, so the logic can be checked
 * with `node src/api/cache.js` instead of only in a browser. `localStorage` is the one used
 * in the app; the self-check at the bottom passes a plain Map.
 */
function memoryStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
  };
}

function browserStore() {
  return {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
    keys: () => Object.keys(localStorage),
  };
}

export class ResponseCache {
  constructor({ store, now = () => Date.now() } = {}) {
    this.store = store ?? (typeof localStorage === 'undefined' ? memoryStore() : browserStore());
    this.now = now;
  }

  /** `{ data, etag, at }` or null. A corrupt entry is dropped rather than thrown. */
  read(path) {
    const raw = this.store.getItem(PREFIX + path);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      this.store.removeItem(PREFIX + path);
      return null;
    }
  }

  write(path, data, etag) {
    if (!cacheable(path)) return;
    try {
      this.store.setItem(PREFIX + path, JSON.stringify({ data, etag, at: this.now() }));
    } catch {
      // localStorage is full, or private mode refuses writes. A cache that cannot store is
      // a slow app, not a broken one — evict the oldest and give up quietly on failure.
      this.evict(Math.floor(MAX_ENTRIES / 2));
      try {
        this.store.setItem(PREFIX + path, JSON.stringify({ data, etag, at: this.now() }));
      } catch {
        /* still no room: serve from the network from here on */
      }
    }
    this.evict();
  }

  fresh(path, entry) {
    return !!entry && this.now() - entry.at < ttlFor(path);
  }

  /**
   * Drop what a mutation invalidated.
   *
   * A PATCH /me that leaves a cached /me behind is worse than no cache at all: the artisan
   * corrects their name, the screen says it worked, and the next visit shows the old one.
   * Prefix-matched, so PATCH /products/abc clears both the row and the list above it.
   */
  invalidate(path) {
    const base = '/' + path.split('/').filter(Boolean)[0];
    for (const k of this.store.keys()) {
      if (k.startsWith(PREFIX) && k.slice(PREFIX.length).startsWith(base)) this.store.removeItem(k);
    }
  }

  /** Everything. Sign-out and erasure — see the 🔒 note at the top of this file. */
  clear() {
    for (const k of this.store.keys()) if (k.startsWith(PREFIX)) this.store.removeItem(k);
  }

  /** Oldest-first, so a long session cannot grow the store without bound. */
  evict(target = MAX_ENTRIES) {
    const entries = this.store
      .keys()
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => {
        try {
          return { k, at: JSON.parse(this.store.getItem(k)).at ?? 0 };
        } catch {
          return { k, at: 0 };
        }
      });
    if (entries.length <= target) return;
    entries.sort((a, b) => a.at - b.at);
    for (const { k } of entries.slice(0, entries.length - target)) this.store.removeItem(k);
  }
}

export const cache = new ResponseCache();

/*
 * Self-check: node src/api/cache.js
 *
 * Same shape as camera/gate.js and voice/micLifecycle.js. The clock and the storage are
 * both injected precisely so this can run without a browser and without waiting.
 */
function demo() {
  const assert = (c, m) => {
    if (!c) throw new Error(m);
  };
  let clock = 1000;
  const c = new ResponseCache({ store: memoryStore(), now: () => clock });

  c.write('/products', [{ id: 'a' }], 'W/"1"');
  assert(c.read('/products').data[0].id === 'a', 'a written entry reads back');
  assert(c.fresh('/products', c.read('/products')), 'just written is fresh');

  clock += ttlFor('/products') + 1;
  assert(!c.fresh('/products', c.read('/products')), 'past its TTL it is stale');
  assert(c.read('/products') !== null, 'stale is still served — that is the whole point');

  // Orders go stale faster than products: an order that arrived mid-catalogue matters now.
  assert(ttlFor('/orders') < ttlFor('/products'), 'orders revalidate sooner than products');
  assert(ttlFor('/me') > ttlFor('/products'), 'a name changes less often than a catalogue');

  assert(!cacheable('/auth/verify'), 'the token exchange is never written down');
  assert(!cacheable('/uploads/abc'), 'an in-flight upload is not a cacheable fact');
  // A poll answered from a copy says "running" forever and the screen never leaves.
  assert(!cacheable('/publish/job-1'), 'a publish job status is never cached');
  assert(!cacheable('/enhance/job-1'), 'an enhance job status is never cached');
  assert(cacheable('/channels'), 'the channel list is cached — it is what /publish renders');
  c.write('/auth/verify', { token: 'secret' });
  assert(c.read('/auth/verify') === null, 'and write() refuses it even if asked');

  c.write('/me', { display_name: 'Utsav' });
  c.invalidate('/me');
  assert(c.read('/me') === null, 'a PATCH must not leave the old profile behind');

  // GstWizard reads /me/gst-route. A readiness answer that changes the route is a PATCH /me,
  // and invalidate() matches on the first segment, so the wizard cannot show the old route.
  c.write('/me/gst-route', { route: 'composition' });
  c.invalidate('/me');
  assert(c.read('/me/gst-route') === null, 'PATCH /me clears the derived gst route too');

  c.write('/products', [1]);
  c.write('/products/abc', { id: 'abc' });
  c.invalidate('/products/abc');
  assert(c.read('/products') === null, 'editing a product clears the list it appears in');

  c.write('/orders', [1]);
  c.clear();
  assert(c.read('/orders') === null, 'sign-out leaves nothing for the next person holding the phone');

  const big = new ResponseCache({ store: memoryStore(), now: () => clock++ });
  for (let i = 0; i < MAX_ENTRIES + 15; i++) big.write(`/products/${i}`, { i });
  const kept = big.store.keys().filter((k) => k.startsWith(PREFIX)).length;
  assert(kept <= MAX_ENTRIES, `cache is capped, kept ${kept}`);
  assert(big.read(`/products/${MAX_ENTRIES + 14}`) !== null, 'eviction drops the OLDEST, not the newest');

  console.log('all passed');
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('cache.js')) demo();
