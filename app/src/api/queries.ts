import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { cacheable, ttlFor } from './cache.js';

/**
 * The read cache, on TanStack Query.
 *
 * Replaces the hand-rolled `cachedGet` in api/client.js. What it inherits — and what has
 * to survive the move — is not the caching. It is four decisions that were paid for in
 * bugs, are invisible in a diff, and that Query's defaults get WRONG. They are re-asserted
 * here explicitly rather than assumed:
 *
 * ── 1. Some paths must never be cached at all ───────────────────────────────────
 * `/auth` carries the token. `/uploads` describes an in-flight capture. `/publish` and
 * `/enhance` are JOB POLLS, and a cached job poll is wrong by construction: the loop asks
 * "are you still running?" and a stored copy answers "yes" forever, so the screen never
 * leaves. `cacheable()` is imported from the old module rather than re-listed, because two
 * copies of that list is exactly how one of them ends up missing an entry.
 *
 * ── 2. refetchOnWindowFocus must be OFF ─────────────────────────────────────────
 * Query turns it on by default. Every time the artisan takes a call and comes back, that
 * default re-fetches every mounted query — on a metered prepaid pack, on a rural tower.
 * The whole reason api/cache.js exists is that re-fetching an unchanged catalogue is the
 * artisan's money.
 *
 * ── 3. The persisted cache dies with the session ────────────────────────────────
 * 🔒 These phones get handed around a family. `signOut()` in store.js clears it, and this
 * file is what gives it something to clear. A previous artisan's catalogue, orders and
 * profile must not still be in localStorage when the next person signs in.
 *
 * ── 4. Two screens must not revalidate over their own optimistic writes ─────────
 * OrderDetail and Earnings write the answer into state the moment the artisan taps, so
 * they can clear several rows in a row. A background refetch resolving a second later
 * would stamp the server's pre-mutation copy back over it — on the money screen, which is
 * the worst place in the app to appear to undo something. Those two opt out via
 * `staleTime: Infinity` at the call site; the mutation invalidates the key, so the next
 * visit is authoritative.
 */

/** The queryKey for a path. An array, so `/products` invalidates `/products/abc` too. */
export const keyFor = (path: string): string[] => path.split('/').filter(Boolean);

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Point 2 above. This is the single most important line in the file for a user on
        // a metered connection, and it is a default Query gets backwards for us.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,

        // Per-family freshness, from the same table the old cache used — these are guesses
        // about the ARTISAN, not about the data: how long can this be wrong on screen
        // before it misleads someone. `queryKey[0]` is the first path segment.
        // Number(): ttlFor comes from untyped JS, where the TTL table is an array of
        // [path, ms] pairs and therefore infers as string | number. The coercion is at the
        // boundary rather than hidden behind a cast, so a bad entry in that table becomes
        // NaN here — which Query treats as always-stale — instead of a silent type lie.
        staleTime: ({ queryKey }) => Number(ttlFor('/' + String(queryKey[0]))),

        // Kept an hour past staleness so a revisit renders instantly from the copy and
        // corrects behind the artisan, which is the entire premise of the old module.
        gcTime: 60 * 60 * 1000,

        // A failed read must never take the screen down — the artisan is looking at data
        // that was correct minutes ago. One retry, then serve what we have.
        retry: 1,
      },
    },
  });
}

/**
 * One client for the app's lifetime.
 *
 * A module singleton rather than something App creates, because `signOut()` in store.js
 * has to be able to reach it and store.js is not a component. That is not a convenience:
 * removing the persisted copy from localStorage is only half of point 3 above. The client
 * also holds every read IN MEMORY, so signing out and signing in as somebody else without
 * restarting the app would still serve the previous artisan's catalogue from the first
 * frame — the persisted copy is what survives a restart, and the in-memory one is what
 * survives a sign-out. Both have to go, and `clearSession()` below is the only thing that
 * does both.
 */
export const queryClient = makeQueryClient();

/**
 * 🔒 Forget everything about the person who was signed in.
 *
 * Called by `signOut()` in store.js. These phones get handed around a family; what the
 * last person did must not be readable by the next one.
 */
export function clearSession() {
  queryClient.clear();
  try {
    window.localStorage.removeItem('kaarigar.query');
  } catch {
    /* private mode or storage disabled — nothing was persisted either. */
  }
}

/**
 * localStorage, not IndexedDB.
 *
 * We are online-first by decision (docs/decisions.md) and this is a read cache, not a
 * local database. IndexedDB would be the first step towards the sync engine that was
 * deliberately not built, and it is asynchronous — which would put a frame of empty screen
 * before the restored copy on exactly the cheap phones this is meant to help.
 */
export const persister = createSyncStoragePersister({
  storage: typeof window === 'undefined' ? undefined : window.localStorage,
  key: 'kaarigar.query',
});

/**
 * Point 1: never persist a response that must not be written down.
 *
 * The runtime cache and the PERSISTED cache are two different things and this predicate
 * only guards the second. `cacheable()` is the same function the old module used, so the
 * NEVER list has exactly one definition in the codebase.
 */
export const shouldPersistQuery = (queryKey: readonly unknown[]) =>
  cacheable('/' + String(queryKey[0]));
