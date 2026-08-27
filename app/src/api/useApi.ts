import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './client.js';
import { cacheable } from './cache.js';
import { keyFor } from './queries';

/**
 * The one way a screen reads from the API.
 *
 * Screens do not call `useQuery` directly, for the same reason they no longer decide what
 * a loading state looks like: the two rules that must hold on every read are easy to
 * forget and invisible when forgotten.
 *
 *   1. A path on the NEVER list is fetched but never stored. `/publish/{id}` and
 *      `/enhance/{id}` are job polls — a cached job status answers "still running" forever
 *      and the screen never leaves. Enforced here so no call site can opt in by accident.
 *   2. `enabled` defaults to true but is honoured, so a detail screen with no id yet does
 *      not fire a request for `/products/undefined`.
 */
export function useApiQuery<T = unknown>(
  path: string,
  opts: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> & {
    /**
     * Opt out of background revalidation entirely.
     *
     * ⚠️ For screens that write optimistically — OrderDetail, Earnings. A refetch landing
     * just after the artisan taps would stamp the server's pre-mutation copy back over the
     * change they were told had worked. The mutation invalidates the key, so the NEXT
     * visit is authoritative; that is the right place to correct it, not mid-tap.
     */
    frozen?: boolean;
  } = {},
) {
  const { frozen, ...rest } = opts;
  const never = !cacheable(path);

  return useQuery<T>({
    queryKey: keyFor(path),
    queryFn: () => api.get(path) as Promise<T>,
    // A job poll is fetched every time it is asked for and kept for no time at all.
    ...(never ? { staleTime: 0, gcTime: 0 } : {}),
    ...(frozen ? { staleTime: Infinity, refetchOnMount: false } : {}),
    ...rest,
  });
}

/**
 * Drop what a mutation invalidated.
 *
 * Prefix-matched on the first path segment, so `PATCH /me` clears the derived
 * `/me/gst-route` too and `POST /products/{id}/...` clears the list the row appears in.
 * A mutation that leaves its own stale read behind is worse than having no cache: the
 * artisan corrects something, is told it worked, and finds the old value on the next
 * screen.
 */
export function useInvalidate() {
  const qc = useQueryClient();
  return (path: string) => qc.invalidateQueries({ queryKey: [keyFor(path)[0]] });
}
