import { api } from '../api/client';

/**
 * Telling the server we guessed wrong.
 *
 * `GET /catalog/defaults` remembers what an artisan said. This records what we got WRONG,
 * which is worth more: we know the guess, we know the truth, and we know which of our two
 * guessers produced it. `web/api/learning.py` reads it back to prefer a correction over raw
 * history, and to stop offering guesses for a field it keeps having to walk back — because
 * a confirmation the artisan has learned to reject is worse than the open question it
 * replaced.
 *
 * Every call here is fire-and-forget. It happens in the middle of a correction the artisan
 * is already making, and a failed write must never become something they have to deal
 * with. Losing a row costs a little learning; interrupting them costs the correction.
 */

/**
 * Compare the way a human would, and the way the server does.
 *
 * Mirrors `norm()` in web/api/learning.py deliberately. If the two disagree, the client
 * sends a "correction" the server then counts as no change, or the reverse — and a field
 * quietly silences itself because "Cotton" and "cotton" were treated as a disagreement
 * three times.
 */
export function norm(value: unknown): string {
  if (value == null) return '';
  return String(value).normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** True when `corrected` is genuinely a different answer from `guessed`. */
export function changed(guessed: unknown, corrected: unknown): boolean {
  const a = norm(guessed);
  const b = norm(corrected);
  // No guess means nothing was offered, so nothing was wrong — the artisan filled a blank,
  // which is a success. The server applies the same rule; both do it so that neither is
  // silently the only thing standing between a working field and a silenced one.
  return Boolean(a) && Boolean(b) && a !== b;
}

export async function recordCorrection(
  field: string,
  guessed: unknown,
  corrected: unknown,
  source: 'prefill' | 'default' = 'default',
  productId?: string | null,
): Promise<void> {
  if (!changed(guessed, corrected)) return;
  try {
    await api.post('/catalog/corrections', {
      field,
      guessed: guessed == null ? null : String(guessed),
      corrected: String(corrected),
      source,
      product_id: productId ?? null,
    });
  } catch {
    // Deliberately silent. See the note at the top of this file.
  }
}
